/**
 * L3 Integration Test — costTracker service
 *
 * Mock boundary: none.
 * Real code:     L3 costTracker + L2 costStore + L1 in-memory database + L0 pricing.
 *
 * Validates that the cost tracker still aggregates in memory while persisting
 * per-run cost records to the database for historical queries.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, test, expect } from 'vitest'
import { closeDatabase, getDatabase, initializeDatabase, resetDatabaseSingleton } from '../../../L1-infra/database/index.js'
import { COPILOT_PRU_OVERAGE_RATE } from '../../../L0-pure/pricing/pricing.js'
import { getRunCosts, getRunSummary } from '../../../L2-clients/dataStore/costStore.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'

function clearCostRecords(): void {
  getDatabase().exec(`
    DELETE FROM cost_records;
    DELETE FROM sqlite_sequence WHERE name = 'cost_records';
  `)
}

// Logger is auto-mocked by global setup.ts

beforeAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
  initializeDatabase({ inMemory: true })
})

afterAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

describe('L3 Integration: costTracker', () => {
  beforeEach(() => {
    clearCostRecords()
    costTracker.reset()
  })

  afterEach(() => {
    clearCostRecords()
    costTracker.reset()
  })

  // ── recordUsage + getReport ──────────────────────────────────────────

  test('recordUsage stores records and getReport aggregates by provider', () => {
    costTracker.setAgent('TestAgent')
    costTracker.setStage('transcription')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })

    const report = costTracker.getReport()
    expect(report.records).toHaveLength(1)
    expect(report.totalTokens.input).toBe(100)
    expect(report.totalTokens.output).toBe(50)
    expect(report.totalTokens.total).toBe(150)
    expect(report.byProvider['openai']).toBeDefined()
    expect(report.byProvider['openai'].calls).toBe(1)
  })

  test('recordUsage aggregates by agent', () => {
    costTracker.setAgent('AgentA')
    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })

    costTracker.setAgent('AgentB')
    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    })

    const report = costTracker.getReport()
    expect(report.byAgent['AgentA'].calls).toBe(1)
    expect(report.byAgent['AgentB'].calls).toBe(1)
    expect(report.totalTokens.total).toBe(450)
  })

  test('recordUsage aggregates by model', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
    costTracker.recordUsage('openai', 'gpt-4o-mini', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    })

    const report = costTracker.getReport()
    expect(report.byModel['gpt-4o'].calls).toBe(1)
    expect(report.byModel['gpt-4o-mini'].calls).toBe(1)
  })

  test('copilot provider uses PRU-based cost via L0 calculatePRUCost', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('copilot', 'claude-sonnet-4', {
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
    })

    const report = costTracker.getReport()
    expect(report.totalPRUs).toBeGreaterThan(0)
    // PRU cost converted to USD via COPILOT_PRU_OVERAGE_RATE
    expect(report.totalCostUSD).toBe(report.totalPRUs * COPILOT_PRU_OVERAGE_RATE)
  })

  test('openai provider uses token-based cost via L0 calculateTokenCost', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })

    const report = costTracker.getReport()
    expect(report.totalPRUs).toBe(0)
    expect(report.totalCostUSD).toBeGreaterThan(0)
  })

  test('custom cost overrides auto-calculation', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage(
      'custom',
      'custom-model',
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      { amount: 0.42, unit: 'usd', model: 'custom-model' },
    )

    const report = costTracker.getReport()
    expect(report.totalCostUSD).toBeCloseTo(0.42)
    expect(report.totalPRUs).toBe(0)
  })

  // ── recordServiceUsage ────────────────────────────────────────────────

  test('recordServiceUsage tracks non-LLM costs', () => {
    costTracker.setStage('caption-burn')

    costTracker.recordServiceUsage('whisper', 0.006, { minutes: 1 })

    const report = costTracker.getReport()
    expect(report.serviceRecords).toHaveLength(1)
    expect(report.serviceRecords[0].service).toBe('whisper')
    expect(report.serviceRecords[0].costUSD).toBe(0.006)
    expect(report.serviceRecords[0].stage).toBe('caption-burn')
    expect(report.serviceRecords[0].metadata).toEqual({ minutes: 1 })
    expect(report.totalServiceCostUSD).toBeCloseTo(0.006)
    expect(report.byService['whisper'].costUSD).toBeCloseTo(0.006)
    expect(report.byService['whisper'].calls).toBe(1)
  })

  test('service costs are included in totalCostUSD', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })
    costTracker.recordServiceUsage('whisper', 0.05)

    const report = costTracker.getReport()
    // totalCostUSD should include both LLM + service costs
    const llmOnlyCost = report.byProvider['openai'].costUSD
    expect(report.totalCostUSD).toBeCloseTo(llmOnlyCost + 0.05)
  })

  test('setRunId persists LLM and service records for the current run', () => {
    costTracker.setRunId('run-cost-tracker-1')
    costTracker.setAgent('SummaryAgent')
    costTracker.setStage('summary')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 400,
      outputTokens: 100,
      totalTokens: 500,
    }, undefined, 1800)
    costTracker.recordServiceUsage('web-search', 0.4, { query: 'video notes' })

    const inMemoryReport = costTracker.getReport()
    const persistedSummary = getRunSummary('run-cost-tracker-1')

    expect(getRunCosts('run-cost-tracker-1')).toHaveLength(2)
    expect(persistedSummary.totalCostUSD).toBeCloseTo(inMemoryReport.totalCostUSD)
    expect(persistedSummary.totalPRUs).toBe(0)
    expect(persistedSummary.totalTokens).toEqual({
      input: 400,
      output: 100,
      total: 500,
    })
    expect(persistedSummary.llmCalls).toBe(1)
    expect(persistedSummary.serviceCalls).toBe(1)
  })

  test('getHistoricalCosts reads persisted rows and respects the since filter', () => {
    costTracker.setRunId('run-history-old')
    costTracker.setAgent('AgentA')
    costTracker.setStage('summary')
    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })

    getDatabase().exec("UPDATE cost_records SET timestamp = '2020-01-01 00:00:00', created_at = '2020-01-01 00:00:00' WHERE run_id = 'run-history-old'")

    costTracker.setRunId('run-history-new')
    costTracker.setStage('social-media')
    costTracker.recordServiceUsage('exa', 0.01, { resultCount: 3 })

    const allRows = costTracker.getHistoricalCosts()
    const recentRows = costTracker.getHistoricalCosts('2021-01-01 00:00:00')

    expect(allRows).toHaveLength(2)
    expect(allRows.map((row) => row.run_id)).toEqual(['run-history-old', 'run-history-new'])
    expect(recentRows).toHaveLength(1)
    expect(recentRows[0].run_id).toBe('run-history-new')
    expect(recentRows[0].record_type).toBe('service')
  })

  // ── formatReport ──────────────────────────────────────────────────────

  test('formatReport returns formatted string with totals', () => {
    costTracker.setAgent('SummaryAgent')
    costTracker.setStage('summary')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
    })
    costTracker.recordServiceUsage('whisper', 0.01)

    const output = costTracker.formatReport()

    expect(output).toContain('Pipeline Cost Report')
    expect(output).toContain('Total Cost:')
    expect(output).toContain('Total Tokens:')
    expect(output).toContain('LLM Calls:')
    expect(output).toContain('whisper')
  })

  test('formatReport shows multi-agent breakdown', () => {
    costTracker.setAgent('AgentA')
    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })

    costTracker.setAgent('AgentB')
    costTracker.recordUsage('openai', 'gpt-4o-mini', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    })

    const output = costTracker.formatReport()
    expect(output).toContain('By Agent:')
    expect(output).toContain('AgentA')
    expect(output).toContain('AgentB')
    expect(output).toContain('By Model:')
    expect(output).toContain('gpt-4o')
    expect(output).toContain('gpt-4o-mini')
  })

  test('formatReport shows PRUs for copilot provider', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('copilot', 'claude-sonnet-4', {
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
    })

    const output = costTracker.formatReport()
    expect(output).toContain('Total PRUs:')
    expect(output).toContain('premium requests')
  })

  test('formatReport includes quota info when provided', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage(
      'copilot',
      'claude-sonnet-4',
      { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      undefined,
      undefined,
      {
        isUnlimitedEntitlement: false,
        usedRequests: 42,
        entitlementRequests: 300,
        remainingPercentage: 86.0,
        resetDate: '2026-03-01',
        overage: 0,
      },
    )

    const output = costTracker.formatReport()
    expect(output).toContain('Copilot Quota:')
    expect(output).toContain('86.0%')
    expect(output).toContain('42/300')
    expect(output).toContain('2026-03-01')
  })

  // ── reset ─────────────────────────────────────────────────────────────

  test('reset clears all data', () => {
    costTracker.setAgent('TestAgent')
    costTracker.setStage('ingestion')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })
    costTracker.recordServiceUsage('whisper', 0.01)

    costTracker.reset()

    const report = costTracker.getReport()
    expect(report.records).toHaveLength(0)
    expect(report.serviceRecords).toHaveLength(0)
    expect(report.totalCostUSD).toBe(0)
    expect(report.totalPRUs).toBe(0)
    expect(report.totalTokens.total).toBe(0)
    expect(report.copilotQuota).toBeUndefined()
  })

  // ── setAgent / setStage ───────────────────────────────────────────────

  test('setAgent and setStage affect subsequent records', () => {
    costTracker.setAgent('FirstAgent')
    costTracker.setStage('stage-1')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    })

    costTracker.setAgent('SecondAgent')
    costTracker.setStage('stage-2')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
    })

    const report = costTracker.getReport()
    expect(report.records[0].agent).toBe('FirstAgent')
    expect(report.records[0].stage).toBe('stage-1')
    expect(report.records[1].agent).toBe('SecondAgent')
    expect(report.records[1].stage).toBe('stage-2')
  })

  // ── Multiple providers ────────────────────────────────────────────────

  test('multiple providers aggregate correctly', () => {
    costTracker.setAgent('TestAgent')

    costTracker.recordUsage('openai', 'gpt-4o', {
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
    })

    costTracker.recordUsage('copilot', 'claude-sonnet-4', {
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
    })

    costTracker.recordUsage('openai', 'gpt-4o-mini', {
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
    })

    const report = costTracker.getReport()
    expect(report.byProvider['openai'].calls).toBe(2)
    expect(report.byProvider['copilot'].calls).toBe(1)
    expect(report.totalTokens.total).toBe(750 + 450 + 1500)
    expect(report.totalCostUSD).toBeGreaterThan(0)
    expect(report.totalPRUs).toBeGreaterThan(0)
  })
})

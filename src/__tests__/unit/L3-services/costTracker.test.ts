import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRecordLLMCost,
  mockRecordServiceCost,
  mockGetCostsSince,
} = vi.hoisted(() => ({
  mockRecordLLMCost: vi.fn(),
  mockRecordServiceCost: vi.fn(),
  mockGetCostsSince: vi.fn(),
}))

vi.mock('../../../L2-clients/dataStore/costStore.js', () => ({
  recordLLMCost: mockRecordLLMCost,
  recordServiceCost: mockRecordServiceCost,
  getCostsSince: mockGetCostsSince,
}))

import logger from '../../../L1-infra/logger/configLogger.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'

describe('CostTracker service costs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCostsSince.mockReturnValue([])
    costTracker.reset()
  })

  it('recordServiceUsage records service usage', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.0252, { durationSeconds: 252 })

    const report = costTracker.getReport()

    expect(report.serviceRecords).toHaveLength(1)
    expect(report.serviceRecords[0].service).toBe('whisper')
    expect(report.serviceRecords[0].stage).toBe('transcription')
    expect(report.serviceRecords[0].costUSD).toBe(0.0252)
    expect(report.serviceRecords[0].metadata).toEqual({ durationSeconds: 252 })
    expect(report.totalServiceCostUSD).toBe(0.0252)
    expect(report.byService.whisper.costUSD).toBe(0.0252)
    expect(report.byService.whisper.calls).toBe(1)
    expect(mockRecordServiceCost).toHaveBeenCalledWith({
      runId: 'unknown',
      service: 'whisper',
      stage: 'transcription',
      costAmount: 0.0252,
      metadata: { durationSeconds: 252 },
    })
  })

  it('service costs included in totalCostUSD', () => {
    costTracker.recordUsage('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    costTracker.recordServiceUsage('whisper', 0.05)

    const report = costTracker.getReport()

    expect(report.totalCostUSD).toBeGreaterThan(report.totalServiceCostUSD)
    expect(report.totalServiceCostUSD).toBe(0.05)
    expect(report.totalCostUSD - report.totalServiceCostUSD).toBeGreaterThan(0)
    expect(mockRecordLLMCost).toHaveBeenCalledTimes(1)
    expect(mockRecordServiceCost).toHaveBeenCalledTimes(1)
  })

  it('setRunId applies to persisted LLM and service records', () => {
    costTracker.setRunId('run-123')
    costTracker.setAgent('SummaryAgent')
    costTracker.setStage('summary')

    costTracker.recordUsage('openai', 'gpt-4o', { inputTokens: 120, outputTokens: 30, totalTokens: 150 }, undefined, 800)
    costTracker.recordServiceUsage('whisper', 0.03, { durationSeconds: 300 })

    expect(mockRecordLLMCost).toHaveBeenCalledWith({
      runId: 'run-123',
      provider: 'openai',
      model: 'gpt-4o',
      agent: 'SummaryAgent',
      stage: 'summary',
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      costAmount: expect.any(Number),
      costUnit: 'usd',
      durationMs: 800,
    })
    expect(mockRecordServiceCost).toHaveBeenCalledWith({
      runId: 'run-123',
      service: 'whisper',
      stage: 'summary',
      costAmount: 0.03,
      metadata: { durationSeconds: 300 },
    })
  })

  it('multiple service records aggregate correctly', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.03, { durationSeconds: 300 })

    costTracker.setStage('social-media')
    costTracker.recordServiceUsage('exa', 0.001)
    costTracker.recordServiceUsage('exa', 0.001)
    costTracker.recordServiceUsage('exa', 0.001)

    const report = costTracker.getReport()

    expect(report.serviceRecords).toHaveLength(4)
    expect(report.byService.whisper.costUSD).toBe(0.03)
    expect(report.byService.whisper.calls).toBe(1)
    expect(report.byService.exa.costUSD).toBeCloseTo(0.003)
    expect(report.byService.exa.calls).toBe(3)
    expect(report.totalServiceCostUSD).toBeCloseTo(0.033)
    expect(mockRecordServiceCost).toHaveBeenCalledTimes(4)
  })

  it('getHistoricalCosts delegates to getCostsSince', () => {
    const historicalRows = [
      {
        id: 1,
        run_id: 'run-1',
        timestamp: '2026-01-01 00:00:00',
        record_type: 'llm' as const,
        provider: 'openai',
        model: 'gpt-4o',
        agent: 'SummaryAgent',
        stage: 'summary',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_amount: 0.25,
        cost_unit: 'usd',
        duration_ms: 900,
        service_name: null,
        metadata: null,
        created_at: '2026-01-01 00:00:00',
      },
    ]
    mockGetCostsSince.mockReturnValue(historicalRows)

    expect(costTracker.getHistoricalCosts()).toEqual(historicalRows)
    expect(mockGetCostsSince).toHaveBeenCalledWith('1970-01-01 00:00:00')

    costTracker.getHistoricalCosts('2026-01-01 00:00:00')
    expect(mockGetCostsSince).toHaveBeenLastCalledWith('2026-01-01 00:00:00')
  })

  it('persistence failures log warnings without breaking in-memory accumulation', () => {
    mockRecordLLMCost.mockImplementationOnce(() => {
      throw new Error('db unavailable')
    })
    mockRecordServiceCost.mockImplementationOnce(() => {
      throw new Error('db unavailable')
    })

    costTracker.setAgent('TestAgent')
    costTracker.setStage('transcription')
    costTracker.recordUsage('openai', 'gpt-4o', { inputTokens: 100, outputTokens: 50, totalTokens: 150 })
    costTracker.recordServiceUsage('whisper', 0.05)

    const report = costTracker.getReport()

    expect(report.records).toHaveLength(1)
    expect(report.serviceRecords).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      '[CostTracker] Failed to persist LLM cost for run unknown: db unavailable',
    )
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      '[CostTracker] Failed to persist service cost for run unknown: db unavailable',
    )
  })

  it('reset clears service records and resets the runId', () => {
    costTracker.setRunId('run-to-reset')
    costTracker.recordServiceUsage('whisper', 0.05)
    costTracker.recordServiceUsage('exa', 0.001)

    costTracker.reset()
    costTracker.recordServiceUsage('post-reset-service', 0.002)

    const report = costTracker.getReport()
    expect(report.serviceRecords).toHaveLength(1)
    expect(report.totalServiceCostUSD).toBe(0.002)
    expect(report.byService).toEqual({
      'post-reset-service': {
        calls: 1,
        costUSD: 0.002,
      },
    })
    expect(mockRecordServiceCost).toHaveBeenLastCalledWith({
      runId: 'unknown',
      service: 'post-reset-service',
      stage: 'unknown',
      costAmount: 0.002,
      metadata: {},
    })
  })

  it('formatReport includes service section', () => {
    costTracker.setStage('transcription')
    costTracker.recordServiceUsage('whisper', 0.0252, { durationSeconds: 252 })

    const output = costTracker.formatReport()

    expect(output).toContain('By Service:')
    expect(output).toContain('whisper')
  })
})

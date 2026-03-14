import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeDatabase, getDatabase, resetDatabaseSingleton } from '../../../../L1-infra/database/database.js'
import {
  deleteRunCosts,
  getAllRunIds,
  getCostsSince,
  getRunCosts,
  getRunSummary,
  recordLLMCost,
  recordServiceCost,
} from '../../../../L2-clients/dataStore/costStore.js'

const createCostRecordsTableSql = `
  CREATE TABLE cost_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    record_type     TEXT NOT NULL CHECK (record_type IN ('llm','service')),
    provider        TEXT,
    model           TEXT,
    agent           TEXT,
    stage           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER,
    total_tokens    INTEGER,
    cost_amount     REAL NOT NULL,
    cost_unit       TEXT NOT NULL,
    duration_ms     INTEGER,
    service_name    TEXT,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  )
`

function initializeInMemoryDatabase(): void {
  const db = getDatabase({ inMemory: true })
  db.exec(createCostRecordsTableSql)
}

describe('costStore', () => {
  beforeEach(() => {
    closeDatabase()
    resetDatabaseSingleton()
    initializeInMemoryDatabase()
  })

  afterEach(() => {
    closeDatabase()
    resetDatabaseSingleton()
  })

  it('costStore.REQ-001: recordLLMCost stores LLM fields in cost_records', () => {
    recordLLMCost({
      runId: 'run-llm',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'SummaryAgent',
      stage: 'summary',
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      costAmount: 0.42,
      costUnit: 'usd',
      durationMs: 2500,
    })

    const rows = getRunCosts('run-llm')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      run_id: 'run-llm',
      record_type: 'llm',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'SummaryAgent',
      stage: 'summary',
      input_tokens: 120,
      output_tokens: 30,
      total_tokens: 150,
      cost_amount: 0.42,
      cost_unit: 'usd',
      duration_ms: 2500,
      service_name: null,
      metadata: null,
    })
  })

  it('costStore.REQ-002: recordServiceCost stores usd service rows with JSON metadata', () => {
    recordServiceCost({
      runId: 'run-service',
      service: 'web-search',
      stage: 'social-media',
      costAmount: 1.5,
      metadata: { query: 'primer design system', hits: 3 },
    })

    const rows = getRunCosts('run-service')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      run_id: 'run-service',
      record_type: 'service',
      stage: 'social-media',
      cost_amount: 1.5,
      cost_unit: 'usd',
      service_name: 'web-search',
    })
    expect(rows[0].metadata).toBe('{"query":"primer design system","hits":3}')
  })

  it('costStore.REQ-003: getRunCosts returns run rows ordered by timestamp', () => {
    const db = getDatabase()
    const insertStatement = db.prepare(
      `
        INSERT INTO cost_records (run_id, timestamp, record_type, stage, cost_amount, cost_unit)
        VALUES (?, ?, 'service', 'summary', 1, 'usd')
      `,
    )

    insertStatement.run('run-ordered', '2025-01-01 00:00:00')
    insertStatement.run('run-ordered', '2025-01-02 00:00:00')

    const rows = getRunCosts('run-ordered')

    expect(rows.map((row) => row.timestamp)).toEqual([
      '2025-01-01 00:00:00',
      '2025-01-02 00:00:00',
    ])
  })

  it('costStore.REQ-004: getRunSummary aggregates USD, PRUs, tokens, and call counts for a run', () => {
    recordLLMCost({
      runId: 'run-summary',
      provider: 'copilot',
      model: 'claude-sonnet-4.5',
      agent: 'ShortsAgent',
      stage: 'shorts',
      inputTokens: 200,
      outputTokens: 50,
      totalTokens: 250,
      costAmount: 3,
      costUnit: 'premium_requests',
    })
    recordLLMCost({
      runId: 'run-summary',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'SummaryAgent',
      stage: 'summary',
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      costAmount: 0.75,
      costUnit: 'usd',
      durationMs: 1200,
    })
    recordServiceCost({
      runId: 'run-summary',
      service: 'web-search',
      stage: 'social-media',
      costAmount: 0.5,
    })

    const summary = getRunSummary('run-summary')

    expect(summary).toEqual({
      totalCostUSD: 1.25,
      totalPRUs: 3,
      totalTokens: {
        input: 300,
        output: 75,
        total: 375,
      },
      llmCalls: 2,
      serviceCalls: 1,
    })
  })

  it('costStore.REQ-005: getAllRunIds returns unique run IDs ordered by first timestamp descending', () => {
    const db = getDatabase()
    const insertStatement = db.prepare(
      `
        INSERT INTO cost_records (run_id, timestamp, record_type, stage, cost_amount, cost_unit)
        VALUES (?, ?, 'service', 'summary', 1, 'usd')
      `,
    )

    insertStatement.run('run-oldest', '2025-01-01 00:00:00')
    insertStatement.run('run-newest', '2025-02-01 00:00:00')
    insertStatement.run('run-middle', '2025-01-15 00:00:00')
    insertStatement.run('run-newest', '2025-02-03 00:00:00')

    expect(getAllRunIds()).toEqual(['run-newest', 'run-middle', 'run-oldest'])
  })

  it('costStore.REQ-006: getCostsSince returns records on or after the provided timestamp', () => {
    const db = getDatabase()
    const insertStatement = db.prepare(
      `
        INSERT INTO cost_records (run_id, timestamp, record_type, stage, cost_amount, cost_unit)
        VALUES (?, ?, 'service', 'summary', 1, 'usd')
      `,
    )

    insertStatement.run('run-before', '2025-01-01 00:00:00')
    insertStatement.run('run-after', '2025-01-02 00:00:00')
    insertStatement.run('run-latest', '2025-01-03 00:00:00')

    const rows = getCostsSince('2025-01-02 00:00:00')

    expect(rows.map((row) => row.run_id)).toEqual(['run-after', 'run-latest'])
  })

  it('costStore.REQ-007: deleteRunCosts removes a run and returns the affected row count', () => {
    recordServiceCost({
      runId: 'run-delete',
      service: 'web-search',
      stage: 'social-media',
      costAmount: 1,
    })
    recordLLMCost({
      runId: 'run-delete',
      provider: 'openai',
      model: 'gpt-5.1',
      agent: 'BlogAgent',
      stage: 'blog',
      inputTokens: 40,
      outputTokens: 10,
      totalTokens: 50,
      costAmount: 0.1,
      costUnit: 'usd',
    })

    const deletedRows = deleteRunCosts('run-delete')

    expect(deletedRows).toBe(2)
    expect(getRunCosts('run-delete')).toEqual([])
  })
})

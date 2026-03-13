import { getDatabase } from '../../L1-infra/database/database.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface LLMCostRecord {
  runId: string
  provider: string
  model: string
  agent: string
  stage: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costAmount: number
  costUnit: 'usd' | 'premium_requests'
  durationMs?: number
}

export interface ServiceCostRecord {
  runId: string
  service: string
  stage: string
  costAmount: number
  metadata?: Record<string, unknown>
}

export interface CostRecordRow {
  id: number
  run_id: string
  timestamp: string
  record_type: 'llm' | 'service'
  provider: string | null
  model: string | null
  agent: string | null
  stage: string | null
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number | null
  cost_amount: number
  cost_unit: string
  duration_ms: number | null
  service_name: string | null
  metadata: string | null
  created_at: string
}

export interface CostSummary {
  totalCostUSD: number
  totalPRUs: number
  totalTokens: { input: number; output: number; total: number }
  llmCalls: number
  serviceCalls: number
}

interface CostSummaryRow {
  total_cost_usd: number | null
  total_prus: number | null
  total_input_tokens: number | null
  total_output_tokens: number | null
  total_tokens: number | null
  llm_calls: number | null
  service_calls: number | null
}

const insertLLMCostSql = `
  INSERT INTO cost_records (
    run_id,
    record_type,
    provider,
    model,
    agent,
    stage,
    input_tokens,
    output_tokens,
    total_tokens,
    cost_amount,
    cost_unit,
    duration_ms
  ) VALUES (?, 'llm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const insertServiceCostSql = `
  INSERT INTO cost_records (
    run_id,
    record_type,
    stage,
    cost_amount,
    cost_unit,
    service_name,
    metadata
  ) VALUES (?, 'service', ?, ?, 'usd', ?, ?)
`

const selectRunCostsSql = `
  SELECT *
  FROM cost_records
  WHERE run_id = ?
  ORDER BY timestamp
`

const selectRunSummarySql = `
  SELECT
    COALESCE(SUM(CASE WHEN cost_unit = 'usd' THEN cost_amount ELSE 0 END), 0) AS total_cost_usd,
    COALESCE(SUM(CASE WHEN cost_unit = 'premium_requests' THEN cost_amount ELSE 0 END), 0) AS total_prus,
    COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
    COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
    COALESCE(SUM(total_tokens), 0) AS total_tokens,
    COALESCE(SUM(CASE WHEN record_type = 'llm' THEN 1 ELSE 0 END), 0) AS llm_calls,
    COALESCE(SUM(CASE WHEN record_type = 'service' THEN 1 ELSE 0 END), 0) AS service_calls
  FROM cost_records
  WHERE run_id = ?
`

const selectAllRunIdsSql = `
  SELECT run_id
  FROM cost_records
  GROUP BY run_id
  ORDER BY MIN(timestamp) DESC
`

const selectCostsSinceSql = `
  SELECT *
  FROM cost_records
  WHERE timestamp >= ?
  ORDER BY timestamp
`

const deleteRunCostsSql = `
  DELETE FROM cost_records
  WHERE run_id = ?
`

function toCostSummary(row?: CostSummaryRow): CostSummary {
  return {
    totalCostUSD: row?.total_cost_usd ?? 0,
    totalPRUs: row?.total_prus ?? 0,
    totalTokens: {
      input: row?.total_input_tokens ?? 0,
      output: row?.total_output_tokens ?? 0,
      total: row?.total_tokens ?? 0,
    },
    llmCalls: row?.llm_calls ?? 0,
    serviceCalls: row?.service_calls ?? 0,
  }
}

/**
 * Insert an LLM cost record for a pipeline run.
 */
export function recordLLMCost(record: LLMCostRecord): void {
  const db = getDatabase()
  const statement = db.prepare(insertLLMCostSql)

  statement.run(
    record.runId,
    record.provider,
    record.model,
    record.agent,
    record.stage,
    record.inputTokens,
    record.outputTokens,
    record.totalTokens,
    record.costAmount,
    record.costUnit,
    record.durationMs ?? null,
  )

  logger.debug('[CostStore] Recorded LLM cost entry')
}

/**
 * Insert a service cost record for a pipeline run.
 */
export function recordServiceCost(record: ServiceCostRecord): void {
  const db = getDatabase()
  const statement = db.prepare(insertServiceCostSql)
  const metadata = record.metadata === undefined ? null : JSON.stringify(record.metadata)

  statement.run(
    record.runId,
    record.stage,
    record.costAmount,
    record.service,
    metadata,
  )

  logger.debug('[CostStore] Recorded service cost entry')
}

/**
 * Return all cost records for a run ordered by timestamp.
 */
export function getRunCosts(runId: string): CostRecordRow[] {
  const db = getDatabase()
  const statement = db.prepare(selectRunCostsSql)

  return statement.all(runId) as unknown as CostRecordRow[]
}

/**
 * Return aggregated cost totals and call counts for a run.
 */
export function getRunSummary(runId: string): CostSummary {
  const db = getDatabase()
  const statement = db.prepare(selectRunSummarySql)
  const row = statement.get(runId) as unknown as CostSummaryRow | undefined

  return toCostSummary(row)
}

/**
 * Return distinct run IDs ordered by their first recorded timestamp descending.
 */
export function getAllRunIds(): string[] {
  const db = getDatabase()
  const statement = db.prepare(selectAllRunIdsSql)
  const rows = statement.all() as Array<{ run_id: string }>

  return rows.map((row) => row.run_id)
}

/**
 * Return all cost records on or after the provided timestamp.
 */
export function getCostsSince(since: string): CostRecordRow[] {
  const db = getDatabase()
  const statement = db.prepare(selectCostsSinceSql)

  return statement.all(since) as unknown as CostRecordRow[]
}

/**
 * Delete all cost records for a run and return the number of affected rows.
 */
export function deleteRunCosts(runId: string): number {
  const db = getDatabase()
  const statement = db.prepare(deleteRunCostsSql)
  const result = statement.run(runId)
  const deletedRows = Number(result.changes)

  logger.debug(`[CostStore] Deleted ${deletedRows} cost record(s)`)

  return deletedRows
}

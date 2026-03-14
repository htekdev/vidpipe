import { getDatabase } from '../../L1-infra/database/database.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface PipelineRunRow {
  run_id: string
  slug: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  completed_at: string | null
  stage_results: string | null
  total_duration: number | null
  error: string | null
}

/**
 * Insert a new pipeline run in the running state.
 */
export function createPipelineRun(runId: string, slug: string): void {
  const db = getDatabase()
  const statement = db.prepare(`
    INSERT INTO pipeline_runs (run_id, slug, status)
    VALUES (?, ?, 'running')
  `)

  statement.run(runId, slug)
  logger.debug(`[PipelineRunStore] Created pipeline run ${runId} for ${slug}`)
}

/**
 * Mark a pipeline run as completed and persist serialized stage results.
 */
export function completePipelineRun(runId: string, stageResults: unknown[], totalDuration: number): void {
  const db = getDatabase()
  const statement = db.prepare(`
    UPDATE pipeline_runs
    SET status = 'completed',
        completed_at = datetime('now'),
        stage_results = ?,
        total_duration = ?,
        error = NULL
    WHERE run_id = ?
  `)

  statement.run(JSON.stringify(stageResults), totalDuration, runId)
  logger.debug(`[PipelineRunStore] Completed pipeline run ${runId}`)
}

/**
 * Mark a pipeline run as failed and optionally persist partial stage results.
 */
export function failPipelineRun(runId: string, error: string, stageResults?: unknown[]): void {
  const db = getDatabase()

  if (stageResults !== undefined) {
    const statement = db.prepare(`
      UPDATE pipeline_runs
      SET status = 'failed',
          completed_at = datetime('now'),
          error = ?,
          stage_results = ?
      WHERE run_id = ?
    `)

    statement.run(error, JSON.stringify(stageResults), runId)
  } else {
    const statement = db.prepare(`
      UPDATE pipeline_runs
      SET status = 'failed',
          completed_at = datetime('now'),
          error = ?
      WHERE run_id = ?
    `)

    statement.run(error, runId)
  }

  logger.debug(`[PipelineRunStore] Failed pipeline run ${runId}`)
}

/**
 * Fetch a pipeline run by its run ID.
 */
export function getPipelineRun(runId: string): PipelineRunRow | undefined {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT run_id, slug, status, started_at, completed_at, stage_results, total_duration, error
    FROM pipeline_runs
    WHERE run_id = ?
  `)

  return statement.get(runId) as unknown as PipelineRunRow | undefined
}

/**
 * Fetch all runs for a slug, newest first.
 */
export function getRunsBySlug(slug: string): PipelineRunRow[] {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT run_id, slug, status, started_at, completed_at, stage_results, total_duration, error
    FROM pipeline_runs
    WHERE slug = ?
    ORDER BY started_at DESC
  `)

  return statement.all(slug) as unknown as PipelineRunRow[]
}

/**
 * Fetch the most recent pipeline runs.
 */
export function getRecentRuns(limit = 20): PipelineRunRow[] {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT run_id, slug, status, started_at, completed_at, stage_results, total_duration, error
    FROM pipeline_runs
    ORDER BY started_at DESC
    LIMIT ?
  `)

  return statement.all(limit) as unknown as PipelineRunRow[]
}

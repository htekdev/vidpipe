import { getDatabase } from '../../L1-infra/database/database.js'
import logger from '../../L1-infra/logger/configLogger.js'

export type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface VideoRow {
  slug: string
  source_path: string
  status: VideoStatus
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
  updated_at: string
}

function mapVideoRow(row: unknown): VideoRow | undefined {
  return row as VideoRow | undefined
}

function mapVideoRows(rows: unknown): VideoRow[] {
  return rows as unknown as VideoRow[]
}

/**
 * Get a single video row by slug.
 */
export function getVideo(slug: string): VideoRow | undefined {
  const db = getDatabase()
  const statement = db.prepare('SELECT * FROM videos WHERE slug = ?')
  const row = statement.get(slug)
  return mapVideoRow(row)
}

/**
 * Get all videos with the provided status.
 */
export function getVideosByStatus(status: VideoStatus): VideoRow[] {
  const db = getDatabase()
  const statement = db.prepare('SELECT * FROM videos WHERE status = ? ORDER BY created_at DESC')
  return mapVideoRows(statement.all(status))
}

/**
 * Get videos that are still pending work or previously failed.
 */
export function getUnprocessedVideos(): VideoRow[] {
  const db = getDatabase()
  const statement = db.prepare("SELECT * FROM videos WHERE status IN ('pending', 'failed') ORDER BY created_at DESC")
  return mapVideoRows(statement.all())
}

/**
 * Check whether the given video has completed processing.
 */
export function isVideoCompleted(slug: string): boolean {
  return getVideo(slug)?.status === 'completed'
}

/**
 * Insert a new video row or update an existing row while preserving created_at.
 */
export function upsertVideo(slug: string, sourcePath: string, status: VideoStatus): void {
  const db = getDatabase()
  const statement = db.prepare(`
    INSERT INTO videos (
      slug,
      source_path,
      status,
      started_at,
      completed_at,
      error,
      created_at,
      updated_at
    )
    VALUES (
      ?,
      ?,
      ?,
      NULL,
      NULL,
      NULL,
      COALESCE((SELECT created_at FROM videos WHERE slug = ?), datetime('now')),
      datetime('now')
    )
    ON CONFLICT(slug) DO UPDATE SET
      source_path = excluded.source_path,
      status = excluded.status,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      error = excluded.error,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `)

  statement.run(slug, sourcePath, status, slug)
  logger.debug(`[VideoStore] Upserted video ${slug} with status ${status}`)
}

/**
 * Update a video's status and any supplied timestamp or error fields.
 */
export function updateVideoStatus(
  slug: string,
  status: VideoStatus,
  extras?: { startedAt?: string; completedAt?: string; error?: string },
): void {
  const db = getDatabase()
  const statement = db.prepare(`
    UPDATE videos
    SET
      status = ?,
      started_at = COALESCE(?, started_at),
      completed_at = COALESCE(?, completed_at),
      error = COALESCE(?, error),
      updated_at = datetime('now')
    WHERE slug = ?
  `)

  const result = statement.run(
    status,
    extras?.startedAt ?? null,
    extras?.completedAt ?? null,
    extras?.error ?? null,
    slug,
  )

  if (result.changes === 0) {
    logger.warn(`[VideoStore] No video found for status update: ${slug}`)
    return
  }

  logger.debug(`[VideoStore] Updated video ${slug} to status ${status}`)
}

/**
 * Get every video row ordered by newest first.
 */
export function getAllVideos(): VideoRow[] {
  const db = getDatabase()
  const statement = db.prepare('SELECT * FROM videos ORDER BY created_at DESC')
  return mapVideoRows(statement.all())
}

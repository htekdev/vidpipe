import { getDatabase } from '../../L1-infra/database/database.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface QueueItemRow {
  id: string
  platform: string
  account_id: string
  source_video: string
  source_clip: string | null
  clip_type: 'video' | 'short' | 'medium-clip'
  source_media_path: string | null
  media_type: 'video' | 'image' | null
  hashtags: string | null
  links: string | null
  character_count: number
  platform_char_limit: number
  suggested_slot: string | null
  scheduled_for: string | null
  status: 'pending_review' | 'published'
  late_post_id: string | null
  published_url: string | null
  post_content: string
  text_only: number | null
  platform_specific: string | null
  media_folder_path: string | null
  created_at: string
  reviewed_at: string | null
  published_at: string | null
}

export interface QueueItemInsert {
  id: string
  platform: string
  account_id: string
  source_video: string
  source_clip: string | null
  clip_type: 'video' | 'short' | 'medium-clip'
  source_media_path: string | null
  media_type?: 'video' | 'image'
  hashtags: string[]
  links: Array<{ url: string; title?: string }>
  character_count: number
  platform_char_limit: number
  suggested_slot: string | null
  scheduled_for: string | null
  status: 'pending_review' | 'published'
  late_post_id: string | null
  published_url: string | null
  post_content: string
  text_only?: boolean
  platform_specific?: Record<string, unknown>
  media_folder_path: string | null
}

interface MarkPublishedInput {
  latePostId: string
  scheduledFor: string
  publishedUrl?: string
  accountId?: string
}

type QueueStoreValue = string | number | null

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

function toSqliteBoolean(value: boolean | undefined): number | null {
  if (value === undefined) return null
  return value ? 1 : 0
}

function hasOwnProperty(object: object, key: keyof QueueItemInsert): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function mapInsertValue(key: keyof QueueItemInsert, item: QueueItemInsert): QueueStoreValue {
  switch (key) {
    case 'hashtags':
      return toJson(item.hashtags)
    case 'links':
      return toJson(item.links)
    case 'platform_specific':
      return item.platform_specific === undefined ? null : toJson(item.platform_specific)
    case 'text_only':
      return toSqliteBoolean(item.text_only)
    case 'media_type':
      return item.media_type ?? null
    default:
      return (item[key] ?? null) as QueueStoreValue
  }
}

function mapUpdateValue(key: keyof QueueItemInsert, updates: Partial<QueueItemInsert>): QueueStoreValue {
  switch (key) {
    case 'hashtags':
      return updates.hashtags === undefined ? null : toJson(updates.hashtags)
    case 'links':
      return updates.links === undefined ? null : toJson(updates.links)
    case 'platform_specific':
      return updates.platform_specific === undefined ? null : toJson(updates.platform_specific)
    case 'text_only':
      return toSqliteBoolean(updates.text_only)
    case 'media_type':
      return updates.media_type ?? null
    default:
      return (updates[key] ?? null) as QueueStoreValue
  }
}

const insertColumns = [
  'id',
  'platform',
  'account_id',
  'source_video',
  'source_clip',
  'clip_type',
  'source_media_path',
  'media_type',
  'hashtags',
  'links',
  'character_count',
  'platform_char_limit',
  'suggested_slot',
  'scheduled_for',
  'status',
  'late_post_id',
  'published_url',
  'post_content',
  'text_only',
  'platform_specific',
  'media_folder_path',
] as const satisfies readonly (keyof QueueItemInsert)[]

/**
 * Get a queue item by primary key.
 */
export function getQueueItem(id: string): QueueItemRow | undefined {
  const db = getDatabase()
  const statement = db.prepare('SELECT * FROM queue_items WHERE id = ?')
  return statement.get(id) as QueueItemRow | undefined
}

/**
 * Get queue items for a status, prioritizing rows with media folders.
 */
export function getItemsByStatus(status: 'pending_review' | 'published'): QueueItemRow[] {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT *
    FROM queue_items
    WHERE status = ?
    ORDER BY media_folder_path IS NULL ASC, created_at ASC, id ASC
  `)
  return statement.all(status) as unknown as QueueItemRow[]
}

/**
 * Insert a queue item row into SQLite.
 */
export function insertQueueItem(item: QueueItemInsert): void {
  const db = getDatabase()
  const placeholders = insertColumns.map(() => '?').join(', ')
  const sql = `
    INSERT INTO queue_items (${insertColumns.join(', ')})
    VALUES (${placeholders})
  `
  const values = insertColumns.map((column) => mapInsertValue(column, item))

  db.prepare(sql).run(...values)
  logger.debug(`[QueueStore] Inserted queue item ${item.id}`)
}

/**
 * Update only the provided queue item fields.
 */
export function updateQueueItem(id: string, updates: Partial<QueueItemInsert>): void {
  const db = getDatabase()
  const entries = (Object.keys(updates) as Array<keyof QueueItemInsert>)
    .filter((key) => hasOwnProperty(updates, key))
    .map((key) => ({ key, value: mapUpdateValue(key, updates) }))

  if (entries.length === 0) {
    logger.debug(`[QueueStore] No updates applied for queue item ${id}`)
    return
  }

  const setClause = entries.map(({ key }) => `${key} = ?`).join(', ')
  const values = entries.map(({ value }) => value)

  db.prepare(`UPDATE queue_items SET ${setClause} WHERE id = ?`).run(...values, id)
  logger.debug(`[QueueStore] Updated queue item ${id}`)
}

/**
 * Mark a queue item as published with the latest publishing metadata.
 */
export function markPublished(id: string, publishData: MarkPublishedInput): void {
  const db = getDatabase()
  const statement = db.prepare(`
    UPDATE queue_items
    SET status = 'published',
        late_post_id = ?,
        scheduled_for = ?,
        published_url = ?,
        account_id = COALESCE(?, account_id),
        published_at = datetime('now'),
        reviewed_at = datetime('now')
    WHERE id = ?
  `)

  statement.run(
    publishData.latePostId,
    publishData.scheduledFor,
    publishData.publishedUrl ?? null,
    publishData.accountId ?? null,
    id,
  )
  logger.debug(`[QueueStore] Marked queue item ${id} as published`)
}

/**
 * Delete a queue item by primary key.
 */
export function deleteQueueItem(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM queue_items WHERE id = ?').run(id)
  logger.debug(`[QueueStore] Deleted queue item ${id}`)
}

/**
 * Check whether a queue item exists and return its current status.
 */
export function itemExists(id: string): 'pending_review' | 'published' | null {
  const db = getDatabase()
  const row = db.prepare('SELECT status FROM queue_items WHERE id = ?').get(id) as
    | { status: 'pending_review' | 'published' }
    | undefined

  return row?.status ?? null
}

/**
 * Get all queue items generated from the same source video.
 */
export function getItemsBySourceVideo(sourceVideo: string): QueueItemRow[] {
  const db = getDatabase()
  const statement = db.prepare('SELECT * FROM queue_items WHERE source_video = ? ORDER BY created_at ASC, id ASC')
  return statement.all(sourceVideo) as unknown as QueueItemRow[]
}

/**
 * Count queue items grouped by status.
 */
export function countByStatus(): { pending_review: number; published: number } {
  const db = getDatabase()
  const rows = db.prepare('SELECT status, COUNT(*) as count FROM queue_items GROUP BY status').all() as Array<{
    status: 'pending_review' | 'published'
    count: number
  }>

  const counts = {
    pending_review: 0,
    published: 0,
  }

  for (const row of rows) {
    counts[row.status] = row.count
  }

  return counts
}

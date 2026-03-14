import { getDatabase } from '../../L1-infra/database/database.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface AccountCacheRow {
  platform: string
  account_id: string
  fetched_at: string
}

function sqliteTimestampToMs(value: string): number {
  return new Date(value.replace(' ', 'T') + 'Z').getTime()
}

/**
 * Return cached account IDs when all entries are fresher than the requested age.
 */
export function getCachedAccounts(maxAgeMs: number): Record<string, string> | null {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT platform, account_id, fetched_at
    FROM account_cache
  `)
  const rows = statement.all() as unknown as AccountCacheRow[]

  const nowMs = Date.now()
  const mapping: Record<string, string> = {}

  for (const row of rows) {
    const fetchedAtMs = sqliteTimestampToMs(row.fetched_at)
    if (!Number.isFinite(fetchedAtMs) || nowMs - fetchedAtMs > maxAgeMs) {
      return null
    }

    mapping[row.platform] = row.account_id
  }

  return mapping
}

/**
 * Replace the cached account mapping in a single transaction.
 */
export function setCachedAccounts(mapping: Record<string, string>): void {
  const db = getDatabase()
  const deleteStatement = db.prepare('DELETE FROM account_cache')
  const insertStatement = db.prepare(`
    INSERT INTO account_cache (platform, account_id)
    VALUES (?, ?)
  `)

  db.exec('BEGIN')

  try {
    deleteStatement.run()

    for (const [platform, accountId] of Object.entries(mapping)) {
      insertStatement.run(platform, accountId)
    }

    db.exec('COMMIT')
    logger.debug(`[AccountCacheStore] Cached ${Object.keys(mapping).length} account mappings`)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/**
 * Remove all cached account rows.
 */
export function clearAccountCache(): void {
  const db = getDatabase()
  const statement = db.prepare('DELETE FROM account_cache')

  statement.run()
  logger.debug('[AccountCacheStore] Cleared account cache')
}

/**
 * Return the age in milliseconds of the oldest cache entry.
 */
export function getCacheAge(): number | null {
  const db = getDatabase()
  const statement = db.prepare(`
    SELECT platform, account_id, fetched_at
    FROM account_cache
  `)
  const rows = statement.all() as unknown as AccountCacheRow[]

  if (rows.length === 0) {
    return null
  }

  let oldestFetchedAtMs = Number.POSITIVE_INFINITY

  for (const row of rows) {
    const fetchedAtMs = sqliteTimestampToMs(row.fetched_at)
    if (!Number.isFinite(fetchedAtMs)) {
      return null
    }

    oldestFetchedAtMs = Math.min(oldestFetchedAtMs, fetchedAtMs)
  }

  return Date.now() - oldestFetchedAtMs
}

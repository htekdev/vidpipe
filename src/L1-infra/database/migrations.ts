import type { DatabaseSync } from 'node:sqlite'
import logger from '../logger/configLogger.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface Migration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
}

// ── Migration Runner ───────────────────────────────────────────────────────

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
}

function getAppliedVersions(db: DatabaseSync): Set<number> {
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
  return new Set(rows.map(r => r.version))
}

/**
 * Run all pending migrations in order.
 * Each migration runs in its own transaction for atomicity.
 * Returns the number of migrations applied.
 */
export function runMigrations(db: DatabaseSync, migrations: Migration[]): number {
  ensureMigrationsTable(db)
  const applied = getAppliedVersions(db)

  // Sort migrations by version
  const sorted = [...migrations].sort((a, b) => a.version - b.version)

  let count = 0
  for (const migration of sorted) {
    if (applied.has(migration.version)) continue

    logger.info(`[Migrations] Applying v${migration.version}: ${migration.name}`)

    db.exec('BEGIN')
    try {
      migration.up(db)
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(migration.version, migration.name)
      db.exec('COMMIT')
      count++
      logger.info(`[Migrations] Applied v${migration.version}: ${migration.name}`)
    } catch (err) {
      db.exec('ROLLBACK')
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`[Migrations] Failed v${migration.version}: ${migration.name} — ${msg}`)
      throw err
    }
  }

  if (count > 0) {
    logger.info(`[Migrations] Applied ${count} migration(s)`)
  } else {
    logger.debug(`[Migrations] Database is up to date`)
  }

  return count
}

/**
 * Get the current schema version (highest applied migration).
 * Returns 0 if no migrations have been applied.
 */
export function getCurrentVersion(db: DatabaseSync): number {
  ensureMigrationsTable(db)
  const row = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as { version: number | null } | undefined
  return row?.version ?? 0
}

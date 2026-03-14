export { getDatabase, closeDatabase, getDatabasePath, resetDatabaseSingleton } from './database.js'
export type { DatabaseConfig } from './database.js'
export { runMigrations, getCurrentVersion } from './migrations.js'
export type { Migration } from './migrations.js'

// ── Schema Initialization ──────────────────────────────────────────────────

import { getDatabase } from './database.js'
import { runMigrations } from './migrations.js'
import type { DatabaseConfig } from './database.js'
import type { Migration } from './migrations.js'
import initialSchema from './schemas/001-initial-schema.js'

const ALL_MIGRATIONS: Migration[] = [
  initialSchema,
]

/**
 * Initialize the database: connect and run all pending migrations.
 * Call this once at application startup.
 */
export function initializeDatabase(config?: DatabaseConfig): void {
  const db = getDatabase(config)
  runMigrations(db, ALL_MIGRATIONS)
}

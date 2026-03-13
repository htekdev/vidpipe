import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from '../paths/paths.js'
import { homedir } from 'node:os'
import logger from '../logger/configLogger.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface DatabaseConfig {
  /** Full path to the SQLite database file. Defaults to ~/.vidpipe/vidpipe.sqlite */
  dbPath?: string
  /** Use in-memory database (for testing). Overrides dbPath. */
  inMemory?: boolean
}

// ── Connection Management ──────────────────────────────────────────────────

let _db: DatabaseSync | null = null
let _dbPath: string | null = null

function resolveDbPath(config?: DatabaseConfig): string {
  if (config?.inMemory) return ':memory:'
  if (config?.dbPath) return config.dbPath
  return join(homedir(), '.vidpipe', 'vidpipe.sqlite')
}

function ensureDbDirectory(dbPath: string): void {
  if (dbPath === ':memory:') return
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    logger.debug(`[Database] Created directory: ${dir}`)
  }
}

/**
 * Get the singleton database connection.
 * Creates the connection on first call, reuses on subsequent calls.
 */
export function getDatabase(config?: DatabaseConfig): DatabaseSync {
  if (_db) return _db

  const dbPath = resolveDbPath(config)
  ensureDbDirectory(dbPath)

  _db = new DatabaseSync(dbPath)
  _dbPath = dbPath

  // Enable WAL mode for better concurrent read performance
  _db.exec('PRAGMA journal_mode=WAL')
  // Enable foreign key enforcement
  _db.exec('PRAGMA foreign_keys=ON')

  logger.debug(`[Database] Connected to ${dbPath === ':memory:' ? 'in-memory database' : dbPath}`)

  return _db
}

/**
 * Close the database connection and reset the singleton.
 */
export function closeDatabase(): void {
  if (_db) {
    _db.close()
    logger.debug(`[Database] Connection closed`)
    _db = null
    _dbPath = null
  }
}

/**
 * Get the current database file path, or null if not connected.
 */
export function getDatabasePath(): string | null {
  return _dbPath
}

/**
 * Reset the singleton (for testing). Does NOT close the connection.
 * Use closeDatabase() for proper cleanup.
 */
export function resetDatabaseSingleton(): void {
  _db = null
  _dbPath = null
}

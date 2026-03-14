import type { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  closeDatabase,
  getDatabase,
  getDatabasePath,
  resetDatabaseSingleton,
} from '../../../L1-infra/database/database.js'
import { getCurrentVersion, runMigrations } from '../../../L1-infra/database/migrations.js'
import initialSchema from '../../../L1-infra/database/schemas/001-initial-schema.js'

const expectedTables = [
  'account_cache',
  'cost_records',
  'pipeline_runs',
  'queue_items',
  'schema_migrations',
  'videos',
]

let tempDirectories: string[] = []

function makeTempDatabasePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vidpipe-db-test-'))
  tempDirectories.push(dir)
  return join(dir, 'vidpipe.sqlite')
}

function listUserTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `)
    .all() as Array<{ name: string }>

  return rows.map(row => row.name)
}

beforeEach(() => {
  resetDatabaseSingleton()
})

afterEach(() => {
  closeDatabase()
  resetDatabaseSingleton()

  for (const dir of tempDirectories) {
    rmSync(dir, { recursive: true, force: true })
  }

  tempDirectories = []
})

describe('database connection management', () => {
  test('getDatabase creates a singleton connection and returns the same instance on subsequent calls', () => {
    const dbPath = makeTempDatabasePath()

    const first = getDatabase({ dbPath })
    const second = getDatabase()

    expect(second).toBe(first)
    expect(getDatabasePath()).toBe(dbPath)
  })

  test('getDatabase with inMemory uses the :memory: path', () => {
    const db = getDatabase({ inMemory: true })

    expect(db).toBeDefined()
    expect(getDatabasePath()).toBe(':memory:')
  })

  test('closeDatabase closes the current connection and resets the singleton state', () => {
    const db = getDatabase({ inMemory: true })

    closeDatabase()

    expect(getDatabasePath()).toBeNull()
    expect(() => db.exec('SELECT 1')).toThrow(/database is not open/i)

    const reopened = getDatabase({ inMemory: true })

    expect(Object.is(reopened, db)).toBe(false)
    expect(() => reopened.exec('SELECT 1')).not.toThrow()
  })

  test('getDatabasePath returns the current path when connected and null otherwise', () => {
    expect(getDatabasePath()).toBeNull()

    const dbPath = makeTempDatabasePath()
    getDatabase({ dbPath })

    expect(getDatabasePath()).toBe(dbPath)

    closeDatabase()

    expect(getDatabasePath()).toBeNull()
  })

  test('resetDatabaseSingleton resets the singleton without closing the original connection', () => {
    const original = getDatabase({ inMemory: true })
    original.exec('CREATE TABLE reset_check (id INTEGER PRIMARY KEY)')

    resetDatabaseSingleton()

    try {
      expect(getDatabasePath()).toBeNull()
      expect(() => original.exec('INSERT INTO reset_check DEFAULT VALUES')).not.toThrow()

      const fresh = getDatabase({ inMemory: true })
      const existingTable = fresh
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reset_check'")
        .get() as { name: string } | undefined

      expect(fresh).not.toBe(original)
      expect(existingTable).toBeUndefined()
    } finally {
      original.close()
    }
  })
})

describe('database migrations', () => {
  test('runMigrations runs pending migrations and skips ones that are already applied', () => {
    const db = getDatabase({ inMemory: true })

    expect(runMigrations(db, [initialSchema])).toBe(1)
    expect(runMigrations(db, [initialSchema])).toBe(0)

    const applied = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{
      version: number
      name: string
    }>

    expect(applied).toEqual([{ version: 1, name: 'initial-schema' }])
  })

  test('getCurrentVersion returns 0 before migrations and the latest version after migrations', () => {
    const db = getDatabase({ inMemory: true })

    expect(getCurrentVersion(db)).toBe(0)

    runMigrations(db, [initialSchema])

    expect(getCurrentVersion(db)).toBe(1)
  })

  test('initial schema migration creates all expected tables', () => {
    const db = getDatabase({ inMemory: true })

    runMigrations(db, [initialSchema])

    expect(listUserTables(db)).toEqual(expectedTables)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn().mockReturnValue({ OUTPUT_DIR: '/tmp/output' }))
const mockInitializeDatabase = vi.hoisted(() => vi.fn())
const mockMigrateJsonToSqlite = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: mockGetConfig,
}))
vi.mock('../../../L1-infra/database/index.js', () => ({
  initializeDatabase: mockInitializeDatabase,
}))
vi.mock('../../../L3-services/migration/jsonToSqlite.js', () => ({
  migrateJsonToSqlite: mockMigrateJsonToSqlite,
}))

import { runMigrate } from '../../../L7-app/commands/migrate.js'

describe('runMigrate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes config and database before migrating', async () => {
    mockMigrateJsonToSqlite.mockResolvedValue({
      videosImported: 0,
      videosSkipped: 0,
      queueItemsImported: 0,
      queueItemsSkipped: 0,
      publishedItemsImported: 0,
      publishedItemsSkipped: 0,
      errors: [],
    })

    await runMigrate()

    expect(mockInitConfig).toHaveBeenCalledOnce()
    expect(mockInitializeDatabase).toHaveBeenCalledOnce()
    expect(mockMigrateJsonToSqlite).toHaveBeenCalledOnce()
  })

  it('returns migration result', async () => {
    const result = {
      videosImported: 3,
      videosSkipped: 1,
      queueItemsImported: 10,
      queueItemsSkipped: 2,
      publishedItemsImported: 5,
      publishedItemsSkipped: 0,
      errors: [],
    }
    mockMigrateJsonToSqlite.mockResolvedValue(result)

    const actual = await runMigrate()
    expect(actual).toEqual(result)
  })

  it('handles migration with errors', async () => {
    const result = {
      videosImported: 1,
      videosSkipped: 0,
      queueItemsImported: 0,
      queueItemsSkipped: 0,
      publishedItemsImported: 0,
      publishedItemsSkipped: 0,
      errors: ['Failed to parse JSON at /tmp/output/processing-state.json: Unexpected token'],
    }
    mockMigrateJsonToSqlite.mockResolvedValue(result)

    const actual = await runMigrate()
    expect(actual.errors).toHaveLength(1)
    expect(actual.errors[0]).toContain('Unexpected token')
  })
})

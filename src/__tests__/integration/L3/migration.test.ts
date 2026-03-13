import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dirent } from 'node:fs'

import { closeDatabase, getDatabase, initializeDatabase, resetDatabaseSingleton } from '../../../L1-infra/database/index.js'

const OUTPUT_DIR = '/tmp/migration-test'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR }),
}))

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockListDirectoryWithTypes = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  fileExists: mockFileExists,
  listDirectoryWithTypes: mockListDirectoryWithTypes,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
}))

import { migrateJsonToSqlite } from '../../../L3-services/migration/jsonToSqlite.js'

function directoryEntry(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: '',
    path: '',
  } as Dirent
}

function makeLegacyState(videos: Record<string, { status: string; sourcePath: string }>): string {
  return JSON.stringify({ videos })
}

function makeMetadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'item-1',
    platform: 'youtube',
    accountId: 'acc1',
    sourceVideo: 'my-video',
    clipType: 'short',
    characterCount: 100,
    platformCharLimit: 280,
    status: 'pending_review',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  })
}

function clearTables(): void {
  getDatabase().exec(`
    DELETE FROM queue_items;
    DELETE FROM videos;
  `)
}

beforeAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
  initializeDatabase({ inMemory: true })
})

afterAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

describe('L3 Integration: jsonToSqlite migration with real DB', () => {
  beforeEach(() => {
    clearTables()
    vi.clearAllMocks()
  })

  afterEach(() => {
    clearTables()
  })

  it('imports videos from processing-state.json into DB', async () => {
    mockFileExists
      .mockResolvedValueOnce(true)   // processing-state.json
      .mockResolvedValueOnce(false)  // publish-queue/
      .mockResolvedValueOnce(false)  // published/
    mockReadTextFile.mockResolvedValueOnce(
      makeLegacyState({
        'video-a': { status: 'completed', sourcePath: '/path/a.mp4' },
        'video-b': { status: 'pending', sourcePath: '/path/b.mp4' },
      }),
    )

    const result = await migrateJsonToSqlite()

    expect(result.videosImported).toBe(2)
    expect(result.videosSkipped).toBe(0)

    const db = getDatabase()
    const rows = db.prepare('SELECT slug, status FROM videos ORDER BY slug').all() as Array<{ slug: string; status: string }>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ slug: 'video-a', status: 'completed' })
    expect(rows[1]).toEqual({ slug: 'video-b', status: 'pending' })
  })

  it('skips already-imported videos', async () => {
    const db = getDatabase()
    db.prepare('INSERT INTO videos (slug, source_path, status) VALUES (?, ?, ?)').run('existing', '/old.mp4', 'completed')

    mockFileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    mockReadTextFile.mockResolvedValueOnce(
      makeLegacyState({
        existing: { status: 'completed', sourcePath: '/old.mp4' },
        newone: { status: 'pending', sourcePath: '/new.mp4' },
      }),
    )

    const result = await migrateJsonToSqlite()
    expect(result.videosImported).toBe(1)
    expect(result.videosSkipped).toBe(1)
  })

  it('imports queue items from publish-queue/ into DB', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // no processing-state.json
      .mockResolvedValueOnce(true)   // publish-queue/ exists
      .mockResolvedValueOnce(false)  // no published/

    mockListDirectoryWithTypes.mockResolvedValueOnce([directoryEntry('item-1')])

    mockReadTextFile
      .mockResolvedValueOnce(makeMetadata())        // metadata.json
      .mockResolvedValueOnce('Hello world post')     // post.md

    const result = await migrateJsonToSqlite()

    expect(result.queueItemsImported).toBe(1)

    const db = getDatabase()
    const row = db.prepare('SELECT id, platform, post_content, status FROM queue_items WHERE id = ?').get('item-1') as { id: string; platform: string; post_content: string; status: string }
    expect(row.id).toBe('item-1')
    expect(row.platform).toBe('youtube')
    expect(row.post_content).toBe('Hello world post')
    expect(row.status).toBe('pending_review')
  })

  it('imports published items with published status', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // no processing-state.json
      .mockResolvedValueOnce(false)  // no publish-queue/
      .mockResolvedValueOnce(true)   // published/ exists

    mockListDirectoryWithTypes.mockResolvedValueOnce([directoryEntry('pub-1')])

    mockReadTextFile
      .mockResolvedValueOnce(makeMetadata({ id: 'pub-1', status: 'published' }))
      .mockResolvedValueOnce('Published post')

    const result = await migrateJsonToSqlite()

    expect(result.publishedItemsImported).toBe(1)

    const db = getDatabase()
    const row = db.prepare('SELECT status FROM queue_items WHERE id = ?').get('pub-1') as { status: string }
    expect(row.status).toBe('published')
  })

  it('records errors for invalid JSON without crashing', async () => {
    mockFileExists
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
    mockReadTextFile.mockResolvedValueOnce('not valid json')

    const result = await migrateJsonToSqlite()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Failed to parse JSON')
  })
})

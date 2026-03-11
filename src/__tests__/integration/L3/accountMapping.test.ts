/**
 * L3 Integration Test — accountMapping service (cache layer)
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, logger)
 * Real code:     L3 accountMapping cache logic + L0 types
 *
 * Since accountMapping calls L2 (LateApiClient) for API fetches,
 * we only test the cache layer paths that work through L1 mocks:
 * file cache reads, clearAccountCache, and cache miss fallthrough.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())
const mockRemoveFile = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  removeFile: mockRemoveFile,
  fileExistsSync: vi.fn(() => false),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
  resolve: vi.fn((...args: string[]) => args.join('/')),
  sep: '/',
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import {
  getAllAccountMappings,
  getAccountId,
  clearAccountCache,
} from '../../../L3-services/socialPosting/accountMapping.js'
import { Platform } from '../../../L0-pure/types/index.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: accountMapping', () => {
  beforeEach(async () => {
    await clearAccountCache()
    vi.clearAllMocks()
  })

  // ── clearAccountCache ─────────────────────────────────────────────

  test('clearAccountCache calls removeFile on cache path', async () => {
    mockRemoveFile.mockResolvedValueOnce(undefined)

    await clearAccountCache()

    expect(mockRemoveFile).toHaveBeenCalledWith(
      expect.stringContaining('.vidpipe-cache.json'),
    )
  })

  test('clearAccountCache tolerates missing file', async () => {
    mockRemoveFile.mockRejectedValueOnce(new Error('ENOENT'))

    // Should not throw
    await expect(clearAccountCache()).resolves.toBeUndefined()
  })

  // ── File cache reads via getAllAccountMappings ─────────────────────

  test('getAllAccountMappings loads from file cache when valid', async () => {
    const cacheData = {
      accounts: { twitter: 'acc-123', linkedin: 'acc-456' },
      fetchedAt: new Date().toISOString(),
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cacheData))

    const mappings = await getAllAccountMappings()

    expect(mappings).toEqual({ twitter: 'acc-123', linkedin: 'acc-456' })
    expect(mockReadTextFile).toHaveBeenCalledWith(
      expect.stringContaining('.vidpipe-cache.json'),
    )
  })

  test('getAccountId returns correct ID from file cache', async () => {
    const cacheData = {
      accounts: { twitter: 'acc-x', linkedin: 'acc-li', tiktok: 'acc-tt' },
      fetchedAt: new Date().toISOString(),
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cacheData))

    // Platform.X maps to 'twitter' in Late API
    const xId = await getAccountId(Platform.X)
    expect(xId).toBe('acc-x')
  })

  test('getAccountId returns null for unconnected platform from cache', async () => {
    const cacheData = {
      accounts: { twitter: 'acc-x' },
      fetchedAt: new Date().toISOString(),
    }
    // First call reads file cache
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cacheData))

    // Instagram is not in the cache
    const id = await getAccountId(Platform.Instagram)
    expect(id).toBeNull()
  })

  test('stale file cache is ignored', async () => {
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25 hours ago
    const cacheData = {
      accounts: { twitter: 'acc-old' },
      fetchedAt: staleDate,
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cacheData))

    // After stale cache, it falls through to L2 fetch which will fail
    // (no L2 mock), so it returns empty mappings
    const mappings = await getAllAccountMappings()
    expect(mappings).toEqual({})
  })

  test('invalid file cache JSON is ignored', async () => {
    mockReadTextFile.mockResolvedValueOnce('not json')

    // Falls through to L2 fetch which fails → empty mappings
    const mappings = await getAllAccountMappings()
    expect(mappings).toEqual({})
  })

  test('missing file cache falls through gracefully', async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error('ENOENT'))

    // Falls through to L2 fetch which fails → empty mappings
    const mappings = await getAllAccountMappings()
    expect(mappings).toEqual({})
  })

  // ── Memory cache ──────────────────────────────────────────────────

  test('second call uses memory cache without re-reading file', async () => {
    const cacheData = {
      accounts: { linkedin: 'acc-mem' },
      fetchedAt: new Date().toISOString(),
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(cacheData))

    const first = await getAllAccountMappings()
    const second = await getAllAccountMappings()

    expect(first).toEqual(second)
    // Only one file read — second call uses memory
    expect(mockReadTextFile).toHaveBeenCalledTimes(1)
  })

  test('clearAccountCache forces file re-read on next call', async () => {
    const cacheA = {
      accounts: { linkedin: 'acc-a' },
      fetchedAt: new Date().toISOString(),
    }
    const cacheB = {
      accounts: { linkedin: 'acc-b' },
      fetchedAt: new Date().toISOString(),
    }

    mockReadTextFile
      .mockResolvedValueOnce(JSON.stringify(cacheA))
      .mockResolvedValueOnce(JSON.stringify(cacheB))
    mockRemoveFile.mockResolvedValue(undefined)

    const first = await getAllAccountMappings()
    expect(first).toEqual({ linkedin: 'acc-a' })

    await clearAccountCache()

    const second = await getAllAccountMappings()
    expect(second).toEqual({ linkedin: 'acc-b' })
    expect(mockReadTextFile).toHaveBeenCalledTimes(2)
  })
})

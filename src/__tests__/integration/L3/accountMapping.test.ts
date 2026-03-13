/**
 * L3 Integration Test — accountMapping service (cache orchestration)
 *
 * Mock boundary: L2 account cache store + Late API client
 * Real code:     L3 accountMapping logic + L0 types
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const mockGetCachedAccounts = vi.hoisted(() => vi.fn())
const mockSetCachedAccounts = vi.hoisted(() => vi.fn())
const mockClearStoredAccountCache = vi.hoisted(() => vi.fn())
const mockListAccounts = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/accountCacheStore.js', () => ({
  getCachedAccounts: mockGetCachedAccounts,
  setCachedAccounts: mockSetCachedAccounts,
  clearAccountCache: mockClearStoredAccountCache,
}))

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class {
    listAccounts = mockListAccounts
  },
}))

import { Platform } from '../../../L0-pure/types/index.js'
import {
  clearAccountCache,
  getAccountId,
  getAllAccountMappings,
} from '../../../L3-services/socialPosting/accountMapping.js'

describe('L3 Integration: accountMapping', () => {
  beforeEach(async () => {
    mockGetCachedAccounts.mockReset()
    mockSetCachedAccounts.mockReset()
    mockClearStoredAccountCache.mockReset()
    mockListAccounts.mockReset()

    mockGetCachedAccounts.mockReturnValue(null)
    mockSetCachedAccounts.mockImplementation(() => undefined)
    mockClearStoredAccountCache.mockImplementation(() => undefined)

    await clearAccountCache()
    mockClearStoredAccountCache.mockClear()
  })

  test('clearAccountCache calls the datastore clear function', async () => {
    await clearAccountCache()

    expect(mockClearStoredAccountCache).toHaveBeenCalledTimes(1)
  })

  test('clearAccountCache tolerates datastore clear failures', async () => {
    mockClearStoredAccountCache.mockImplementationOnce(() => {
      throw new Error('database unavailable')
    })

    await expect(clearAccountCache()).resolves.toBeUndefined()
  })

  test('getAllAccountMappings loads from database cache when valid', async () => {
    mockGetCachedAccounts.mockReturnValueOnce({ twitter: 'acc-123', linkedin: 'acc-456' })

    const mappings = await getAllAccountMappings()

    expect(mappings).toEqual({ twitter: 'acc-123', linkedin: 'acc-456' })
    expect(mockGetCachedAccounts).toHaveBeenCalledWith(24 * 60 * 60 * 1000)
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  test('getAccountId returns correct ID from database cache', async () => {
    mockGetCachedAccounts.mockReturnValueOnce({
      twitter: 'acc-x',
      linkedin: 'acc-li',
      tiktok: 'acc-tt',
    })

    const xId = await getAccountId(Platform.X)

    expect(xId).toBe('acc-x')
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  test('getAccountId returns null for unconnected platform from cache', async () => {
    mockGetCachedAccounts.mockReturnValueOnce({ twitter: 'acc-x' })

    const id = await getAccountId(Platform.Instagram)

    expect(id).toBeNull()
    expect(mockListAccounts).not.toHaveBeenCalled()
  })

  test('stale database cache is ignored', async () => {
    mockGetCachedAccounts.mockReturnValueOnce(null)
    mockListAccounts.mockRejectedValueOnce(new Error('Network error'))

    const mappings = await getAllAccountMappings()

    expect(mappings).toEqual({})
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
  })

  test('invalid database cache data is ignored', async () => {
    mockGetCachedAccounts.mockImplementationOnce(() => {
      throw new Error('malformed cache row')
    })
    mockListAccounts.mockRejectedValueOnce(new Error('Network error'))

    const mappings = await getAllAccountMappings()

    expect(mappings).toEqual({})
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
  })

  test('missing database cache falls through gracefully', async () => {
    mockGetCachedAccounts.mockReturnValueOnce(null)
    mockListAccounts.mockRejectedValueOnce(new Error('Network error'))

    const mappings = await getAllAccountMappings()

    expect(mappings).toEqual({})
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
  })

  test('second call uses memory cache without re-reading the datastore', async () => {
    mockGetCachedAccounts.mockReturnValueOnce({ linkedin: 'acc-mem' })

    const first = await getAllAccountMappings()
    const second = await getAllAccountMappings()

    expect(first).toEqual(second)
    expect(mockGetCachedAccounts).toHaveBeenCalledTimes(1)
  })

  test('clearAccountCache forces database re-read on next call', async () => {
    mockGetCachedAccounts
      .mockReturnValueOnce({ linkedin: 'acc-a' })
      .mockReturnValueOnce({ linkedin: 'acc-b' })

    const first = await getAllAccountMappings()
    expect(first).toEqual({ linkedin: 'acc-a' })

    await clearAccountCache()

    const second = await getAllAccountMappings()

    expect(second).toEqual({ linkedin: 'acc-b' })
    expect(mockClearStoredAccountCache).toHaveBeenCalledTimes(1)
    expect(mockGetCachedAccounts).toHaveBeenCalledTimes(2)
  })
})

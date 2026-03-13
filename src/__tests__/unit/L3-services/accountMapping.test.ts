import { beforeEach, describe, expect, it, vi } from 'vitest'

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
} from '../../../L3-services/socialPosting/accountMapping.js'

describe('accountMapping', () => {
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

  it('fetches from API on first call', async () => {
    mockListAccounts.mockResolvedValue([
      { _id: 'acct-tw', platform: 'twitter', isActive: true },
      { _id: 'acct-li', platform: 'linkedin', isActive: true },
    ])

    const id = await getAccountId(Platform.X)

    expect(id).toBe('acct-tw')
    expect(mockGetCachedAccounts).toHaveBeenCalledWith(24 * 60 * 60 * 1000)
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
    expect(mockSetCachedAccounts).toHaveBeenCalledWith({
      twitter: 'acct-tw',
      linkedin: 'acct-li',
    })
  })

  it('returns cached value on second call', async () => {
    mockListAccounts.mockResolvedValue([
      { _id: 'acct-tw', platform: 'twitter', isActive: true },
    ])

    await getAccountId(Platform.X)
    const id2 = await getAccountId(Platform.X)

    expect(id2).toBe('acct-tw')
    expect(mockGetCachedAccounts).toHaveBeenCalledTimes(1)
    expect(mockListAccounts).toHaveBeenCalledTimes(1)
  })

  it('returns null for unconnected platform', async () => {
    mockListAccounts.mockResolvedValue([
      { _id: 'acct-tw', platform: 'twitter', isActive: true },
    ])

    const id = await getAccountId(Platform.TikTok)

    expect(id).toBeNull()
  })

  it('clearAccountCache forces re-fetch', async () => {
    mockListAccounts
      .mockResolvedValueOnce([
        { _id: 'acct-tw-v1', platform: 'twitter', isActive: true },
      ])
      .mockResolvedValueOnce([
        { _id: 'acct-tw-v2', platform: 'twitter', isActive: true },
      ])

    const id1 = await getAccountId(Platform.X)
    expect(id1).toBe('acct-tw-v1')
    expect(mockListAccounts).toHaveBeenCalledTimes(1)

    await clearAccountCache()

    const id2 = await getAccountId(Platform.X)

    expect(id2).toBe('acct-tw-v2')
    expect(mockClearStoredAccountCache).toHaveBeenCalledTimes(1)
    expect(mockGetCachedAccounts).toHaveBeenCalledTimes(2)
    expect(mockListAccounts).toHaveBeenCalledTimes(2)
  })

  it('maps Platform.X to twitter', async () => {
    mockListAccounts.mockResolvedValue([
      { _id: 'acct-tw', platform: 'twitter', isActive: true },
    ])

    const id = await getAccountId(Platform.X)

    expect(id).toBe('acct-tw')
  })

  it('returns empty mappings when API fails', async () => {
    mockListAccounts.mockRejectedValue(new Error('Network error'))

    const id = await getAccountId(Platform.X)

    expect(id).toBeNull()
    expect(mockSetCachedAccounts).not.toHaveBeenCalled()
  })
})

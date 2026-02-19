import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-key' }),
}))

// Mock fetch globally so LateApiClient.listAccounts() returns controlled data
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { Platform } from '../../../L0-pure/types/index.js'
import {
  getAccountId,
  clearAccountCache,
} from '../../../L3-services/socialPosting/accountMapping.js'

function accountsResponse(accounts: Array<Record<string, unknown>>) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ accounts }),
    text: () => Promise.resolve(JSON.stringify({ accounts })),
    headers: new Map(),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('accountMapping', () => {
  const cacheFile = path.join(process.cwd(), '.vidpipe-cache.json')

  beforeEach(async () => {
    vi.clearAllMocks()
    await clearAccountCache()
  })

  afterEach(async () => {
    // Clean up cache file
    try { await fs.unlink(cacheFile) } catch { /* ok */ }
  })

  it('fetches from API on first call', async () => {
    mockFetch.mockResolvedValue(accountsResponse([
      { _id: 'acct-tw', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
      { _id: 'acct-li', platform: 'linkedin', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    const id = await getAccountId(Platform.X)
    expect(id).toBe('acct-tw')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns cached value on second call', async () => {
    mockFetch.mockResolvedValue(accountsResponse([
      { _id: 'acct-tw', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    await getAccountId(Platform.X)
    const id2 = await getAccountId(Platform.X)
    expect(id2).toBe('acct-tw')
    // Should only have fetched once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns null for unconnected platform', async () => {
    mockFetch.mockResolvedValue(accountsResponse([
      { _id: 'acct-tw', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    const id = await getAccountId(Platform.TikTok)
    expect(id).toBeNull()
  })

  it('clearAccountCache forces re-fetch', async () => {
    mockFetch.mockResolvedValueOnce(accountsResponse([
      { _id: 'acct-tw-v1', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    const id1 = await getAccountId(Platform.X)
    expect(id1).toBe('acct-tw-v1')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    await clearAccountCache()

    mockFetch.mockResolvedValueOnce(accountsResponse([
      { _id: 'acct-tw-v2', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    const id2 = await getAccountId(Platform.X)
    expect(id2).toBe('acct-tw-v2')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('maps Platform.X to twitter', async () => {
    mockFetch.mockResolvedValue(accountsResponse([
      { _id: 'acct-tw', platform: 'twitter', displayName: 'Me', username: 'me', isActive: true, profileId: { _id: 'p1', name: 'default' } },
    ]))

    // Platform.X should resolve to 'twitter' platform in Late
    const id = await getAccountId(Platform.X)
    expect(id).toBe('acct-tw')
  })

  it('returns empty mappings when API fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const id = await getAccountId(Platform.X)
    expect(id).toBeNull()
  })
})

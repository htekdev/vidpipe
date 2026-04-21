/**
 * L3 Integration Test — lateApiService → L2 LateApiClient chain
 *
 * Mock boundary: L1 (config, logger)
 * Real code:     L2 LateApiClient, L3 lateApiService wrapper
 *
 * Validates that createLateApiClient() correctly instantiates
 * a real L2 LateApiClient through the L3 wrapper.
 */
import { vi, describe, test, expect, beforeEach } from 'vitest'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-integration-key' }),
}))

import { createLateApiClient } from '../../../L3-services/lateApi/lateApiService.js'

describe('L3 Integration: lateApiService → L2 LateApiClient', () => {
  test('createLateApiClient returns real LateApiClient instance', () => {
    const client = createLateApiClient('test-integration-key')
    expect(client).toBeDefined()
    expect(typeof client.listAccounts).toBe('function')
    expect(typeof client.createPost).toBe('function')
  })
})

// ── Pagination through L3 → L2 chain ──────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function fakeResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: new Map(),
  }
}

function fakePosts(count: number, status: string, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => ({
    _id: `${status[0]}${startIndex + i}`,
    content: '',
    status,
    platforms: [],
    createdAt: '',
    updatedAt: '',
  }))
}

describe('L3 Integration: pagination through L3 → L2 chain', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  test('getScheduledPosts collects posts across multiple pages', async () => {
    const client = createLateApiClient('test-integration-key')

    mockFetch
      .mockResolvedValueOnce(fakeResponse({ posts: fakePosts(100, 'scheduled') }))
      .mockResolvedValueOnce(fakeResponse({ posts: fakePosts(25, 'scheduled', 100) }))

    const result = await client.getScheduledPosts('tiktok')
    expect(result).toHaveLength(125)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  test('getDraftPosts collects posts across multiple pages', async () => {
    const client = createLateApiClient('test-integration-key')

    mockFetch
      .mockResolvedValueOnce(fakeResponse({ posts: fakePosts(100, 'draft') }))
      .mockResolvedValueOnce(fakeResponse({ posts: fakePosts(10, 'draft', 100) }))

    const result = await client.getDraftPosts()
    expect(result).toHaveLength(110)
  })

  test('single page returns without extra requests', async () => {
    const client = createLateApiClient('test-integration-key')

    mockFetch.mockResolvedValueOnce(fakeResponse({ posts: fakePosts(7, 'scheduled') }))

    const result = await client.getScheduledPosts()
    expect(result).toHaveLength(7)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})

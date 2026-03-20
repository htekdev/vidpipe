import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-api-key-123' }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { LateApiClient } from '../../../L2-clients/late/lateApi.js'

// ── Helpers ────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map<string, string>(),
  }
}

function errorResponse(status: number, body = 'error') {
  return {
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(body),
    headers: new Map([['Retry-After', '0.01']]),
  }
}

function makeFakePost(overrides: Partial<{ status: string; isDraft: boolean }> = {}, index = 0) {
  return {
    _id: `post-${index}`,
    content: `Post ${index}`,
    status: overrides.status ?? 'scheduled',
    platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
    isDraft: overrides.isDraft,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }
}

function makeFakePosts(count: number, overrides: Partial<{ status: string }> = {}, startIndex = 0) {
  return Array.from({ length: count }, (_, i) => makeFakePost(overrides, startIndex + i))
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('LateApiClient', () => {
  let client: LateApiClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LateApiClient('test-api-key-123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listProfiles', () => {
    it('returns profiles from API', async () => {
      const profiles = [{ _id: 'p1', name: 'My Profile' }]
      mockFetch.mockResolvedValueOnce(jsonResponse({ profiles }))

      const result = await client.listProfiles()
      expect(result).toEqual(profiles)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/profiles')
      expect(opts.headers.Authorization).toBe('Bearer test-api-key-123')
    })
  })

  describe('createPost', () => {
    it('sends correct payload', async () => {
      const newPost = {
        _id: 'post-1',
        content: 'Hello',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'acct-1' }],
        scheduledFor: '2025-06-01T12:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ post: newPost }))

      const params = {
        content: 'Hello',
        platforms: [{ platform: 'twitter', accountId: 'acct-1' }],
        scheduledFor: '2025-06-01T12:00:00Z',
      }
      const result = await client.createPost(params)
      expect(result._id).toBe('post-1')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/posts')
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toMatchObject({
        content: 'Hello',
        scheduledFor: '2025-06-01T12:00:00Z',
      })
    })

    it('passes thumbnail as string URL in mediaItems', async () => {
      const newPost = {
        _id: 'post-2',
        content: 'Video post',
        status: 'scheduled',
        platforms: [{ platform: 'youtube', accountId: 'acct-1' }],
        scheduledFor: '2025-06-01T12:00:00Z',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ post: newPost }))

      await client.createPost({
        content: 'Video post',
        platforms: [{ platform: 'youtube', accountId: 'acct-1' }],
        mediaItems: [{ type: 'video', url: 'https://cdn/video.mp4', thumbnail: 'https://cdn/thumb.jpg' }],
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.mediaItems[0].thumbnail).toBe('https://cdn/thumb.jpg')
      expect(typeof body.mediaItems[0].thumbnail).toBe('string')
    })
  })

  describe('deletePost', () => {
    it('sends DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(''),
        headers: new Map(),
      })

      await client.deletePost('post-abc')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/posts/post-abc')
      expect(opts.method).toBe('DELETE')
    })
  })

  describe('getScheduledPosts', () => {
    it('delegates to listPosts with status=scheduled', async () => {
      const posts = [makeFakePost({ status: 'scheduled' })]
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts }))

      const result = await client.getScheduledPosts()
      expect(result).toEqual(posts)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('status=scheduled')
    })

    it('passes platform filter', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: [] }))

      await client.getScheduledPosts('tiktok')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('status=scheduled')
      expect(url).toContain('platform=tiktok')
    })

    it('paginates across multiple pages', async () => {
      const fullPage = makeFakePosts(100, { status: 'scheduled' })
      const partialPage = makeFakePosts(37, { status: 'scheduled' }, 100)

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ posts: fullPage }))
        .mockResolvedValueOnce(jsonResponse({ posts: partialPage }))

      const result = await client.getScheduledPosts('tiktok')
      expect(result).toHaveLength(137)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      const [url1] = mockFetch.mock.calls[0]
      const [url2] = mockFetch.mock.calls[1]
      expect(url1).toContain('page=1')
      expect(url2).toContain('page=2')
    })
  })

  describe('getDraftPosts', () => {
    it('delegates to listPosts with status=draft', async () => {
      const posts = [makeFakePost({ status: 'draft', isDraft: true })]
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts }))

      const result = await client.getDraftPosts()
      expect(result).toEqual(posts)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('status=draft')
    })

    it('paginates across multiple pages', async () => {
      const fullPage = makeFakePosts(100, { status: 'draft' })
      const partialPage = makeFakePosts(23, { status: 'draft' }, 100)

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ posts: fullPage }))
        .mockResolvedValueOnce(jsonResponse({ posts: partialPage }))

      const result = await client.getDraftPosts('youtube')
      expect(result).toHaveLength(123)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      const [url1] = mockFetch.mock.calls[0]
      expect(url1).toContain('platform=youtube')
    })
  })

  describe('listPosts', () => {
    it('stops after a single page when results < limit', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ posts: makeFakePosts(5) }))

      const result = await client.listPosts({ status: 'scheduled' })
      expect(result).toHaveLength(5)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('accepts data field as alternative to posts', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: makeFakePosts(3) }))

      const result = await client.listPosts()
      expect(result).toHaveLength(3)
    })

    it('includes limit and page params in each request', async () => {
      const fullPage = makeFakePosts(100)

      mockFetch
        .mockResolvedValueOnce(jsonResponse({ posts: fullPage }))
        .mockResolvedValueOnce(jsonResponse({ posts: [] }))

      await client.listPosts({ status: 'scheduled', platform: 'tiktok' })

      const [url1] = mockFetch.mock.calls[0]
      const [url2] = mockFetch.mock.calls[1]
      expect(url1).toContain('limit=100')
      expect(url1).toContain('page=1')
      expect(url2).toContain('page=2')
    })
  })

  describe('retry on 429', () => {
    it('retries on rate limit and succeeds', async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(429))
        .mockResolvedValueOnce(jsonResponse({ profiles: [{ _id: 'p1', name: 'Profile' }] }))

      const result = await client.listProfiles()
      expect(result).toHaveLength(1)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('error handling', () => {
    it('throws on 401 with descriptive message', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))

      await expect(client.listProfiles()).rejects.toThrow(/authentication failed.*401/i)
    })

    it('throws on other errors with status info', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))

      await expect(client.listProfiles()).rejects.toThrow(/500/)
    })
  })

  describe('validateConnection', () => {
    it('returns valid when profiles available', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ profiles: [{ _id: 'p1', name: 'My Profile' }] }),
      )

      const result = await client.validateConnection()
      expect(result.valid).toBe(true)
      expect(result.profileName).toBe('My Profile')
    })

    it('returns invalid on error', async () => {
      mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'))

      const result = await client.validateConnection()
      expect(result.valid).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('constructor', () => {
    it('throws when no API key provided and none in config', () => {
      // The mock always returns a key, so test with explicit empty string
      expect(() => new LateApiClient('')).toThrow(/LATE_API_KEY/)
    })
  })
})

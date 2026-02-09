import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-api-key-123' }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { LateApiClient } from '../services/lateApi.js'

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
      mockFetch.mockResolvedValueOnce(jsonResponse(newPost))

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

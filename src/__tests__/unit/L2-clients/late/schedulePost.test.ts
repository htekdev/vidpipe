import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (external APIs only — L2 rules) ──────────────────────────────

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-key' }),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { LateApiClient } from '../../../../L2-clients/late/lateApi.js'

// ── Tests ──────────────────────────────────────────────────────────────

describe('LateApiClient.schedulePost', () => {
  let client: LateApiClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LateApiClient('test-key')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls updatePost with { scheduledFor, isDraft: false }', async () => {
    const updatedPost = {
      _id: 'post-42',
      content: 'Hello',
      status: 'scheduled',
      platforms: [{ platform: 'twitter', accountId: 'a1' }],
      scheduledFor: '2026-04-01T10:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ post: updatedPost }),
      text: () => Promise.resolve(JSON.stringify({ post: updatedPost })),
      headers: new Map(),
    })

    const result = await client.schedulePost('post-42', '2026-04-01T10:00:00Z')

    expect(result._id).toBe('post-42')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const [url, opts] = mockFetch.mock.calls[0]
    expect(url).toContain('/posts/post-42')
    expect(opts.method).toBe('PUT')

    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      scheduledFor: '2026-04-01T10:00:00Z',
      isDraft: false,
    })
  })
})

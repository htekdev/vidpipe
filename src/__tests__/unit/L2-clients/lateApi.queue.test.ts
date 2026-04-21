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
import type { CreatePostParams } from '../../../L2-clients/late/lateApi.js'

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

function makeQueue(overrides: Partial<{ _id: string; name: string; active: boolean; isDefault: boolean }> = {}) {
  return {
    _id: overrides._id ?? 'queue-1',
    profileId: 'profile-1',
    name: overrides.name ?? 'Default Queue',
    timezone: 'America/Chicago',
    slots: [
      { dayOfWeek: 1, time: '09:00' },
      { dayOfWeek: 3, time: '14:00' },
    ],
    active: overrides.active ?? true,
    isDefault: overrides.isDefault ?? false,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('LateApiClient — Queue methods', () => {
  let client: LateApiClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LateApiClient('test-api-key-123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── listQueues ────────────────────────────────────────────────────────

  describe('listQueues', () => {
    it('sends GET with profileId query param', async () => {
      const queue = makeQueue()
      mockFetch.mockResolvedValueOnce(jsonResponse({ queues: [queue], count: 1 }))

      const result = await client.listQueues('profile-1')

      expect(result.queues).toEqual([queue])
      expect(result.count).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(url).toContain('profileId=profile-1')
      expect(url).not.toContain('all=true')
      expect(opts.headers.Authorization).toBe('Bearer test-api-key-123')
    })

    it('includes all=true when requested', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ queues: [], count: 0 }))

      await client.listQueues('profile-1', true)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('all=true')
    })

    it('omits all param when false (default)', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ queues: [], count: 0 }))

      await client.listQueues('profile-1', false)

      const [url] = mockFetch.mock.calls[0]
      expect(url).not.toContain('all=')
    })
  })

  // ── createQueue ───────────────────────────────────────────────────────

  describe('createQueue', () => {
    it('sends POST with correct body', async () => {
      const schedule = makeQueue({ _id: 'queue-new', name: 'Morning Posts', isDefault: false })
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, schedule }))

      const params = {
        profileId: 'profile-1',
        name: 'Morning Posts',
        timezone: 'America/Chicago',
        slots: [
          { dayOfWeek: 1, time: '09:00' },
          { dayOfWeek: 3, time: '14:00' },
        ],
      }
      const result = await client.createQueue(params)

      expect(result.success).toBe(true)
      expect(result.schedule.name).toBe('Morning Posts')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(opts.method).toBe('POST')

      const body = JSON.parse(opts.body)
      expect(body).toMatchObject({
        profileId: 'profile-1',
        name: 'Morning Posts',
        timezone: 'America/Chicago',
        slots: [
          { dayOfWeek: 1, time: '09:00' },
          { dayOfWeek: 3, time: '14:00' },
        ],
      })
    })

    it('passes optional active and setAsDefault fields', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        success: true,
        schedule: makeQueue({ isDefault: true }),
      }))

      await client.createQueue({
        profileId: 'profile-1',
        name: 'Primary',
        timezone: 'UTC',
        slots: [{ dayOfWeek: 0, time: '10:00' }],
        active: true,
        setAsDefault: true,
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.active).toBe(true)
      expect(body.setAsDefault).toBe(true)
    })
  })

  // ── updateQueue ───────────────────────────────────────────────────────

  describe('updateQueue', () => {
    it('sends PUT with correct body', async () => {
      const schedule = { _id: 'queue-1', name: 'Updated Queue', slots: [{ dayOfWeek: 2, time: '16:00' }] }
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, schedule }))

      const params = {
        profileId: 'profile-1',
        queueId: 'queue-1',
        name: 'Updated Queue',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 2, time: '16:00' }],
      }
      const result = await client.updateQueue(params)

      expect(result.success).toBe(true)
      expect(result.schedule.name).toBe('Updated Queue')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(opts.method).toBe('PUT')

      const body = JSON.parse(opts.body)
      expect(body).toMatchObject({
        profileId: 'profile-1',
        queueId: 'queue-1',
        name: 'Updated Queue',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 2, time: '16:00' }],
      })
    })

    it('includes reshuffleExisting in body when set', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        success: true,
        schedule: { _id: 'queue-1', name: 'Q', slots: [] },
      }))

      await client.updateQueue({
        profileId: 'profile-1',
        queueId: 'queue-1',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 5, time: '18:00' }],
        reshuffleExisting: true,
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.reshuffleExisting).toBe(true)
    })

    it('passes setAsDefault and active flags', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        success: true,
        schedule: { _id: 'queue-1', name: 'Q', slots: [] },
      }))

      await client.updateQueue({
        profileId: 'profile-1',
        timezone: 'UTC',
        slots: [],
        active: false,
        setAsDefault: true,
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.active).toBe(false)
      expect(body.setAsDefault).toBe(true)
    })
  })

  // ── deleteQueue ───────────────────────────────────────────────────────

  describe('deleteQueue', () => {
    it('sends DELETE with profileId and queueId query params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }))

      const result = await client.deleteQueue('profile-1', 'queue-1')

      expect(result.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('queueId=queue-1')
      expect(opts.method).toBe('DELETE')
    })
  })

  // ── previewQueue ──────────────────────────────────────────────────────

  describe('previewQueue', () => {
    it('sends GET with profileId and default count', async () => {
      const preview = {
        profileId: 'profile-1',
        count: 20,
        slots: ['2026-03-01T09:00:00-06:00', '2026-03-03T14:00:00-06:00'],
      }
      mockFetch.mockResolvedValueOnce(jsonResponse(preview))

      const result = await client.previewQueue('profile-1')

      expect(result.profileId).toBe('profile-1')
      expect(result.slots).toHaveLength(2)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/preview')
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('count=20')
      expect(url).not.toContain('queueId=')
      expect(opts.method ?? 'GET').toBe('GET')
    })

    it('includes queueId when provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        profileId: 'profile-1',
        queueId: 'queue-2',
        queueName: 'Evening Posts',
        count: 5,
        slots: [],
      }))

      await client.previewQueue('profile-1', 'queue-2', 5)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('queueId=queue-2')
      expect(url).toContain('count=5')
    })

    it('uses custom count parameter', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        profileId: 'profile-1',
        count: 50,
        slots: [],
      }))

      await client.previewQueue('profile-1', undefined, 50)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('count=50')
      expect(url).not.toContain('queueId=')
    })
  })

  // ── getNextQueueSlot ──────────────────────────────────────────────────

  describe('getNextQueueSlot', () => {
    it('sends GET with profileId', async () => {
      const nextSlot = {
        profileId: 'profile-1',
        nextSlot: '2026-03-01T09:00:00-06:00',
        timezone: 'America/Chicago',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse(nextSlot))

      const result = await client.getNextQueueSlot('profile-1')

      expect(result.profileId).toBe('profile-1')
      expect(result.nextSlot).toBe('2026-03-01T09:00:00-06:00')
      expect(result.timezone).toBe('America/Chicago')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/next-slot')
      expect(url).toContain('profileId=profile-1')
      expect(url).not.toContain('queueId=')
      expect(opts.method ?? 'GET').toBe('GET')
    })

    it('includes queueId when provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        profileId: 'profile-1',
        nextSlot: '2026-03-03T14:00:00-06:00',
        timezone: 'America/Chicago',
        queueId: 'queue-2',
        queueName: 'Evening Posts',
      }))

      const result = await client.getNextQueueSlot('profile-1', 'queue-2')

      expect(result.queueId).toBe('queue-2')
      expect(result.queueName).toBe('Evening Posts')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('queueId=queue-2')
    })
  })

  // ── createPost with queue params ──────────────────────────────────────

  describe('createPost with queue params', () => {
    it('sends queuedFromProfile and queueId in POST body', async () => {
      const newPost = {
        _id: 'post-queued-1',
        content: 'Queued post',
        status: 'scheduled',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ post: newPost }))

      const params: CreatePostParams = {
        content: 'Queued post',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
        queuedFromProfile: 'profile-1',
        queueId: 'queue-1',
      }
      const result = await client.createPost(params)

      expect(result._id).toBe('post-queued-1')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/posts')
      expect(opts.method).toBe('POST')

      const body = JSON.parse(opts.body)
      expect(body.queuedFromProfile).toBe('profile-1')
      expect(body.queueId).toBe('queue-1')
      expect(body).not.toHaveProperty('scheduledFor')
    })

    it('sends queuedFromProfile without queueId for default queue', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        post: {
          _id: 'post-queued-2',
          content: 'Default queue post',
          status: 'scheduled',
          platforms: [{ platform: 'instagram', accountId: 'acct-2' }],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      }))

      const params: CreatePostParams = {
        content: 'Default queue post',
        platforms: [{ platform: 'instagram', accountId: 'acct-2' }],
        queuedFromProfile: 'profile-1',
      }
      await client.createPost(params)

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.queuedFromProfile).toBe('profile-1')
      expect(body).not.toHaveProperty('queueId')
      expect(body).not.toHaveProperty('scheduledFor')
    })
  })
})

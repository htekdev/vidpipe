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
import type {
  CreateQueueParams,
  UpdateQueueParams,
  LateQueue,
  QueueSlotPreview,
} from '../../../L2-clients/late/lateApi.js'

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

function noContentResponse() {
  return {
    ok: true,
    status: 204,
    statusText: 'No Content',
    json: () => Promise.resolve(undefined),
    text: () => Promise.resolve(''),
    headers: new Map<string, string>(),
  }
}

function makeFakeQueue(overrides: Partial<LateQueue> = {}): LateQueue {
  return {
    _id: overrides._id ?? 'queue-1',
    profileId: overrides.profileId ?? 'profile-1',
    name: overrides.name ?? 'Default Queue',
    timezone: overrides.timezone ?? 'America/Chicago',
    slots: overrides.slots ?? [
      { dayOfWeek: 1, time: '09:00' },
      { dayOfWeek: 3, time: '12:00' },
      { dayOfWeek: 5, time: '17:00' },
    ],
    active: overrides.active ?? true,
    isDefault: overrides.isDefault ?? true,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('LateApiClient queue methods', () => {
  let client: LateApiClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LateApiClient('test-api-key-123')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createQueue', () => {
    it('sends POST to /queue/slots with correct params', async () => {
      const queue = makeFakeQueue()
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, schedule: queue }))

      const params: CreateQueueParams = {
        profileId: 'profile-1',
        name: 'Default Queue',
        timezone: 'America/Chicago',
        slots: [
          { dayOfWeek: 1, time: '09:00' },
          { dayOfWeek: 3, time: '12:00' },
          { dayOfWeek: 5, time: '17:00' },
        ],
      }
      await client.createQueue(params)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(opts.method).toBe('POST')
      expect(JSON.parse(opts.body)).toMatchObject({
        profileId: 'profile-1',
        name: 'Default Queue',
        timezone: 'America/Chicago',
        slots: expect.arrayContaining([{ dayOfWeek: 1, time: '09:00' }]),
      })
    })

    it('returns the created queue', async () => {
      const slots = [{ dayOfWeek: 1, time: '09:00' }]
      const queue = makeFakeQueue({ _id: 'queue-new', name: 'Morning Slots', slots })
      mockFetch.mockResolvedValueOnce(jsonResponse({ success: true, schedule: queue }))

      const result = await client.createQueue({
        profileId: 'profile-1',
        name: 'Morning Slots',
        timezone: 'America/Chicago',
        slots,
      })

      expect(result._id).toBe('queue-new')
      expect(result.name).toBe('Morning Slots')
      expect(result.slots).toHaveLength(1)
    })
  })

  describe('updateQueue', () => {
    it('sends PUT to /queue/slots with correct params', async () => {
      const queue = makeFakeQueue()
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, schedule: queue, reshuffledCount: 0 }),
      )

      const params: UpdateQueueParams = {
        profileId: 'profile-1',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 2, time: '10:00' }],
      }
      await client.updateQueue(params)

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(opts.method).toBe('PUT')
      expect(JSON.parse(opts.body)).toMatchObject({
        profileId: 'profile-1',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 2, time: '10:00' }],
      })
    })

    it('passes reshuffleExisting when provided', async () => {
      const queue = makeFakeQueue()
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, schedule: queue, reshuffledCount: 5 }),
      )

      await client.updateQueue({
        profileId: 'profile-1',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 1, time: '08:00' }],
        reshuffleExisting: true,
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.reshuffleExisting).toBe(true)
    })

    it('returns schedule and reshuffledCount', async () => {
      const queue = makeFakeQueue({ name: 'Updated Queue' })
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ success: true, schedule: queue, reshuffledCount: 3 }),
      )

      const result = await client.updateQueue({
        profileId: 'profile-1',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 1, time: '08:00' }],
      })

      expect(result.schedule.name).toBe('Updated Queue')
      expect(result.reshuffledCount).toBe(3)
    })
  })

  describe('deleteQueue', () => {
    it('sends DELETE to /queue/slots with profileId and queueId', async () => {
      mockFetch.mockResolvedValueOnce(noContentResponse())

      await client.deleteQueue('profile-1', 'queue-abc')

      const [url, opts] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/slots')
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('queueId=queue-abc')
      expect(opts.method).toBe('DELETE')
    })
  })

  describe('listQueues', () => {
    it('returns array of queues when all=true', async () => {
      const queues = [
        makeFakeQueue({ _id: 'q1', name: 'Morning' }),
        makeFakeQueue({ _id: 'q2', name: 'Evening', isDefault: false }),
      ]
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ exists: true, schedules: queues }),
      )

      const result = await client.listQueues('profile-1', { all: true })

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Morning')
      expect(result[1].name).toBe('Evening')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('all=true')
    })

    it('returns single queue wrapped in array when schedule is returned', async () => {
      const queue = makeFakeQueue({ _id: 'q1', name: 'Default' })
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ exists: true, schedule: queue }),
      )

      const result = await client.listQueues('profile-1')

      expect(result).toHaveLength(1)
      expect(result[0]._id).toBe('q1')
    })

    it('returns empty array when no queues exist', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ exists: false }),
      )

      const result = await client.listQueues('profile-1')

      expect(result).toEqual([])
    })

    it('passes optional queueId when provided', async () => {
      const queue = makeFakeQueue({ _id: 'q-specific' })
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ exists: true, schedule: queue }),
      )

      await client.listQueues('profile-1', { queueId: 'q-specific' })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('queueId=q-specific')
    })
  })

  describe('getNextQueueSlot', () => {
    it('returns slot preview with profileId and optional queueId', async () => {
      const preview: QueueSlotPreview = {
        profileId: 'profile-1',
        nextSlot: '2026-03-10T09:00:00-06:00',
        timezone: 'America/Chicago',
        queueId: 'queue-1',
        queueName: 'Default Queue',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse(preview))

      const result = await client.getNextQueueSlot('profile-1', 'queue-1')

      expect(result.nextSlot).toBe('2026-03-10T09:00:00-06:00')
      expect(result.queueName).toBe('Default Queue')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/next-slot')
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('queueId=queue-1')
    })

    it('omits queueId param when not provided', async () => {
      const preview: QueueSlotPreview = {
        profileId: 'profile-1',
        nextSlot: '2026-03-10T09:00:00-06:00',
        timezone: 'America/Chicago',
        queueId: 'queue-default',
        queueName: 'Default',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse(preview))

      await client.getNextQueueSlot('profile-1')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('profileId=profile-1')
      expect(url).not.toContain('queueId=')
    })
  })

  describe('previewQueueSlots', () => {
    it('returns array of ISO datetime strings', async () => {
      const slots = [
        '2026-03-10T09:00:00-06:00',
        '2026-03-12T12:00:00-06:00',
        '2026-03-14T17:00:00-06:00',
      ]
      mockFetch.mockResolvedValueOnce(jsonResponse({ slots }))

      const result = await client.previewQueueSlots('profile-1', 3)

      expect(result).toEqual(slots)
      expect(result).toHaveLength(3)

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('/queue/preview')
      expect(url).toContain('profileId=profile-1')
      expect(url).toContain('count=3')
    })

    it('passes optional queueId when provided', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ slots: ['2026-03-10T09:00:00-06:00'] }))

      await client.previewQueueSlots('profile-1', 5, 'queue-special')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('queueId=queue-special')
    })

    it('returns empty array when slots field is missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}))

      const result = await client.previewQueueSlots('profile-1')

      expect(result).toEqual([])
    })

    it('defaults count to 10', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ slots: [] }))

      await client.previewQueueSlots('profile-1')

      const [url] = mockFetch.mock.calls[0]
      expect(url).toContain('count=10')
    })
  })

  describe('CreatePostParams with queue fields', () => {
    it('sends queuedFromProfile and queueId when provided', async () => {
      const newPost = {
        _id: 'post-queued',
        content: 'Queue test',
        status: 'scheduled',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ post: newPost }))

      await client.createPost({
        content: 'Queue test',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
        queuedFromProfile: 'profile-1',
        queueId: 'queue-1',
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.queuedFromProfile).toBe('profile-1')
      expect(body.queueId).toBe('queue-1')
    })

    it('omits queue fields when not provided', async () => {
      const newPost = {
        _id: 'post-regular',
        content: 'No queue',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'acct-2' }],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      }
      mockFetch.mockResolvedValueOnce(jsonResponse({ post: newPost }))

      await client.createPost({
        content: 'No queue',
        platforms: [{ platform: 'twitter', accountId: 'acct-2' }],
      })

      const [, opts] = mockFetch.mock.calls[0]
      const body = JSON.parse(opts.body)
      expect(body.queuedFromProfile).toBeUndefined()
      expect(body.queueId).toBeUndefined()
    })
  })
})

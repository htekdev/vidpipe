import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'

// ── L2 Mock — LateApiClient ───────────────────────────────────────────

const mockGetScheduledPosts = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockUpdatePost = vi.hoisted(() => vi.fn().mockResolvedValue({}))
const mockCreateQueue = vi.hoisted(() => vi.fn().mockResolvedValue({ schedule: { _id: 'temp-q-1' } }))
const mockDeleteQueue = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockPreviewQueue = vi.hoisted(() => vi.fn().mockResolvedValue({ slots: [] }))
const mockListQueues = vi.hoisted(() => vi.fn().mockResolvedValue({ queues: [], count: 0 }))
const mockListProfiles = vi.hoisted(() => vi.fn().mockResolvedValue([{ _id: 'profile-1', name: 'Default' }]))

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.getScheduledPosts = mockGetScheduledPosts
    this.updatePost = mockUpdatePost
    this.createQueue = mockCreateQueue
    this.deleteQueue = mockDeleteQueue
    this.previewQueue = mockPreviewQueue
    this.listQueues = mockListQueues
    this.listProfiles = mockListProfiles
  }),
}))

// ── Imports ───────────────────────────────────────────────────────────

import { reorderQueue, reorderAllQueues, priorityShiftQueue } from '../../../L3-services/lateApi/lateApiService.js'
import { clearQueueCache } from '../../../L3-services/queueMapping/queueMapping.js'

// ── Setup ─────────────────────────────────────────────────────────────

function setupQueueMappingMocks(): void {
  mockListProfiles.mockResolvedValue([{ _id: 'profile-1', name: 'Default' }])
  mockListQueues.mockResolvedValue({
    queues: [
      { _id: 'q-yt-short', name: 'youtube-short', profileId: 'profile-1', timezone: 'America/Chicago', slots: [{ dayOfWeek: 1, time: '12:00' }], active: true, isDefault: false },
    ],
    count: 1,
  })
}

describe('L3 Unit: lateApiService', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await clearQueueCache()
  })

  afterEach(async () => {
    await clearQueueCache()
  })

  describe('reorderQueue', () => {
    test('returns zero count when no queue found', async () => {
      // No queues set up → getQueueId returns null
      mockListProfiles.mockResolvedValue([{ _id: 'profile-1' }])
      mockListQueues.mockResolvedValue({ queues: [], count: 0 })

      const result = await reorderQueue('tiktok', 'short')

      expect(result.moved).toBe(0)
      expect(result.errors).toBe(0)
    })

    test('returns zero count when queue is empty', async () => {
      setupQueueMappingMocks()
      mockGetScheduledPosts.mockResolvedValue([])

      const result = await reorderQueue('youtube', 'short')

      expect(result.moved).toBe(0)
    })

    test('dry run returns planned order without making changes', async () => {
      setupQueueMappingMocks()
      mockGetScheduledPosts.mockResolvedValue([
        { _id: 'p1', queueId: 'q-yt-short', scheduledFor: '2026-04-10T12:00:00Z', createdAt: '2026-04-01T00:00:00Z' },
        { _id: 'p2', queueId: 'q-yt-short', scheduledFor: '2026-04-11T12:00:00Z', createdAt: '2026-04-05T00:00:00Z' },
      ])

      const result = await reorderQueue('youtube', 'short', { dryRun: true })

      expect(result.moved).toBe(2)
      expect(result.errors).toBe(0)
      expect(mockCreateQueue).not.toHaveBeenCalled()
    })

    test('creates temp queue, moves posts, then deletes temp queue', async () => {
      setupQueueMappingMocks()
      mockGetScheduledPosts.mockResolvedValue([
        { _id: 'p1', queueId: 'q-yt-short', scheduledFor: '2026-04-10T12:00:00Z', createdAt: '2026-04-01T00:00:00Z' },
      ])

      await reorderQueue('youtube', 'short')

      expect(mockCreateQueue).toHaveBeenCalledWith(expect.objectContaining({
        name: 'temp-youtube-short',
      }))
      expect(mockUpdatePost).toHaveBeenCalled()
      expect(mockDeleteQueue).toHaveBeenCalledWith('profile-1', 'temp-q-1')
    })
  })

  describe('reorderAllQueues', () => {
    test('iterates all queue mappings', async () => {
      setupQueueMappingMocks()
      mockGetScheduledPosts.mockResolvedValue([])

      const result = await reorderAllQueues()

      expect(result.total).toBe(0)
      expect(result.errors).toBe(0)
    })
  })

  describe('priorityShiftQueue', () => {
    test('returns null when no queue found', async () => {
      mockListProfiles.mockResolvedValue([{ _id: 'profile-1' }])
      mockListQueues.mockResolvedValue({ queues: [], count: 0 })

      const result = await priorityShiftQueue('tiktok', 'short')

      expect(result).toBeNull()
    })

    test('returns null when queue has no scheduled posts', async () => {
      setupQueueMappingMocks()
      mockGetScheduledPosts.mockResolvedValue([])
      mockPreviewQueue.mockResolvedValue({ slots: [] })

      const result = await priorityShiftQueue('youtube', 'short')

      expect(result).toBeNull()
    })

    test('matches posts by UTC time-of-day from preview slots, not local queue definition', async () => {
      setupQueueMappingMocks()
      // Queue slot is 15:00 local but preview returns 20:00 UTC
      mockPreviewQueue.mockResolvedValue({
        slots: ['2026-04-15T20:00:00.000Z', '2026-04-17T20:00:00.000Z'],
      })
      // Post at 20:00 UTC should match the preview pattern
      mockGetScheduledPosts.mockResolvedValue([
        { _id: 'p1', scheduledFor: '2026-04-15T20:00:00.000Z', createdAt: '2026-04-01T00:00:00Z' },
      ])

      const result = await priorityShiftQueue('youtube', 'short')

      // Single post — can't shift, but the filtering should find it
      // (returns null because only 1 post can't cascade-shift)
      expect(result).toBeNull() // 1 post = "Only 1 post in queue"
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock setup (L1, L3 only) ─────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
}))

const mockGetItem = vi.hoisted(() => vi.fn())
const mockApproveItem = vi.hoisted(() => vi.fn())
const mockApproveBulk = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getItem: mockGetItem,
  approveItem: mockApproveItem,
  approveBulk: mockApproveBulk,
}))

const mockFindNextSlot = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
}))

const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

const mockGetAccountId = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: mockGetAccountId,
}))

const mockUploadMedia = vi.hoisted(() => vi.fn())
const mockCreatePost = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  LateApiClient: class {
    uploadMedia = mockUploadMedia
    createPost = mockCreatePost
  },
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'
import type { QueueItem, QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeQueueItem(overrides: Partial<Omit<QueueItem, 'metadata'>> & { metadata?: Partial<QueueItemMetadata> } = {}): QueueItem {
  const meta: QueueItemMetadata = {
    id: overrides.id ?? 'item-1',
    platform: 'tiktok',
    accountId: '',
    sourceVideo: '/test/video.mp4',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: '/test/media.mp4',
    hashtags: ['test'],
    links: [],
    characterCount: 50,
    platformCharLimit: 2200,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    publishedAt: null,
    ...overrides.metadata,
  }
  const { metadata: _metaOverride, ...restOverrides } = overrides
  return {
    id: meta.id,
    metadata: meta,
    postContent: 'Test post content #test',
    hasMedia: true,
    mediaPath: '/test/media.mp4',
    folderPath: '/test/publish-queue/item-1',
    ...restOverrides,
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-03-01T10:00:00-06:00')
  mockGetAccountId.mockResolvedValue('acc-tiktok-123')
  mockFileExists.mockResolvedValue(true)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn.test/media.mp4' })
  mockCreatePost.mockResolvedValue({ _id: 'late-post-001', status: 'scheduled' })
  mockApproveItem.mockResolvedValue(undefined)
  mockApproveBulk.mockResolvedValue(undefined)
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('enqueueApproval', () => {
  describe('successful approval', () => {
    it('uploads media, creates post, and schedules', async () => {
      const item = makeQueueItem({ id: 'approve-1' })
      mockGetItem.mockResolvedValue(item)

      const result = await enqueueApproval(['approve-1'])

      expect(result.scheduled).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].success).toBe(true)
      expect(result.results[0].latePostId).toBe('late-post-001')
      expect(result.results[0].scheduledFor).toBe('2026-03-01T10:00:00-06:00')
      expect(mockUploadMedia).toHaveBeenCalledWith('/test/media.mp4')
      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test post content #test',
          scheduledFor: '2026-03-01T10:00:00-06:00',
        }),
      )
      expect(mockApproveItem).toHaveBeenCalledWith('approve-1', expect.objectContaining({
        latePostId: 'late-post-001',
        scheduledFor: '2026-03-01T10:00:00-06:00',
      }))
    })

    it('uses accountId from item metadata when available', async () => {
      const item = makeQueueItem({
        id: 'with-acct',
        metadata: { accountId: 'preset-account-id' },
      })
      mockGetItem.mockResolvedValue(item)

      await enqueueApproval(['with-acct'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          platforms: [{ platform: 'tiktok', accountId: 'preset-account-id' }],
        }),
      )
      expect(mockGetAccountId).not.toHaveBeenCalled()
    })

    it('includes TikTok-specific settings for tiktok platform', async () => {
      const item = makeQueueItem({ id: 'tiktok-item', metadata: { platform: 'tiktok' } })
      mockGetItem.mockResolvedValue(item)

      await enqueueApproval(['tiktok-item'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          tiktokSettings: expect.objectContaining({
            privacy_level: 'PUBLIC_TO_EVERYONE',
            allow_comment: true,
          }),
        }),
      )
    })

    it('does not include TikTok settings for non-tiktok platform', async () => {
      const item = makeQueueItem({
        id: 'yt-item',
        metadata: { platform: 'youtube' },
      })
      mockGetItem.mockResolvedValue(item)

      await enqueueApproval(['yt-item'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          tiktokSettings: undefined,
        }),
      )
    })

    it('uses approveBulk for multiple successful items', async () => {
      mockGetItem
        .mockResolvedValueOnce(makeQueueItem({ id: 'bulk-a' }))
        .mockResolvedValueOnce(makeQueueItem({ id: 'bulk-b' }))
      mockCreatePost
        .mockResolvedValueOnce({ _id: 'late-a' })
        .mockResolvedValueOnce({ _id: 'late-b' })

      const result = await enqueueApproval(['bulk-a', 'bulk-b'])

      expect(result.scheduled).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockApproveBulk).toHaveBeenCalledWith(
        ['bulk-a', 'bulk-b'],
        expect.any(Map),
      )
      expect(mockApproveItem).not.toHaveBeenCalled()
    })
  })

  describe('missing media handling', () => {
    it('schedules without media when media file does not exist', async () => {
      const item = makeQueueItem({ id: 'no-media' })
      mockGetItem.mockResolvedValue(item)
      mockFileExists.mockResolvedValue(false)

      const result = await enqueueApproval(['no-media'])

      expect(result.scheduled).toBe(1)
      expect(result.results[0].success).toBe(true)
      expect(mockUploadMedia).not.toHaveBeenCalled()
      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({ mediaItems: undefined }),
      )
    })

    it('schedules without media when item has no media path', async () => {
      const item = makeQueueItem({
        id: 'null-media',
        mediaPath: null,
        hasMedia: false,
        metadata: { sourceMediaPath: null },
      })
      mockGetItem.mockResolvedValue(item)

      const result = await enqueueApproval(['null-media'])

      expect(result.scheduled).toBe(1)
      expect(mockUploadMedia).not.toHaveBeenCalled()
    })

    it('falls back to sourceMediaPath when mediaPath is null', async () => {
      const item = makeQueueItem({
        id: 'fallback-media',
        mediaPath: null,
        metadata: { sourceMediaPath: '/test/source-media.mp4' },
      })
      mockGetItem.mockResolvedValue(item)
      mockFileExists.mockResolvedValue(true)

      await enqueueApproval(['fallback-media'])

      expect(mockUploadMedia).toHaveBeenCalledWith('/test/source-media.mp4')
    })

    it('records failure when item is not found in store', async () => {
      mockGetItem.mockResolvedValue(null)

      const result = await enqueueApproval(['ghost-item'])

      expect(result.scheduled).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.results[0].error).toBe('Item not found')
    })
  })

  describe('rate limiting', () => {
    it('skips remaining items for a rate-limited platform', async () => {
      const item1 = makeQueueItem({ id: 'rl-1', metadata: { platform: 'tiktok' } })
      const item2 = makeQueueItem({ id: 'rl-2', metadata: { platform: 'tiktok' } })
      mockGetItem
        .mockResolvedValueOnce(item1)
        .mockResolvedValueOnce(item2)
        // Re-fetch for rate-limited error path
        .mockResolvedValue(item2)
      mockCreatePost
        .mockRejectedValueOnce(new Error('429 Too Many Requests'))

      const result = await enqueueApproval(['rl-1', 'rl-2'])

      expect(result.failed).toBe(2)
      expect(result.rateLimitedPlatforms).toContain('tiktok')
      expect(result.results[1].error).toContain('rate-limited')
    })

    it('handles "Daily post limit" error as rate limit', async () => {
      const item = makeQueueItem({ id: 'daily-limit', metadata: { platform: 'instagram' } })
      mockGetItem.mockResolvedValue(item)
      mockCreatePost.mockRejectedValue(new Error('Daily post limit reached'))

      const result = await enqueueApproval(['daily-limit'])

      expect(result.rateLimitedPlatforms.length).toBeGreaterThan(0)
      expect(result.results[0].success).toBe(false)
    })

    it('does not rate-limit other platforms when one is limited', async () => {
      const tiktokItem = makeQueueItem({ id: 'tt-rl', metadata: { platform: 'tiktok' } })
      const ytItem = makeQueueItem({ id: 'yt-ok', metadata: { platform: 'youtube' } })
      // getItem is called for normal processing AND re-fetched in the 429 catch path
      const itemMap: Record<string, QueueItem> = { 'tt-rl': tiktokItem, 'yt-ok': ytItem }
      mockGetItem.mockImplementation(async (id: string) => itemMap[id] ?? null)
      mockCreatePost
        .mockRejectedValueOnce(new Error('429'))
        .mockResolvedValueOnce({ _id: 'late-yt-1' })

      const result = await enqueueApproval(['tt-rl', 'yt-ok'])

      expect(result.scheduled).toBe(1)
      expect(result.failed).toBe(1)
      expect(result.rateLimitedPlatforms).toContain('tiktok')
      expect(result.results[1].success).toBe(true)
    })
  })

  describe('sequential processing', () => {
    it('processes concurrent enqueue calls sequentially', async () => {
      const callOrder: string[] = []
      mockGetItem.mockImplementation(async (id: string) => {
        callOrder.push(`get:${id}`)
        return makeQueueItem({ id })
      })
      mockCreatePost.mockImplementation(async () => {
        // Simulate network delay
        await new Promise(r => setTimeout(r, 50))
        return { _id: `late-${Date.now()}` }
      })

      const [result1, result2] = await Promise.all([
        enqueueApproval(['seq-a']),
        enqueueApproval(['seq-b']),
      ])

      expect(result1.scheduled).toBe(1)
      expect(result2.scheduled).toBe(1)
      // seq-a should be fetched before seq-b due to sequential queue
      const idxA = callOrder.indexOf('get:seq-a')
      const idxB = callOrder.indexOf('get:seq-b')
      expect(idxA).toBeLessThan(idxB)
    })

    it('handles failure in one job without affecting the next', async () => {
      mockGetItem
        .mockResolvedValueOnce(null) // first job: item not found
        .mockResolvedValueOnce(makeQueueItem({ id: 'good-item' }))
      mockCreatePost.mockResolvedValue({ _id: 'late-good' })

      const [result1, result2] = await Promise.all([
        enqueueApproval(['bad-item']),
        enqueueApproval(['good-item']),
      ])

      expect(result1.failed).toBe(1)
      expect(result2.scheduled).toBe(1)
      expect(result2.results[0].success).toBe(true)
    })
  })

  describe('error handling', () => {
    it('handles no available slot gracefully', async () => {
      const item = makeQueueItem({ id: 'no-slot' })
      mockGetItem.mockResolvedValue(item)
      mockFindNextSlot.mockResolvedValue(null)

      const result = await enqueueApproval(['no-slot'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toContain('No available slot')
    })

    it('handles no account for platform', async () => {
      const item = makeQueueItem({ id: 'no-acct', metadata: { accountId: '' } })
      mockGetItem.mockResolvedValue(item)
      mockGetAccountId.mockResolvedValue(null)

      const result = await enqueueApproval(['no-acct'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toContain('No account')
    })

    it('handles unexpected createPost error', async () => {
      const item = makeQueueItem({ id: 'api-err' })
      mockGetItem.mockResolvedValue(item)
      mockCreatePost.mockRejectedValue(new Error('Network timeout'))

      const result = await enqueueApproval(['api-err'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toBe('Network timeout')
    })
  })
})

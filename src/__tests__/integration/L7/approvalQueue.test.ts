import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub fetch globally so queueMapping doesn't hit real Late API
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({ queues: [], count: 0, profiles: [] }),
  headers: new Map(),
}))

// ── Mock setup (L1, L3 only) ─────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: vi.fn(),
  fileExistsSync: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
  removeDirectory: vi.fn(),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'test-output' }),
}))

const mockGetContentItems = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  getContentItems: mockGetContentItems,
}))

const mockAzureApproveItem = vi.hoisted(() => vi.fn())
const mockMarkPublished = vi.hoisted(() => vi.fn())
const mockDownloadMediaToFile = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/azureStorage/azureReviewDataSource.js', () => ({
  getItemById: vi.fn(),
  approveItem: mockAzureApproveItem,
  markPublished: mockMarkPublished,
  downloadMediaToFile: mockDownloadMediaToFile,
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
  createLateApiClient: () => ({
    uploadMedia: mockUploadMedia,
    createPost: mockCreatePost,
  }),
}))

const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: vi.fn().mockResolvedValue(null),
  getProfileId: vi.fn().mockResolvedValue(null),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'
import type { ContentRecord } from '../../../L3-services/azureStorage/azureStorageService.js'

// ── Helpers ─────────────────────────────────────────────────────────────

type FullContentRecord = ContentRecord & { partitionKey: string; rowKey: string }

function makeContentRecord(overrides: Partial<FullContentRecord> = {}): FullContentRecord {
  const rowKey = overrides.rowKey ?? 'item-1'
  return {
    partitionKey: overrides.partitionKey ?? 'test-video',
    rowKey,
    platform: 'tiktok',
    clipType: 'short',
    status: 'pending_review' as const,
    blobBasePath: `content/${rowKey}/`,
    mediaType: 'video',
    mediaFilename: 'media.mp4',
    postContent: 'Test post content #test',
    hashtags: 'test',
    characterCount: 50,
    scheduledFor: '',
    latePostId: '',
    publishedUrl: '',
    sourceVideoRunId: '',
    thumbnailFilename: '',
    ideaIds: '',
    createdAt: new Date().toISOString(),
    reviewedAt: '',
    publishedAt: '',
    ...overrides,
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-03-01T10:00:00-06:00')
  mockGetAccountId.mockResolvedValue('acc-tiktok-123')
  mockDownloadMediaToFile.mockResolvedValue(undefined)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn.test/media.mp4' })
  mockCreatePost.mockResolvedValue({ _id: 'late-post-001', status: 'scheduled' })
  mockAzureApproveItem.mockResolvedValue(undefined)
  mockMarkPublished.mockResolvedValue(undefined)
  mockGetIdeasByIds.mockResolvedValue([])
  mockGetContentItems.mockResolvedValue([])
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('enqueueApproval', () => {
  describe('successful approval', () => {
    it('downloads media from Azure, creates post, and schedules', async () => {
      const record = makeContentRecord({ rowKey: 'approve-1' })
      mockGetContentItems.mockResolvedValue([record])

      const result = await enqueueApproval(['approve-1'])

      expect(result.scheduled).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.results).toHaveLength(1)
      expect(result.results[0].success).toBe(true)
      expect(result.results[0].latePostId).toBe('late-post-001')
      expect(result.results[0].scheduledFor).toBe('2026-03-01T10:00:00-06:00')
      expect(mockDownloadMediaToFile).toHaveBeenCalled()
      expect(mockUploadMedia).toHaveBeenCalled()
      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Test post content #test',
          scheduledFor: '2026-03-01T10:00:00-06:00',
        }),
      )
      expect(mockAzureApproveItem).toHaveBeenCalledWith('test-video', 'approve-1')
      expect(mockMarkPublished).toHaveBeenCalledWith('test-video', 'approve-1', expect.objectContaining({
        latePostId: 'late-post-001',
      }))
    })

    it('uses accountId from getAccountId mapping', async () => {
      const record = makeContentRecord({ rowKey: 'with-acct' })
      mockGetContentItems.mockResolvedValue([record])
      mockGetAccountId.mockResolvedValue('mapped-account-id')

      await enqueueApproval(['with-acct'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          platforms: [{ platform: 'tiktok', accountId: 'mapped-account-id' }],
        }),
      )
      expect(mockGetAccountId).toHaveBeenCalled()
    })

    it('includes TikTok-specific settings for tiktok platform', async () => {
      const record = makeContentRecord({ rowKey: 'tiktok-item', platform: 'tiktok' })
      mockGetContentItems.mockResolvedValue([record])

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

    it('creates post with isDraft: false to prevent draft status', async () => {
      const record = makeContentRecord({ rowKey: 'draft-fix' })
      mockGetContentItems.mockResolvedValue([record])

      await enqueueApproval(['draft-fix'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({ isDraft: false }),
      )
    })

    it('does not include TikTok settings for non-tiktok platform', async () => {
      const record = makeContentRecord({ rowKey: 'yt-item', platform: 'youtube' })
      mockGetContentItems.mockResolvedValue([record])

      await enqueueApproval(['yt-item'])

      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          tiktokSettings: undefined,
        }),
      )
    })

    it('calls approveItem and markPublished for each item in batch', async () => {
      const records = [
        makeContentRecord({ rowKey: 'bulk-a' }),
        makeContentRecord({ rowKey: 'bulk-b' }),
      ]
      mockGetContentItems.mockResolvedValue(records)
      mockCreatePost
        .mockResolvedValueOnce({ _id: 'late-a' })
        .mockResolvedValueOnce({ _id: 'late-b' })

      const result = await enqueueApproval(['bulk-a', 'bulk-b'])

      expect(result.scheduled).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockAzureApproveItem).toHaveBeenCalledTimes(2)
      expect(mockMarkPublished).toHaveBeenCalledTimes(2)
    })
  })

  describe('missing media handling', () => {
    it('schedules without media when record has no mediaFilename', async () => {
      const record = makeContentRecord({ rowKey: 'no-media', mediaFilename: '' })
      mockGetContentItems.mockResolvedValue([record])

      const result = await enqueueApproval(['no-media'])

      expect(result.scheduled).toBe(1)
      expect(result.results[0].success).toBe(true)
      expect(mockDownloadMediaToFile).not.toHaveBeenCalled()
      expect(mockUploadMedia).not.toHaveBeenCalled()
      expect(mockCreatePost).toHaveBeenCalledWith(
        expect.objectContaining({ mediaItems: undefined }),
      )
    })

    it('schedules without media when mediaFilename is empty', async () => {
      const record = makeContentRecord({ rowKey: 'null-media', mediaFilename: '' })
      mockGetContentItems.mockResolvedValue([record])

      const result = await enqueueApproval(['null-media'])

      expect(result.scheduled).toBe(1)
      expect(mockDownloadMediaToFile).not.toHaveBeenCalled()
      expect(mockUploadMedia).not.toHaveBeenCalled()
    })

    it('downloads media from Azure blob and uploads to Late', async () => {
      const record = makeContentRecord({ rowKey: 'blob-media', mediaFilename: 'source-media.mp4' })
      mockGetContentItems.mockResolvedValue([record])

      await enqueueApproval(['blob-media'])

      expect(mockDownloadMediaToFile).toHaveBeenCalledWith(
        'blob-media', 'source-media.mp4', expect.stringContaining('blob-media-source-media.mp4'),
      )
      expect(mockUploadMedia).toHaveBeenCalled()
    })

    it('records failure when item is not found in store', async () => {
      mockGetContentItems.mockResolvedValue([])

      const result = await enqueueApproval(['ghost-item'])

      expect(result.scheduled).toBe(0)
      expect(result.failed).toBe(1)
      expect(result.results[0].error).toBe('Item not found')
    })
  })

  describe('rate limiting', () => {
    it('skips remaining items for a rate-limited platform', async () => {
      const records = [
        makeContentRecord({ rowKey: 'rl-1', platform: 'tiktok' }),
        makeContentRecord({ rowKey: 'rl-2', platform: 'tiktok' }),
      ]
      mockGetContentItems.mockResolvedValue(records)
      mockCreatePost
        .mockRejectedValueOnce(new Error('429 Too Many Requests'))

      const result = await enqueueApproval(['rl-1', 'rl-2'])

      expect(result.failed).toBe(2)
      expect(result.rateLimitedPlatforms).toContain('tiktok')
      expect(result.results[1].error).toContain('rate-limited')
    })

    it('handles "Daily post limit" error as rate limit', async () => {
      const record = makeContentRecord({ rowKey: 'daily-limit', platform: 'instagram' })
      mockGetContentItems.mockResolvedValue([record])
      mockCreatePost.mockRejectedValue(new Error('Daily post limit reached'))

      const result = await enqueueApproval(['daily-limit'])

      expect(result.rateLimitedPlatforms.length).toBeGreaterThan(0)
      expect(result.results[0].success).toBe(false)
    })

    it('does not rate-limit other platforms when one is limited', async () => {
      const records = [
        makeContentRecord({ rowKey: 'tt-rl', platform: 'tiktok' }),
        makeContentRecord({ rowKey: 'yt-ok', platform: 'youtube' }),
      ]
      mockGetContentItems.mockResolvedValue(records)
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
      const records = [
        makeContentRecord({ rowKey: 'seq-a' }),
        makeContentRecord({ rowKey: 'seq-b' }),
      ]
      mockGetContentItems.mockResolvedValue(records)
      mockCreatePost.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 50))
        return { _id: `late-${Date.now()}` }
      })
      mockAzureApproveItem.mockImplementation(async (_slug: string, id: string) => {
        callOrder.push(`approve:${id}`)
      })

      const [result1, result2] = await Promise.all([
        enqueueApproval(['seq-a']),
        enqueueApproval(['seq-b']),
      ])

      expect(result1.scheduled).toBe(1)
      expect(result2.scheduled).toBe(1)
      const idxA = callOrder.indexOf('approve:seq-a')
      const idxB = callOrder.indexOf('approve:seq-b')
      expect(idxA).toBeLessThan(idxB)
    })

    it('handles failure in one job without affecting the next', async () => {
      const goodRecord = makeContentRecord({ rowKey: 'good-item' })
      // First batch: bad-item not found (pending query empty, fallback empty)
      // Second batch: good-item found
      mockGetContentItems
        .mockResolvedValueOnce([])        // batch 1: pending query
        .mockResolvedValueOnce([])        // batch 1: fallback all query
        .mockResolvedValueOnce([goodRecord]) // batch 2: pending query
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
      const record = makeContentRecord({ rowKey: 'no-slot' })
      mockGetContentItems.mockResolvedValue([record])
      mockFindNextSlot.mockResolvedValue(null)

      const result = await enqueueApproval(['no-slot'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toContain('No available slot')
    })

    it('handles no account for platform', async () => {
      const record = makeContentRecord({ rowKey: 'no-acct' })
      mockGetContentItems.mockResolvedValue([record])
      mockGetAccountId.mockResolvedValue(null)

      const result = await enqueueApproval(['no-acct'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toContain('No account')
    })

    it('handles unexpected createPost error', async () => {
      const record = makeContentRecord({ rowKey: 'api-err' })
      mockGetContentItems.mockResolvedValue([record])
      mockCreatePost.mockRejectedValue(new Error('Network timeout'))

      const result = await enqueueApproval(['api-err'])

      expect(result.failed).toBe(1)
      expect(result.results[0].error).toBe('Network timeout')
    })
  })

  describe('publishBy sorting', () => {
    it('processes idea-linked items before non-idea items', async () => {
      const ideaRecord = makeContentRecord({
        rowKey: 'idea-first',
        ideaIds: '42',
        createdAt: '2026-03-10T00:00:00Z',
      })
      const plainRecord = makeContentRecord({
        rowKey: 'plain-last',
        ideaIds: '',
        createdAt: '2026-03-01T00:00:00Z',
      })
      mockGetContentItems.mockResolvedValue([ideaRecord, plainRecord])
      mockGetIdeasByIds.mockResolvedValue([
        { id: '42', issueNumber: 42, publishBy: '2026-03-15' },
      ])

      // Input order: plain-last first, but idea-first should be processed first
      const result = await enqueueApproval(['plain-last', 'idea-first'])

      expect(result.scheduled).toBe(2)
      expect(result.results[0].itemId).toBe('idea-first')
      expect(result.results[1].itemId).toBe('plain-last')
    })
  })

  describe('thumbnail handling', () => {
    it('passes thumbnail as string URL to createPost mediaItems', async () => {
      const record = makeContentRecord({
        rowKey: 'item-1',
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumb.png',
      })
      mockGetContentItems.mockResolvedValue([record])
      mockUploadMedia
        .mockResolvedValueOnce({ url: 'https://cdn/media.mp4', type: 'video' })
        .mockResolvedValueOnce({ url: 'https://cdn/thumb.png', type: 'image' })
      mockCreatePost.mockResolvedValue({ _id: 'late-1' })

      await enqueueApproval(['item-1'])

      const createPostCall = mockCreatePost.mock.calls[0]?.[0]
      if (createPostCall?.mediaItems?.[0]?.thumbnail) {
        expect(typeof createPostCall.mediaItems[0].thumbnail).toBe('string')
        expect(createPostCall.mediaItems[0].thumbnail).toBe('https://cdn/thumb.png')
      }
    })

    it('sets instagramThumbnail in platformSpecificData for instagram', async () => {
      const record = makeContentRecord({
        rowKey: 'item-1',
        platform: 'instagram',
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumb.png',
      })
      mockGetContentItems.mockResolvedValue([record])
      mockUploadMedia
        .mockResolvedValueOnce({ url: 'https://cdn/media.mp4', type: 'video' })
        .mockResolvedValueOnce({ url: 'https://cdn/ig-thumb.png', type: 'image' })
      mockCreatePost.mockResolvedValue({ _id: 'late-ig' })

      await enqueueApproval(['item-1'])

      const call = mockCreatePost.mock.calls[0]?.[0]
      if (call?.platformSpecificData) {
        expect(call.platformSpecificData.instagramThumbnail).toBe('https://cdn/ig-thumb.png')
      }
    })
  })
})
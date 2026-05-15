import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub fetch globally so queueMapping doesn't hit real Late API
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({ queues: [], count: 0, profiles: [] }),
  headers: new Map(),
}))

// ── Mocks (L1 infra + L3 services) ─────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'C:\\test-output' }),
}))

const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockRemoveDirectory = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: mockEnsureDirectory,
  removeDirectory: mockRemoveDirectory,
  fileExistsSync: vi.fn().mockReturnValue(false),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...args: string[]) => args.join('/'),
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

const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
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
    createPost: mockCreatePost,
    uploadMedia: mockUploadMedia,
  }),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'
import logger from '../../../L1-infra/logger/configLogger.js'

// ── Helpers ──────────────────────────────────────────────────────────────

interface ContentRecordOverrides {
  platform?: string
  clipType?: string
  ideaIds?: string
  mediaFilename?: string
  thumbnailFilename?: string
  postContent?: string
  videoSlug?: string
}

function makeContentRecord(id: string, overrides: ContentRecordOverrides = {}) {
  return {
    partitionKey: overrides.videoSlug ?? 'test-video',
    rowKey: id,
    platform: overrides.platform ?? 'youtube',
    clipType: overrides.clipType ?? 'short',
    status: 'pending_review' as const,
    blobBasePath: `content/${id}/`,
    mediaType: 'video',
    mediaFilename: overrides.mediaFilename ?? 'media.mp4',
    postContent: overrides.postContent ?? id,
    hashtags: '',
    characterCount: 10,
    scheduledFor: '',
    latePostId: '',
    publishedUrl: '',
    sourceVideoRunId: 'run-1',
    thumbnailFilename: overrides.thumbnailFilename ?? '',
    ideaIds: overrides.ideaIds ?? '',
    createdAt: new Date().toISOString(),
    reviewedAt: '',
    publishedAt: '',
  }
}

function mockContentRecords(records: ReturnType<typeof makeContentRecord>[]): void {
  mockGetContentItems.mockImplementation(async (filters?: { status?: string }) => {
    if (filters?.status) return records.filter(r => r.status === filters.status)
    return records
  })
}

// ── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
  mockGetIdeasByIds.mockResolvedValue([])
  mockGetAccountId.mockResolvedValue('acc-123')
  mockDownloadMediaToFile.mockResolvedValue(undefined)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' })
  mockCreatePost.mockImplementation(async ({ content }: { content: string }) => ({
    _id: `late-${content}`, status: 'scheduled',
  }))
  mockAzureApproveItem.mockResolvedValue(undefined)
  mockMarkPublished.mockResolvedValue(undefined)
  mockEnsureDirectory.mockResolvedValue(undefined)
  mockRemoveDirectory.mockResolvedValue(undefined)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue — thumbnail upload', () => {
  it('uploads thumbnail and attaches to media item when thumbnailFilename is present', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })    // media upload
      .mockResolvedValueOnce({ type: 'image', url: 'https://cdn/thumb.png' }) // thumbnail upload

    mockContentRecords([
      makeContentRecord('item-1', {
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        postContent: 'Thumbnail test',
      }),
    ])

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    expect(mockUploadMedia).toHaveBeenCalledTimes(2)
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaItems: expect.arrayContaining([
          expect.objectContaining({
            thumbnail: 'https://cdn/thumb.png',
          }),
        ]),
      }),
    )
  })

  it('skips thumbnail upload when no thumbnailFilename exists', async () => {
    mockContentRecords([
      makeContentRecord('item-3', {
        mediaFilename: 'media.mp4',
        thumbnailFilename: '',
        postContent: 'No thumb',
      }),
    ])

    const result = await enqueueApproval(['item-3'])

    expect(result.scheduled).toBe(1)
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
  })

  it('logs warning but continues when thumbnail upload fails', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })    // media ok
      .mockRejectedValueOnce(new Error('Upload failed: 413 too large'))        // thumbnail fails

    mockContentRecords([
      makeContentRecord('item-5', {
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        postContent: 'Thumb upload fail',
      }),
    ])

    const result = await enqueueApproval(['item-5'])

    expect(result.scheduled).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockCreatePost).toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upload thumbnail'),
    )
  })

  it('does not include thumbnail field in media when upload fails', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })
      .mockRejectedValueOnce(new Error('Upload failed'))

    mockContentRecords([
      makeContentRecord('item-6', {
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        postContent: 'No thumb in post',
      }),
    ])

    await enqueueApproval(['item-6'])

    const createPostArgs = mockCreatePost.mock.calls[0][0]
    const mediaItem = createPostArgs.mediaItems[0]
    expect(mediaItem.thumbnail).toBeUndefined()
  })

  it('sets instagramThumbnail in platformSpecificData for instagram posts', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })
      .mockResolvedValueOnce({ type: 'image', url: 'https://cdn/thumb.png' })

    mockContentRecords([
      makeContentRecord('item-ig', {
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        platform: 'instagram',
        postContent: 'IG post',
      }),
    ])

    await enqueueApproval(['item-ig'])

    const createPostArgs = mockCreatePost.mock.calls[0][0]
    expect(createPostArgs.platformSpecificData).toBeDefined()
    expect(createPostArgs.platformSpecificData.instagramThumbnail).toBe('https://cdn/thumb.png')
  })
})

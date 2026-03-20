import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks (L1 infra + L3 services) ─────────────────────────────────────

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

interface QueueItemOverrides {
  platform?: string
  accountId?: string
  clipType?: 'video' | 'short' | 'medium-clip'
  ideaIds?: string[]
  mediaPath?: string | null
  sourceMediaPath?: string | null
  postContent?: string
  thumbnailPath?: string | null
  metadataThumbnailPath?: string | null
}

function makeItem(id: string, overrides: QueueItemOverrides = {}) {
  return {
    id,
    metadata: {
      id,
      platform: overrides.platform ?? 'youtube',
      accountId: overrides.accountId ?? 'acc-yt',
      sourceVideo: '/v.mp4',
      sourceClip: null,
      clipType: overrides.clipType ?? 'short',
      sourceMediaPath: overrides.sourceMediaPath ?? null,
      hashtags: [],
      links: [],
      characterCount: 10,
      platformCharLimit: 5000,
      suggestedSlot: null,
      scheduledFor: null,
      status: 'pending_review' as const,
      latePostId: null,
      publishedUrl: null,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      publishedAt: null,
      ...(overrides.ideaIds ? { ideaIds: overrides.ideaIds } : {}),
      ...(overrides.metadataThumbnailPath !== undefined
        ? { thumbnailPath: overrides.metadataThumbnailPath }
        : {}),
    },
    postContent: overrides.postContent ?? id,
    hasMedia: Boolean(overrides.mediaPath ?? overrides.sourceMediaPath),
    mediaPath: overrides.mediaPath ?? null,
    thumbnailPath: overrides.thumbnailPath ?? null,
    folderPath: `/queue/${id}`,
  }
}

function mockItemsById(items: Record<string, ReturnType<typeof makeItem>>): void {
  mockGetItem.mockImplementation(async (id: string) => items[id] ?? null)
}

// ── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
  mockGetIdeasByIds.mockResolvedValue([])
  mockGetAccountId.mockResolvedValue('acc-123')
  mockFileExists.mockResolvedValue(true)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' })
  mockCreatePost.mockImplementation(async ({ content }: { content: string }) => ({
    _id: `late-${content}`, status: 'scheduled',
  }))
  mockApproveItem.mockResolvedValue(undefined)
  mockApproveBulk.mockResolvedValue(undefined)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue — thumbnail upload', () => {
  it('uploads thumbnail and attaches to media item when thumbnailPath is present', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })    // media upload
      .mockResolvedValueOnce({ type: 'image', url: 'https://cdn/thumb.png' }) // thumbnail upload

    mockItemsById({
      'item-1': makeItem('item-1', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: '/recordings/test/thumbnail.png',
        postContent: 'Thumbnail test',
      }),
    })

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    // uploadMedia called twice: once for video, once for thumbnail
    expect(mockUploadMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadMedia).toHaveBeenNthCalledWith(1, '/m.mp4')
    expect(mockUploadMedia).toHaveBeenNthCalledWith(2, '/recordings/test/thumbnail.png')
    // createPost receives media with thumbnail attached
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

  it('falls back to metadata.thumbnailPath when item.thumbnailPath is null', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })
      .mockResolvedValueOnce({ type: 'image', url: 'https://cdn/thumb-meta.png' })

    mockItemsById({
      'item-2': makeItem('item-2', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: null,
        metadataThumbnailPath: '/queue/item-2/thumbnail.png',
        postContent: 'Metadata thumb test',
      }),
    })

    const result = await enqueueApproval(['item-2'])

    expect(result.scheduled).toBe(1)
    expect(mockUploadMedia).toHaveBeenCalledTimes(2)
    expect(mockUploadMedia).toHaveBeenNthCalledWith(2, '/queue/item-2/thumbnail.png')
  })

  it('skips thumbnail upload when no thumbnailPath exists', async () => {
    mockItemsById({
      'item-3': makeItem('item-3', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: null,
        metadataThumbnailPath: null,
        postContent: 'No thumb',
      }),
    })

    const result = await enqueueApproval(['item-3'])

    expect(result.scheduled).toBe(1)
    // Only one upload: the media itself
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
    expect(mockUploadMedia).toHaveBeenCalledWith('/m.mp4')
  })

  it('skips thumbnail upload when thumbnail file does not exist on disk', async () => {
    // First call: media file exists; second call: thumbnail does not
    mockFileExists
      .mockResolvedValueOnce(true)   // media path exists
      .mockResolvedValueOnce(false)  // thumbnail path does not exist

    mockItemsById({
      'item-4': makeItem('item-4', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: '/recordings/test/missing-thumb.png',
        postContent: 'Missing thumb',
      }),
    })

    const result = await enqueueApproval(['item-4'])

    expect(result.scheduled).toBe(1)
    // Only one upload: the media (thumbnail skipped because file doesn't exist)
    expect(mockUploadMedia).toHaveBeenCalledTimes(1)
  })

  it('logs warning but continues when thumbnail upload fails', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })    // media ok
      .mockRejectedValueOnce(new Error('Upload failed: 413 too large'))        // thumbnail fails

    mockItemsById({
      'item-5': makeItem('item-5', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: '/recordings/test/large-thumb.png',
        postContent: 'Thumb upload fail',
      }),
    })

    const result = await enqueueApproval(['item-5'])

    // Post still scheduled successfully despite thumbnail failure
    expect(result.scheduled).toBe(1)
    expect(result.failed).toBe(0)
    expect(mockCreatePost).toHaveBeenCalled()
    // Warning logged about thumbnail failure
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to upload thumbnail'),
    )
  })

  it('does not include thumbnail field in media when upload fails', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })
      .mockRejectedValueOnce(new Error('Upload failed'))

    mockItemsById({
      'item-6': makeItem('item-6', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: '/recordings/test/thumb.png',
        postContent: 'No thumb in post',
      }),
    })

    await enqueueApproval(['item-6'])

    const createPostArgs = mockCreatePost.mock.calls[0][0]
    const mediaItem = createPostArgs.mediaItems[0]
    // thumbnail should NOT be set since upload failed
    expect(mediaItem.thumbnail).toBeUndefined()
  })

  it('sets instagramThumbnail in platformSpecificData for instagram posts', async () => {
    mockUploadMedia
      .mockResolvedValueOnce({ type: 'video', url: 'https://cdn/v.mp4' })
      .mockResolvedValueOnce({ type: 'image', url: 'https://cdn/thumb.png' })

    mockItemsById({
      'item-ig': makeItem('item-ig', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        thumbnailPath: '/recordings/test/thumbnail.png',
        platform: 'instagram',
        postContent: 'IG post',
      }),
    })

    await enqueueApproval(['item-ig'])

    const createPostArgs = mockCreatePost.mock.calls[0][0]
    expect(createPostArgs.platformSpecificData).toBeDefined()
    expect(createPostArgs.platformSpecificData.instagramThumbnail).toBe('https://cdn/thumb.png')
  })
})

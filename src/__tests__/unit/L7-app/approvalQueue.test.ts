import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks (L3 services + L1 infra) ────────────────────────────────────

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

const mockResolveQueueId = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/queueSync.js', () => ({
  resolveQueueId: mockResolveQueueId,
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

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

interface QueueItemOverrides {
  platform?: string
  accountId?: string
  clipType?: 'video' | 'short' | 'medium-clip'
  ideaIds?: string[]
  mediaPath?: string | null
  sourceMediaPath?: string | null
  postContent?: string
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
    },
    postContent: overrides.postContent ?? id,
    hasMedia: Boolean(overrides.mediaPath ?? overrides.sourceMediaPath),
    mediaPath: overrides.mediaPath ?? null,
    folderPath: `/queue/${id}`,
  }
}

function mockItemsById(items: Record<string, ReturnType<typeof makeItem>>): void {
  mockGetItem.mockImplementation(async (id: string) => items[id] ?? null)
}

// ── Lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveQueueId.mockResolvedValue({ profileId: 'profile-1', queueId: 'queue-1' })
  mockGetAccountId.mockResolvedValue('acc-123')
  mockFileExists.mockResolvedValue(true)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' })
  mockCreatePost.mockImplementation(async ({ content }: { content: string }) => ({
    _id: `late-${content}`,
    status: 'scheduled',
    scheduledFor: '2026-02-15T19:00:00-06:00',
  }))
  mockApproveItem.mockResolvedValue(undefined)
  mockApproveBulk.mockResolvedValue(undefined)
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue', () => {
  it('passes isDraft: false to createPost', async () => {
    mockItemsById({
      'item-1': makeItem('item-1', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        postContent: 'Test content',
      }),
    })

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: false }),
    )
  })

  it('passes queuedFromProfile and queueId from resolveQueueId to createPost', async () => {
    mockItemsById({
      'item-1': makeItem('item-1', {
        mediaPath: '/m.mp4',
        sourceMediaPath: '/m.mp4',
        postContent: 'Test content',
      }),
    })

    await enqueueApproval(['item-1'])

    expect(mockResolveQueueId).toHaveBeenCalledWith('youtube', 'short')
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        queuedFromProfile: 'profile-1',
        queueId: 'queue-1',
      }),
    )
  })

  it('reads scheduledFor from Late API response', async () => {
    mockItemsById({
      'item-1': makeItem('item-1', { postContent: 'Test' }),
    })

    const result = await enqueueApproval(['item-1'])

    expect(result.results[0].scheduledFor).toBe('2026-02-15T19:00:00-06:00')
  })

  it('fails when resolveQueueId returns null', async () => {
    mockResolveQueueId.mockResolvedValue(null)
    mockItemsById({
      'item-1': makeItem('item-1', { postContent: 'Test' }),
    })

    const result = await enqueueApproval(['item-1'])

    expect(result.failed).toBe(1)
    expect(result.results[0].error).toContain('No Late API queue')
  })

  it('processes items in the order given', async () => {
    mockItemsById({
      'item-a': makeItem('item-a', { postContent: 'A' }),
      'item-b': makeItem('item-b', { postContent: 'B' }),
    })

    await enqueueApproval(['item-a', 'item-b'])

    expect(mockCreatePost.mock.calls.map((call: unknown[]) => (call[0] as { content: string }).content)).toEqual(['A', 'B'])
  })

  it('returns item-not-found when getItem returns null', async () => {
    mockGetItem.mockResolvedValue(null)

    const result = await enqueueApproval(['missing-item'])

    expect(result.failed).toBe(1)
    expect(result.results[0]).toEqual(
      expect.objectContaining({ itemId: 'missing-item', success: false, error: 'Item not found' }),
    )
    expect(mockCreatePost).not.toHaveBeenCalled()
  })

  it('uses sourceMediaPath fallback when mediaPath is null', async () => {
    mockItemsById({
      'item-fb': makeItem('item-fb', {
        mediaPath: null,
        sourceMediaPath: '/source/video.mp4',
        postContent: 'fallback test',
      }),
    })

    const result = await enqueueApproval(['item-fb'])

    expect(result.scheduled).toBe(1)
    expect(mockUploadMedia).toHaveBeenCalledWith('/source/video.mp4')
  })

  it('marks platform as rate-limited on Daily post limit error', async () => {
    mockCreatePost.mockRejectedValueOnce(new Error('Daily post limit reached'))
    mockItemsById({
      'item-rl1': makeItem('item-rl1', { platform: 'tiktok', postContent: 'first' }),
      'item-rl2': makeItem('item-rl2', { platform: 'tiktok', postContent: 'second' }),
    })

    const result = await enqueueApproval(['item-rl1', 'item-rl2'])

    expect(result.failed).toBe(2)
    expect(result.rateLimitedPlatforms).toContain('tiktok')
    expect(result.results[0].error).toContain('rate-limited')
    expect(result.results[1].error).toContain('rate-limited')
  })

  it('stores scheduledFor and latePostId from createPost response', async () => {
    mockCreatePost.mockResolvedValueOnce({
      _id: 'late-post-99',
      status: 'scheduled',
      scheduledFor: '2026-03-01T12:00:00Z',
    })
    mockItemsById({
      'item-sf': makeItem('item-sf', { postContent: 'scheduledFor test' }),
    })

    const result = await enqueueApproval(['item-sf'])

    expect(result.scheduled).toBe(1)
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        itemId: 'item-sf',
        success: true,
        scheduledFor: '2026-03-01T12:00:00Z',
        latePostId: 'late-post-99',
      }),
    )
    expect(mockApproveItem).toHaveBeenCalledWith('item-sf', expect.objectContaining({
      latePostId: 'late-post-99',
      scheduledFor: '2026-03-01T12:00:00Z',
    }))
  })

  it('passes queueInfo profileId and queueId to createPost', async () => {
    mockResolveQueueId.mockResolvedValue({ profileId: 'p-abc', queueId: 'q-xyz' })
    mockItemsById({
      'item-qi': makeItem('item-qi', { postContent: 'queue info test' }),
    })

    await enqueueApproval(['item-qi'])

    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        queuedFromProfile: 'p-abc',
        queueId: 'q-xyz',
      }),
    )
  })
})

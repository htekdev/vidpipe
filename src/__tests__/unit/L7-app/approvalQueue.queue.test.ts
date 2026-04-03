import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks (L0, L1, L3 — valid for L7 unit tests) ─────────────────────

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

const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

// ── Helpers ────────────────────────────────────────────────────────────

interface QueueItemOverrides {
  platform?: string
  accountId?: string
  clipType?: 'video' | 'short' | 'medium-clip'
  ideaIds?: string[]
  mediaPath?: string | null
  sourceMediaPath?: string | null
  postContent?: string
  createdAt?: string
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
      createdAt: overrides.createdAt ?? new Date().toISOString(),
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
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
  mockGetIdeasByIds.mockResolvedValue([])
  mockGetAccountId.mockResolvedValue('acc-123')
  mockFileExists.mockResolvedValue(false)
  mockApproveItem.mockResolvedValue(undefined)
  mockApproveBulk.mockResolvedValue(undefined)

  // Default: no queue configured (fallback path)
  mockGetQueueId.mockResolvedValue(null)
  mockGetProfileId.mockResolvedValue('profile-abc')
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue — queue integration', () => {
  it('uses queueId + queuedFromProfile when getQueueId returns a queueId', async () => {
    mockGetQueueId.mockResolvedValue('queue-yt-shorts')
    mockGetProfileId.mockResolvedValue('profile-123')
    mockCreatePost.mockResolvedValue({
      _id: 'late-post-1',
      status: 'scheduled',
      scheduledFor: '2026-04-02T14:00:00-06:00',
    })
    mockItemsById({
      'q-item': makeItem('q-item', { postContent: 'Queue post' }),
    })

    const result = await enqueueApproval(['q-item'])

    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        queuedFromProfile: 'profile-123',
        queueId: 'queue-yt-shorts',
      }),
    )
    // scheduledFor should NOT be set when using queue mode
    const callArgs = mockCreatePost.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('scheduledFor')
  })

  it('falls back to findNextSlot when getQueueId returns null', async () => {
    mockGetQueueId.mockResolvedValue(null)
    mockFindNextSlot.mockResolvedValue('2026-04-05T09:00:00-06:00')
    mockCreatePost.mockResolvedValue({
      _id: 'late-post-2',
      status: 'scheduled',
      scheduledFor: '2026-04-05T09:00:00-06:00',
    })
    mockItemsById({
      'fallback-item': makeItem('fallback-item', { postContent: 'Fallback post' }),
    })

    const result = await enqueueApproval(['fallback-item'])

    expect(result.scheduled).toBe(1)
    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short')
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledFor: '2026-04-05T09:00:00-06:00',
      }),
    )
    // queuedFromProfile and queueId should NOT be set in fallback mode
    const callArgs = mockCreatePost.mock.calls[0][0]
    expect(callArgs).not.toHaveProperty('queuedFromProfile')
    expect(callArgs).not.toHaveProperty('queueId')
  })

  it('reads scheduledFor from API response in queue mode', async () => {
    const apiAssignedSlot = '2026-04-10T18:30:00-06:00'
    mockGetQueueId.mockResolvedValue('queue-ig-shorts')
    mockGetProfileId.mockResolvedValue('profile-456')
    mockCreatePost.mockResolvedValue({
      _id: 'late-q-post',
      status: 'scheduled',
      scheduledFor: apiAssignedSlot,
    })
    mockItemsById({
      'api-slot-item': makeItem('api-slot-item', {
        platform: 'instagram',
        postContent: 'IG queue post',
      }),
    })

    const result = await enqueueApproval(['api-slot-item'])

    expect(result.scheduled).toBe(1)
    // The result should reflect the scheduledFor from the Late API response
    expect(result.results[0].scheduledFor).toBe(apiAssignedSlot)
    // approveItem should be called with the API-assigned slot
    expect(mockApproveItem).toHaveBeenCalledWith(
      'api-slot-item',
      expect.objectContaining({ scheduledFor: apiAssignedSlot }),
    )
  })

  it('calls getProfileId only when queue path is taken', async () => {
    mockGetQueueId.mockResolvedValue(null)
    mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
    mockCreatePost.mockResolvedValue({ _id: 'late-no-q', status: 'scheduled' })
    mockItemsById({
      'no-q-item': makeItem('no-q-item', { postContent: 'No queue' }),
    })

    await enqueueApproval(['no-q-item'])

    expect(mockGetProfileId).not.toHaveBeenCalled()
  })

  it('calls getProfileId when queue path is taken', async () => {
    mockGetQueueId.mockResolvedValue('queue-yt-shorts')
    mockGetProfileId.mockResolvedValue('profile-789')
    mockCreatePost.mockResolvedValue({
      _id: 'late-q-2',
      status: 'scheduled',
      scheduledFor: '2026-04-15T12:00:00-06:00',
    })
    mockItemsById({
      'q-item-2': makeItem('q-item-2', { postContent: 'With queue' }),
    })

    await enqueueApproval(['q-item-2'])

    expect(mockGetProfileId).toHaveBeenCalledOnce()
  })

  it('skips findNextSlot when queue is available', async () => {
    mockGetQueueId.mockResolvedValue('queue-x-shorts')
    mockGetProfileId.mockResolvedValue('profile-abc')
    mockCreatePost.mockResolvedValue({
      _id: 'late-skip-slot',
      status: 'scheduled',
      scheduledFor: '2026-04-20T16:00:00-06:00',
    })
    mockItemsById({
      'skip-slot': makeItem('skip-slot', { platform: 'twitter', postContent: 'X post' }),
    })

    await enqueueApproval(['skip-slot'])

    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('handles mixed batch: some items use queue, others fall back', async () => {
    // YouTube has a queue, Instagram does not
    mockGetQueueId.mockImplementation(async (platform: string) => {
      if (platform === 'youtube') return 'queue-yt-shorts'
      return null
    })
    mockGetProfileId.mockResolvedValue('profile-mix')
    mockFindNextSlot.mockResolvedValue('2026-04-25T11:00:00-06:00')
    mockCreatePost.mockImplementation(async (params: { content: string; scheduledFor?: string }) => ({
      _id: `late-${params.content}`,
      status: 'scheduled',
      scheduledFor: params.scheduledFor ?? '2026-04-25T15:00:00-06:00',
    }))
    mockItemsById({
      'yt-item': makeItem('yt-item', { platform: 'youtube', postContent: 'YT content' }),
      'ig-item': makeItem('ig-item', { platform: 'instagram', postContent: 'IG content' }),
    })

    const result = await enqueueApproval(['yt-item', 'ig-item'])

    expect(result.scheduled).toBe(2)

    // YouTube item should use queue path
    const ytCall = mockCreatePost.mock.calls.find(([args]) => args.content === 'YT content')!
    expect(ytCall[0]).toHaveProperty('queuedFromProfile', 'profile-mix')
    expect(ytCall[0]).toHaveProperty('queueId', 'queue-yt-shorts')
    expect(ytCall[0]).not.toHaveProperty('scheduledFor')

    // Instagram item should use fallback path
    const igCall = mockCreatePost.mock.calls.find(([args]) => args.content === 'IG content')!
    expect(igCall[0]).toHaveProperty('scheduledFor', '2026-04-25T11:00:00-06:00')
    expect(igCall[0]).not.toHaveProperty('queuedFromProfile')
    expect(igCall[0]).not.toHaveProperty('queueId')
  })

  it('passes correct clipType to getQueueId', async () => {
    mockGetQueueId.mockResolvedValue(null)
    mockCreatePost.mockResolvedValue({ _id: 'late-clip', status: 'scheduled' })
    mockItemsById({
      'mc-item': makeItem('mc-item', {
        clipType: 'medium-clip',
        postContent: 'Medium clip',
      }),
    })

    await enqueueApproval(['mc-item'])

    expect(mockGetQueueId).toHaveBeenCalledWith('youtube', 'medium-clip')
  })

  it('records failure when getProfileId throws but does not crash the batch', async () => {
    // Both items use queue path
    mockGetQueueId.mockResolvedValue('queue-yt-shorts')
    // First call throws, second succeeds
    mockGetProfileId
      .mockRejectedValueOnce(new Error('Profile fetch failed'))
      .mockResolvedValueOnce('profile-ok')
    mockCreatePost.mockResolvedValue({
      _id: 'late-ok',
      status: 'scheduled',
      scheduledFor: '2026-04-10T12:00:00-06:00',
    })
    mockItemsById({
      'fail-item': makeItem('fail-item', { postContent: 'Will fail' }),
      'ok-item': makeItem('ok-item', { postContent: 'Will succeed' }),
    })

    const result = await enqueueApproval(['fail-item', 'ok-item'])

    // First item should be recorded as failure
    const failEntry = result.results.find(r => r.itemId === 'fail-item')
    expect(failEntry).toBeDefined()
    expect(failEntry!.success).toBe(false)
    expect(failEntry!.error).toContain('Profile fetch failed')

    // Second item should still be processed successfully
    const okEntry = result.results.find(r => r.itemId === 'ok-item')
    expect(okEntry).toBeDefined()
    expect(okEntry!.success).toBe(true)

    expect(result.failed).toBe(1)
    expect(result.scheduled).toBe(1)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks (L0, L1, L3 — valid for L7 unit tests) ─────────────────────

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

const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

// ── Helpers ────────────────────────────────────────────────────────────

interface ContentRecordOverrides {
  platform?: string
  clipType?: string
  ideaIds?: string
  mediaFilename?: string
  postContent?: string
  createdAt?: string
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
    mediaFilename: overrides.mediaFilename ?? '',
    postContent: overrides.postContent ?? id,
    hashtags: '',
    characterCount: 10,
    scheduledFor: '',
    latePostId: '',
    publishedUrl: '',
    sourceVideoRunId: 'run-1',
    thumbnailFilename: '',
    ideaIds: overrides.ideaIds ?? '',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
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

// ── Lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
  mockGetIdeasByIds.mockResolvedValue([])
  mockGetAccountId.mockResolvedValue('acc-123')
  mockDownloadMediaToFile.mockResolvedValue(undefined)
  mockAzureApproveItem.mockResolvedValue(undefined)
  mockMarkPublished.mockResolvedValue(undefined)
  mockEnsureDirectory.mockResolvedValue(undefined)
  mockRemoveDirectory.mockResolvedValue(undefined)

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
    mockContentRecords([
      makeContentRecord('q-item', { postContent: 'Queue post' }),
    ])

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
    mockContentRecords([
      makeContentRecord('fallback-item', { postContent: 'Fallback post' }),
    ])

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
    mockContentRecords([
      makeContentRecord('api-slot-item', { platform: 'instagram', postContent: 'IG queue post' }),
    ])

    const result = await enqueueApproval(['api-slot-item'])

    expect(result.scheduled).toBe(1)
    // The result should reflect the scheduledFor from the Late API response
    expect(result.results[0].scheduledFor).toBe(apiAssignedSlot)
    // markPublished should be called with the API-assigned slot
    expect(mockMarkPublished).toHaveBeenCalledWith(
      'test-video',
      'api-slot-item',
      expect.objectContaining({ scheduledFor: apiAssignedSlot }),
    )
  })

  it('calls getProfileId only when queue path is taken', async () => {
    mockGetQueueId.mockResolvedValue(null)
    mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
    mockCreatePost.mockResolvedValue({ _id: 'late-no-q', status: 'scheduled' })
    mockContentRecords([
      makeContentRecord('no-q-item', { postContent: 'No queue' }),
    ])

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
    mockContentRecords([
      makeContentRecord('q-item-2', { postContent: 'With queue' }),
    ])

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
    mockContentRecords([
      makeContentRecord('skip-slot', { platform: 'twitter', postContent: 'X post' }),
    ])

    await enqueueApproval(['skip-slot'])

    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('handles mixed batch: some items use queue, others fall back', async () => {
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
    mockContentRecords([
      makeContentRecord('yt-item', { platform: 'youtube', postContent: 'YT content' }),
      makeContentRecord('ig-item', { platform: 'instagram', postContent: 'IG content' }),
    ])

    const result = await enqueueApproval(['yt-item', 'ig-item'])

    expect(result.scheduled).toBe(2)

    const ytCall = mockCreatePost.mock.calls.find(([args]) => args.content === 'YT content')!
    expect(ytCall[0]).toHaveProperty('queuedFromProfile', 'profile-mix')
    expect(ytCall[0]).toHaveProperty('queueId', 'queue-yt-shorts')
    expect(ytCall[0]).not.toHaveProperty('scheduledFor')

    const igCall = mockCreatePost.mock.calls.find(([args]) => args.content === 'IG content')!
    expect(igCall[0]).toHaveProperty('scheduledFor', '2026-04-25T11:00:00-06:00')
    expect(igCall[0]).not.toHaveProperty('queuedFromProfile')
    expect(igCall[0]).not.toHaveProperty('queueId')
  })

  it('passes correct clipType to getQueueId', async () => {
    mockGetQueueId.mockResolvedValue(null)
    mockCreatePost.mockResolvedValue({ _id: 'late-clip', status: 'scheduled' })
    mockContentRecords([
      makeContentRecord('mc-item', { clipType: 'medium-clip', postContent: 'Medium clip' }),
    ])

    await enqueueApproval(['mc-item'])

    expect(mockGetQueueId).toHaveBeenCalledWith('youtube', 'medium-clip')
  })

  it('records failure when getProfileId throws but does not crash the batch', async () => {
    mockGetQueueId.mockResolvedValue('queue-yt-shorts')
    mockGetProfileId
      .mockRejectedValueOnce(new Error('Profile fetch failed'))
      .mockResolvedValueOnce('profile-ok')
    mockCreatePost.mockResolvedValue({
      _id: 'late-ok',
      status: 'scheduled',
      scheduledFor: '2026-04-10T12:00:00-06:00',
    })
    mockContentRecords([
      makeContentRecord('fail-item', { postContent: 'Will fail' }),
      makeContentRecord('ok-item', { postContent: 'Will succeed' }),
    ])

    const result = await enqueueApproval(['fail-item', 'ok-item'])

    const failEntry = result.results.find(r => r.itemId === 'fail-item')
    expect(failEntry).toBeDefined()
    expect(failEntry!.success).toBe(false)
    expect(failEntry!.error).toContain('Profile fetch failed')

    const okEntry = result.results.find(r => r.itemId === 'ok-item')
    expect(okEntry).toBeDefined()
    expect(okEntry!.success).toBe(true)

    expect(result.failed).toBe(1)
    expect(result.scheduled).toBe(1)
  })
})

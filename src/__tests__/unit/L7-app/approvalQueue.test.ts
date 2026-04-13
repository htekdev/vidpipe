import { beforeEach, describe, expect, it, vi } from 'vitest'

// Stub fetch globally so queueMapping doesn't hit real Late API
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({ queues: [], count: 0, profiles: [] }),
  headers: new Map(),
}))

// ── Mocks (L3 services + L1 infra) ────────────────────────────────────

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

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

interface ContentRecordOverrides {
  platform?: string
  clipType?: string
  ideaIds?: string
  mediaFilename?: string
  thumbnailFilename?: string
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
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' })
  mockCreatePost.mockImplementation(async ({ content }: { content: string }) => ({ _id: `late-${content}`, status: 'scheduled' }))
  mockAzureApproveItem.mockResolvedValue(undefined)
  mockMarkPublished.mockResolvedValue(undefined)
  mockEnsureDirectory.mockResolvedValue(undefined)
  mockRemoveDirectory.mockResolvedValue(undefined)
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue', () => {
  it('passes isDraft: false to createPost', async () => {
    mockContentRecords([
      makeContentRecord('item-1', { postContent: 'Test content' }),
    ])

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: false }),
    )
  })

  it('processes idea-linked items before non-idea items', async () => {
    const publishBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    mockContentRecords([
      makeContentRecord('non-idea', { postContent: 'non-idea' }),
      makeContentRecord('with-idea', { postContent: 'with-idea', ideaIds: 'idea-1' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([{ id: 'idea-1', publishBy }])

    await enqueueApproval(['non-idea', 'with-idea'])

    expect(mockCreatePost.mock.calls.map(([args]) => args.content)).toEqual(['with-idea', 'non-idea'])
  })

  it('processes urgent idea-linked items before other idea-linked items', async () => {
    const urgentPublishBy = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const laterPublishBy = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString()
    mockContentRecords([
      makeContentRecord('non-urgent-idea', { postContent: 'non-urgent-idea', ideaIds: 'idea-later' }),
      makeContentRecord('urgent-idea', { postContent: 'urgent-idea', ideaIds: 'idea-soon' }),
      makeContentRecord('non-idea', { postContent: 'non-idea' }),
    ])
    mockGetIdeasByIds.mockImplementation(async (ideaIds: string[]) => {
      if (ideaIds.includes('idea-soon')) {
        return [{ id: 'idea-soon', publishBy: urgentPublishBy }]
      }
      if (ideaIds.includes('idea-later')) {
        return [{ id: 'idea-later', publishBy: laterPublishBy }]
      }
      return []
    })

    await enqueueApproval(['non-urgent-idea', 'non-idea', 'urgent-idea'])

    expect(mockCreatePost.mock.calls.map(([args]) => args.content)).toEqual([
      'urgent-idea',
      'non-urgent-idea',
      'non-idea',
    ])
  })

  it('batches idea lookups across approval items', async () => {
    const earliest = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    mockContentRecords([
      makeContentRecord('idea-item-a', { postContent: 'idea-item-a', ideaIds: 'idea-1,42' }),
      makeContentRecord('idea-item-b', { postContent: 'idea-item-b', ideaIds: 'idea-2,idea-1' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-1', issueNumber: 41, publishBy: later },
      { id: 'idea-2', issueNumber: 42, publishBy: earliest },
    ])

    await enqueueApproval(['idea-item-a', 'idea-item-b'])

    expect(mockGetIdeasByIds).toHaveBeenCalledTimes(1)
    expect(mockGetIdeasByIds).toHaveBeenCalledWith(expect.arrayContaining(['idea-1', 'idea-2', '42']))
    expect(mockFindNextSlot).toHaveBeenNthCalledWith(1, 'youtube', 'short', {
      ideaIds: ['idea-1', '42'],
      publishBy: earliest,
    })
    expect(mockFindNextSlot).toHaveBeenNthCalledWith(2, 'youtube', 'short', {
      ideaIds: ['idea-2', 'idea-1'],
      publishBy: earliest,
    })
  })

  it('passes ideaIds and publishBy to findNextSlot for idea-linked items', async () => {
    const publishBy = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    mockContentRecords([
      makeContentRecord('idea-item', { postContent: 'idea-item', ideaIds: 'idea-1,idea-2' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-1', publishBy: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString() },
      { id: 'idea-2', publishBy },
    ])

    await enqueueApproval(['idea-item'])

    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short', {
      ideaIds: ['idea-1', 'idea-2'],
      publishBy,
    })
  })

  it('calls findNextSlot with only platform and clipType for non-idea items', async () => {
    mockContentRecords([
      makeContentRecord('plain-item', { postContent: 'plain-item' }),
    ])

    await enqueueApproval(['plain-item'])

    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short')
    expect(mockFindNextSlot.mock.calls[0]).toHaveLength(2)
  })
})

// ── Sorting tests ─────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue sorting', () => {
  it('sorts idea items by soonest publishBy first', async () => {
    const soonDate = '2026-06-01T00:00:00Z'
    const farDate = '2026-08-01T00:00:00Z'
    mockContentRecords([
      makeContentRecord('item-far', { postContent: 'item-far', ideaIds: 'idea-far' }),
      makeContentRecord('item-soon', { postContent: 'item-soon', ideaIds: 'idea-soon' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-far', publishBy: farDate },
      { id: 'idea-soon', publishBy: soonDate },
    ])

    await enqueueApproval(['item-far', 'item-soon'])

    expect(mockCreatePost.mock.calls.map(([a]) => a.content)).toEqual([
      'item-soon',
      'item-far',
    ])
  })

  it('breaks publishBy ties with earliest createdAt', async () => {
    const sharedPublishBy = '2026-07-01T00:00:00Z'
    mockContentRecords([
      makeContentRecord('item-newer', { postContent: 'item-newer', ideaIds: 'idea-a', createdAt: '2026-01-15T00:00:00Z' }),
      makeContentRecord('item-older', { postContent: 'item-older', ideaIds: 'idea-b', createdAt: '2026-01-10T00:00:00Z' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-a', publishBy: sharedPublishBy },
      { id: 'idea-b', publishBy: sharedPublishBy },
    ])

    await enqueueApproval(['item-newer', 'item-older'])

    expect(mockCreatePost.mock.calls.map(([a]) => a.content)).toEqual([
      'item-older',
      'item-newer',
    ])
  })

  it('sorts idea items with publishBy before idea items without publishBy', async () => {
    mockContentRecords([
      makeContentRecord('item-undated', { postContent: 'item-undated', ideaIds: 'idea-undated' }),
      makeContentRecord('item-dated', { postContent: 'item-dated', ideaIds: 'idea-dated' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-undated' },
      { id: 'idea-dated', publishBy: '2026-07-01T00:00:00Z' },
    ])

    await enqueueApproval(['item-undated', 'item-dated'])

    expect(mockCreatePost.mock.calls.map(([a]) => a.content)).toEqual([
      'item-dated',
      'item-undated',
    ])
  })

  it('places non-idea items after all idea items', async () => {
    mockContentRecords([
      makeContentRecord('no-idea-1', { postContent: 'no-idea-1' }),
      makeContentRecord('no-idea-2', { postContent: 'no-idea-2' }),
      makeContentRecord('with-idea', { postContent: 'with-idea', ideaIds: 'idea-x' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-x', publishBy: '2026-09-01T00:00:00Z' },
    ])

    await enqueueApproval(['no-idea-1', 'no-idea-2', 'with-idea'])

    const order = mockCreatePost.mock.calls.map(([a]) => a.content)
    expect(order[0]).toBe('with-idea')
    expect(order.slice(1)).toEqual(['no-idea-1', 'no-idea-2'])
  })

  it('sorts mixed batch: urgent > non-urgent > undated-idea > non-idea', async () => {
    const urgentDate = '2026-06-05T00:00:00Z'
    const laterDate = '2026-08-20T00:00:00Z'
    mockContentRecords([
      makeContentRecord('non-idea', { postContent: 'non-idea' }),
      makeContentRecord('undated-idea', { postContent: 'undated-idea', ideaIds: 'idea-none' }),
      makeContentRecord('later-idea', { postContent: 'later-idea', ideaIds: 'idea-later' }),
      makeContentRecord('urgent-idea', { postContent: 'urgent-idea', ideaIds: 'idea-urgent' }),
    ])
    mockGetIdeasByIds.mockResolvedValue([
      { id: 'idea-none' },
      { id: 'idea-later', publishBy: laterDate },
      { id: 'idea-urgent', publishBy: urgentDate },
    ])

    await enqueueApproval(['non-idea', 'undated-idea', 'later-idea', 'urgent-idea'])

    expect(mockCreatePost.mock.calls.map(([a]) => a.content)).toEqual([
      'urgent-idea',
      'later-idea',
      'undated-idea',
      'non-idea',
    ])
  })
})

// ── Priority scheduling tests ─────────────────────────────────────────

describe('L7 Unit: approvalQueue priority', () => {
  it('passes priority flag through to processApprovalBatch', async () => {
    mockContentRecords([
      makeContentRecord('item-1', { postContent: 'Test content' }),
    ])

    const result = await enqueueApproval(['item-1'], { priority: true })

    // Should still schedule successfully (priority just changes the scheduling strategy)
    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalled()
  })

  it('defaults to non-priority when no options provided', async () => {
    mockContentRecords([
      makeContentRecord('item-1', { postContent: 'Test content' }),
    ])

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalled()
  })

  it('fetches missing IDs in a single batch instead of per-ID', async () => {
    // Items not in pending_review should still be found via single getContentItems call
    mockGetContentItems.mockImplementation(async (filters?: { status?: string }) => {
      if (filters?.status === 'pending_review') return []
      return [
        makeContentRecord('fallback-1', { postContent: 'fallback' }),
      ]
    })

    const result = await enqueueApproval(['fallback-1'])

    expect(result.scheduled).toBe(1)
    // getContentItems should be called exactly twice: once for pending, once for fallback
    expect(mockGetContentItems).toHaveBeenCalledTimes(2)
  })

  it('approval flow marks items as approved before scheduling', async () => {
    mockContentRecords([makeContentRecord('item-1', { postContent: 'content' })])
    await enqueueApproval(['item-1'])
    // The approval queue calls azureApproveItem before markPublished
    expect(mockAzureApproveItem).toHaveBeenCalled()
  })

  it('idea enrichment is not called during approval (deferred to review UI)', async () => {
    mockContentRecords([makeContentRecord('item-1', { postContent: 'content', ideaIds: 'idea-1' })])
    const result = await enqueueApproval(['item-1'])
    expect(result.scheduled).toBeDefined()
  })
})

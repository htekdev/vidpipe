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

const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  fileExistsSync: vi.fn().mockReturnValue(false),
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

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

interface QueueItemOverrides {
  platform?: string
  accountId?: string
  clipType?: 'video' | 'short' | 'medium'
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
  mockFileExists.mockResolvedValue(true)
  mockUploadMedia.mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' })
  mockCreatePost.mockImplementation(async ({ content }: { content: string }) => ({ _id: `late-${content}`, status: 'scheduled' }))
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

  it('processes idea-linked items before non-idea items', async () => {
    const publishBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    mockItemsById({
      'non-idea': makeItem('non-idea'),
      'with-idea': makeItem('with-idea', { ideaIds: ['idea-1'] }),
    })
    mockGetIdeasByIds.mockResolvedValue([{ id: 'idea-1', publishBy }])

    await enqueueApproval(['non-idea', 'with-idea'])

    expect(mockCreatePost.mock.calls.map(([args]) => args.content)).toEqual(['with-idea', 'non-idea'])
  })

  it('processes urgent idea-linked items before other idea-linked items', async () => {
    const urgentPublishBy = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    const laterPublishBy = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString()
    mockItemsById({
      'non-urgent-idea': makeItem('non-urgent-idea', { ideaIds: ['idea-later'] }),
      'urgent-idea': makeItem('urgent-idea', { ideaIds: ['idea-soon'] }),
      'non-idea': makeItem('non-idea'),
    })
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
    mockItemsById({
      'idea-item-a': makeItem('idea-item-a', { ideaIds: ['idea-1', '42'] }),
      'idea-item-b': makeItem('idea-item-b', { ideaIds: ['idea-2', 'idea-1'] }),
    })
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
    mockItemsById({
      'idea-item': makeItem('idea-item', { ideaIds: ['idea-1', 'idea-2'] }),
    })
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
    mockItemsById({
      'plain-item': makeItem('plain-item'),
    })

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
    mockItemsById({
      'item-far': makeItem('item-far', { ideaIds: ['idea-far'] }),
      'item-soon': makeItem('item-soon', { ideaIds: ['idea-soon'] }),
    })
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
    mockItemsById({
      'item-newer': makeItem('item-newer', { ideaIds: ['idea-a'], createdAt: '2026-01-15T00:00:00Z' }),
      'item-older': makeItem('item-older', { ideaIds: ['idea-b'], createdAt: '2026-01-10T00:00:00Z' }),
    })
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
    mockItemsById({
      'item-undated': makeItem('item-undated', { ideaIds: ['idea-undated'] }),
      'item-dated': makeItem('item-dated', { ideaIds: ['idea-dated'] }),
    })
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
    mockItemsById({
      'no-idea-1': makeItem('no-idea-1'),
      'no-idea-2': makeItem('no-idea-2'),
      'with-idea': makeItem('with-idea', { ideaIds: ['idea-x'] }),
    })
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
    mockItemsById({
      'non-idea': makeItem('non-idea'),
      'undated-idea': makeItem('undated-idea', { ideaIds: ['idea-none'] }),
      'later-idea': makeItem('later-idea', { ideaIds: ['idea-later'] }),
      'urgent-idea': makeItem('urgent-idea', { ideaIds: ['idea-urgent'] }),
    })
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

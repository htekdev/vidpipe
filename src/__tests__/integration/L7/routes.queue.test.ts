import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
const mockPreviewQueue = vi.hoisted(() => vi.fn())
const mockFindNextSlot = vi.hoisted(() => vi.fn())
const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockGetGroupedItems = vi.hoisted(() => vi.fn().mockResolvedValue([]))

// ── Mocks (L0, L1, L3 — valid for L7 unit tests) ───────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
  initConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
}))

const mockPriorityShiftQueue = vi.hoisted(() => vi.fn().mockResolvedValue(null))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' } },
    async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
    async getScheduledPosts() { return [] },
    async listAccounts() { return [{ id: 'acc-1', platform: 'tiktok', name: 'Test Account' }] },
    async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
    previewQueue: mockPreviewQueue,
  }),
  priorityShiftQueue: mockPriorityShiftQueue,
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
  getScheduleCalendar: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: async () => 'test-account-id',
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: async () => ({ timezone: 'America/Chicago', platforms: {} }),
}))

vi.mock('../../../L3-services/azureStorage/azureReviewDataSource.js', () => ({
  listPendingItems: vi.fn().mockResolvedValue([]),
  getGroupedItems: mockGetGroupedItems,
  getItemById: vi.fn().mockResolvedValue(null),
  updateItem: vi.fn().mockResolvedValue(undefined),
  rejectItem: vi.fn().mockResolvedValue(undefined),
  getMediaStream: vi.fn().mockRejectedValue(new Error('Not found')),
}))

vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  getContentItems: vi.fn().mockResolvedValue([]),
}))

// ── Import after mocks ─────────────────────────────────────────────────

import express from 'express'
import request from 'supertest'
import { createRouter } from '../../../L7-app/review/routes.js'

// ── Test helpers ────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('GET /api/posts/grouped — enrichGroupedItems', () => {
  let app: ReturnType<typeof express>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIdeasByIds.mockResolvedValue([])
    app = buildApp()
  })

  it('enriches groups with hasMedia, groupKey, and mediaType', async () => {
    mockGetGroupedItems.mockResolvedValueOnce([
      {
        videoSlug: 'my-video',
        items: [
          {
            id: 'item-1',
            videoSlug: 'my-video',
            platform: 'youtube',
            clipType: 'short',
            status: 'pending_review',
            mediaType: 'video',
            mediaUrl: '/api/media/item-1/media.mp4',
            mediaFilename: 'media.mp4',
            thumbnailFilename: '',
            postContent: 'Post content',
            hashtags: [],
            ideaIds: [],
            scheduledFor: null,
            latePostId: null,
            publishedUrl: null,
            createdAt: '2026-01-01',
            thumbnailUrl: null,
            blobBasePath: 'content/item-1/',
          },
        ],
      },
    ])

    const res = await request(app).get('/api/posts/grouped')

    expect(res.status).toBe(200)
    expect(res.body.groups).toHaveLength(1)
    expect(res.body.groups[0].groupKey).toBe('my-video')
    expect(res.body.groups[0].hasMedia).toBe(true)
    expect(res.body.groups[0].mediaType).toBe('video')
    expect(res.body.total).toBe(1)
  })

  it('sets hasMedia false when no item has mediaFilename', async () => {
    mockGetGroupedItems.mockResolvedValueOnce([
      {
        videoSlug: 'no-media-video',
        items: [
          {
            id: 'item-2',
            videoSlug: 'no-media-video',
            platform: 'linkedin',
            clipType: 'medium',
            status: 'pending_review',
            mediaType: 'image',
            mediaUrl: '',
            mediaFilename: '',
            thumbnailFilename: '',
            postContent: 'Text only',
            hashtags: [],
            ideaIds: [],
            scheduledFor: null,
            latePostId: null,
            publishedUrl: null,
            createdAt: '2026-01-01',
            thumbnailUrl: null,
            blobBasePath: 'content/item-2/',
          },
        ],
      },
    ])

    const res = await request(app).get('/api/posts/grouped')

    expect(res.body.groups[0].hasMedia).toBe(false)
    expect(res.body.groups[0].mediaType).toBe('image')
  })

  it('falls back to video mediaType when group has no items', async () => {
    mockGetGroupedItems.mockResolvedValueOnce([
      {
        videoSlug: 'empty-group',
        items: [],
      },
    ])

    const res = await request(app).get('/api/posts/grouped')

    expect(res.body.groups[0].mediaType).toBe('video') // fallback
    expect(res.body.groups[0].hasMedia).toBe(false)
  })
})

describe('GET /api/schedule/next-slot/:platform — queue preview branch', () => {
  let app: ReturnType<typeof express>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindNextSlot.mockResolvedValue('2026-02-15T19:00:00-06:00')
    mockGetIdeasByIds.mockResolvedValue([])
    app = buildApp()
  })

  it('returns queue slot when previewQueue succeeds', async () => {
    mockGetQueueId.mockResolvedValue('q-tiktok-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockResolvedValue({ slots: ['2026-04-08T15:00:00Z'] })

    const res = await request(app).get('/api/schedule/next-slot/tiktok')

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('queue')
    expect(res.body.nextSlot).toBe('2026-04-08T15:00:00Z')
    expect(res.body.platform).toBe('tiktok')
    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('falls back to local when previewQueue returns empty slots', async () => {
    mockGetQueueId.mockResolvedValue('q-youtube-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockResolvedValue({ slots: [] })

    const res = await request(app).get('/api/schedule/next-slot/youtube?clipType=short')

    expect(res.status).toBe(200)
    expect(res.body.nextSlot).toBe('2026-02-15T19:00:00-06:00')
    expect(res.body.platform).toBe('youtube')
    // Fallback path does not include source: 'queue'
    expect(res.body.source).not.toBe('queue')
    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short')
  })

  it('falls back to local when previewQueue throws', async () => {
    mockGetQueueId.mockResolvedValue('q-instagram-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockRejectedValue(new Error('API timeout'))

    const res = await request(app).get('/api/schedule/next-slot/instagram')

    expect(res.status).toBe(200)
    expect(res.body.nextSlot).toBe('2026-02-15T19:00:00-06:00')
    expect(res.body.platform).toBe('instagram')
    expect(mockFindNextSlot).toHaveBeenCalledWith('instagram', undefined)
  })
})

describe('POST /api/posts/:id/approve — priority param', () => {
  let app: ReturnType<typeof express>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIdeasByIds.mockResolvedValue([])
    app = buildApp()
  })

  it('returns 202 when approving with priority query param', async () => {
    const res = await request(app).post('/api/posts/item-1/approve?priority=true')
    expect(res.status).toBe(202)
    expect(res.body.accepted).toBe(true)
  })

  it('returns 202 for standard approve without priority', async () => {
    const res = await request(app).post('/api/posts/item-1/approve')
    expect(res.status).toBe(202)
    expect(res.body.accepted).toBe(true)
  })
})

describe('POST /api/posts/bulk-approve — priority param', () => {
  let app: ReturnType<typeof express>

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetIdeasByIds.mockResolvedValue([])
    app = buildApp()
  })

  it('accepts bulk approve with priority flag', async () => {
    const res = await request(app)
      .post('/api/posts/bulk-approve')
      .send({ itemIds: ['item-1', 'item-2'], priority: true })
    expect(res.status).toBe(202)
    expect(res.body.accepted).toBe(true)
    expect(res.body.count).toBe(2)
  })

  it('accepts bulk approve without priority flag', async () => {
    const res = await request(app)
      .post('/api/posts/bulk-approve')
      .send({ itemIds: ['item-1'] })
    expect(res.status).toBe(202)
    expect(res.body.count).toBe(1)
  })

  it('rejects empty itemIds array', async () => {
    const res = await request(app)
      .post('/api/posts/bulk-approve')
      .send({ itemIds: [] })
    expect(res.status).toBe(400)
  })
})

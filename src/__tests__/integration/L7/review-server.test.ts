import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

// ── Mock setup ─────────────────────────────────────────────────────────

const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockListPendingItems = vi.hoisted(() => vi.fn())
const mockGetGroupedItems = vi.hoisted(() => vi.fn())
const mockGetItemById = vi.hoisted(() => vi.fn())
const mockAzureUpdateItem = vi.hoisted(() => vi.fn())
const mockAzureRejectItem = vi.hoisted(() => vi.fn())
const mockGetMediaStream = vi.hoisted(() => vi.fn())
const mockGetContentItems = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
  initConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: vi.fn(),
  removeDirectory: vi.fn(),
}))

vi.mock('../../../L1-infra/paths/paths.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    join: (...args: string[]) => args.join('/'),
  }
})

vi.mock('../../../L3-services/azureStorage/azureReviewDataSource.js', () => ({
  listPendingItems: mockListPendingItems,
  getGroupedItems: mockGetGroupedItems,
  getItemById: mockGetItemById,
  updateItem: mockAzureUpdateItem,
  rejectItem: mockAzureRejectItem,
  getMediaStream: mockGetMediaStream,
  approveItem: vi.fn(),
  markPublished: vi.fn(),
  downloadMediaToFile: vi.fn(),
}))

vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  getContentItems: mockGetContentItems,
  isAzureConfigured: () => true,
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' } },
    async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
    async getScheduledPosts() { return [] },
    async listAccounts() { return [{ id: 'acc-1', platform: 'tiktok', name: 'Test Account' }] },
    async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
  }),
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: async () => '2026-02-15T19:00:00-06:00',
  getScheduleCalendar: async () => [],
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: async () => 'test-account-id',
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: async () => ({ timezone: 'America/Chicago', platforms: {} }),
}))

// ── Import after mocks ────────────────────────────────────────────────

import express from 'express'
import request from 'supertest'
import { createRouter } from '../../../L7-app/review/routes.js'
import type { ReviewItem, ReviewGroup } from '../../../L3-services/azureStorage/azureReviewDataSource.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeReviewItem(id: string, overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id,
    videoSlug: overrides.videoSlug ?? 'test-video',
    platform: overrides.platform ?? 'tiktok',
    clipType: overrides.clipType ?? 'short',
    status: overrides.status ?? 'pending_review',
    mediaType: overrides.mediaType ?? 'video',
    mediaUrl: overrides.mediaUrl ?? `/api/media/${id}/media.mp4`,
    postContent: overrides.postContent ?? `Test post content for ${id}`,
    hashtags: overrides.hashtags ?? ['test'],
    scheduledFor: overrides.scheduledFor ?? null,
    latePostId: overrides.latePostId ?? null,
    publishedUrl: overrides.publishedUrl ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    thumbnailUrl: overrides.thumbnailUrl ?? null,
    ideaIds: overrides.ideaIds ?? [],
    mediaFilename: 'media.mp4',
    thumbnailFilename: '',
    blobBasePath: `content/${id}/`,
  }
}

function makeContentRecord(id: string, overrides: Partial<ReviewItem> = {}) {
  const item = makeReviewItem(id, overrides)
  return {
    partitionKey: item.videoSlug,
    rowKey: id,
    platform: item.platform,
    clipType: item.clipType,
    status: item.status,
    blobBasePath: `content/${id}/`,
    mediaType: item.mediaType,
    mediaFilename: 'media.mp4',
    postContent: item.postContent,
    hashtags: item.hashtags.join(','),
    characterCount: item.postContent.length,
    scheduledFor: item.scheduledFor ?? '',
    latePostId: item.latePostId ?? '',
    publishedUrl: item.publishedUrl ?? '',
    sourceVideoRunId: 'run-1',
    thumbnailFilename: '',
    ideaIds: item.ideaIds?.join(',') ?? '',
    createdAt: item.createdAt,
    reviewedAt: '',
    publishedAt: '',
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetIdeasByIds.mockResolvedValue([])
  mockListPendingItems.mockResolvedValue([])
  mockGetGroupedItems.mockResolvedValue([])
  mockGetItemById.mockResolvedValue(null)
  mockAzureUpdateItem.mockResolvedValue(null)
  mockAzureRejectItem.mockResolvedValue(undefined)
  mockGetContentItems.mockResolvedValue([])
  mockGetMediaStream.mockRejectedValue(new Error('Not found'))
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('Review Server API', () => {
  const app = buildApp()

  // ─── GET /api/posts/pending ────────────────────────────────────────

  describe('GET /api/posts/pending', () => {
    it('returns empty array when no items', async () => {
      const res = await request(app).get('/api/posts/pending')
      expect(res.status).toBe(200)
      expect(res.body.items).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('returns items when queue has posts', async () => {
      mockListPendingItems.mockResolvedValue([
        makeReviewItem('item-a'),
        makeReviewItem('item-b'),
      ])

      const res = await request(app).get('/api/posts/pending')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      expect(res.body.total).toBe(2)
    })

    it('batches idea enrichment across pending queue items', async () => {
      mockListPendingItems.mockResolvedValue([
        makeReviewItem('idea-a', { ideaIds: ['idea-1', '42'] }),
        makeReviewItem('idea-b', { ideaIds: ['idea-2', 'idea-1'] }),
      ])
      mockGetIdeasByIds.mockResolvedValue([
        { id: 'idea-1', issueNumber: 41, publishBy: '2026-03-20' },
        { id: 'idea-2', issueNumber: 42, publishBy: '2026-03-01' },
      ])

      const res = await request(app).get('/api/posts/pending')

      expect(res.status).toBe(200)
      expect(mockGetIdeasByIds).toHaveBeenCalledTimes(1)
      expect(mockGetIdeasByIds).toHaveBeenCalledWith(expect.arrayContaining(['idea-1', 'idea-2', '42']))
      const itemsById = new Map<string, { id: string; ideaPublishBy?: string }>(
        res.body.items.map((item: { id: string; ideaPublishBy?: string }) => [item.id, item] as const),
      )
      expect(itemsById.get('idea-a')?.ideaPublishBy).toBe('2026-03-01')
      expect(itemsById.get('idea-b')?.ideaPublishBy).toBe('2026-03-01')
    })
  })

  // ─── GET /api/posts/:id ────────────────────────────────────────────

  describe('GET /api/posts/:id', () => {
    it('returns 404 for non-existent item', async () => {
      mockGetContentItems.mockResolvedValue([])
      const res = await request(app).get('/api/posts/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('returns item with full content', async () => {
      const item = makeReviewItem('detail-item')
      mockGetContentItems.mockResolvedValue([makeContentRecord('detail-item')])
      mockGetItemById.mockResolvedValue(item)

      const res = await request(app).get('/api/posts/detail-item')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe('detail-item')
      expect(res.body.postContent).toBe('Test post content for detail-item')
      expect(res.body.platform).toBe('tiktok')
    })

    it('includes earliest idea publishBy when linked ideas are available', async () => {
      const item = makeReviewItem('detail-idea-item', { ideaIds: ['idea-later', 'idea-earlier'] })
      mockGetContentItems.mockResolvedValue([makeContentRecord('detail-idea-item', { ideaIds: ['idea-later', 'idea-earlier'] })])
      mockGetItemById.mockResolvedValue(item)
      mockGetIdeasByIds.mockResolvedValue([
        { id: 'idea-later', publishBy: '2026-03-20' },
        { id: 'idea-earlier', publishBy: '2026-03-01' },
      ])

      const res = await request(app).get('/api/posts/detail-idea-item')
      expect(res.status).toBe(200)
      expect(res.body.ideaPublishBy).toBe('2026-03-01')
    })
  })

  // ─── POST /api/posts/:id/approve ──────────────────────────────────

  describe('POST /api/posts/:id/approve', () => {
    it('returns 202 accepted', async () => {
      mockGetContentItems.mockResolvedValue([makeContentRecord('approve-me')])

      const res = await request(app).post('/api/posts/approve-me/approve')
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)

      await new Promise(resolve => setTimeout(resolve, 200))
    })
  })

  // ─── POST /api/posts/:id/reject ───────────────────────────────────

  describe('POST /api/posts/:id/reject', () => {
    it('returns 404 for non-existent item', async () => {
      mockGetContentItems.mockResolvedValue([])

      const res = await request(app).post('/api/posts/ghost/reject')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('rejects item and returns success', async () => {
      mockGetContentItems.mockResolvedValue([makeContentRecord('reject-me')])

      const res = await request(app).post('/api/posts/reject-me/reject')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(mockAzureRejectItem).toHaveBeenCalledWith('test-video', 'reject-me')
    })
  })

  // ─── PUT /api/posts/:id ───────────────────────────────────────────

  describe('PUT /api/posts/:id', () => {
    it('returns 404 for non-existent item', async () => {
      mockGetContentItems.mockResolvedValue([])

      const res = await request(app)
        .put('/api/posts/ghost')
        .send({ postContent: 'New content' })
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('updates post content', async () => {
      const updatedItem = makeReviewItem('edit-me', { postContent: 'Updated content!' })
      mockGetContentItems.mockResolvedValue([makeContentRecord('edit-me')])
      mockAzureUpdateItem.mockResolvedValue(updatedItem)

      const res = await request(app)
        .put('/api/posts/edit-me')
        .send({ postContent: 'Updated content!' })
      expect(res.status).toBe(200)
      expect(res.body.postContent).toBe('Updated content!')
      expect(mockAzureUpdateItem).toHaveBeenCalledWith('test-video', 'edit-me', { postContent: 'Updated content!' })
    })
  })

  // ─── GET /api/media/:itemId/:filename ─────────────────────────────

  describe('GET /api/media/:itemId/:filename', () => {
    it('returns 404 for non-existent media', async () => {
      mockGetMediaStream.mockRejectedValue(new Error('Blob not found'))

      const res = await request(app).get('/api/media/nonexistent/media.mp4')
      expect(res.status).toBe(404)
    })

    it('streams media with correct content type', async () => {
      const fakeStream = Readable.from(Buffer.from('fake video data'))
      mockGetMediaStream.mockResolvedValue({ stream: fakeStream, contentType: 'video/mp4' })

      const res = await request(app).get('/api/media/item-1/media.mp4')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('video/mp4')
    })
  })

  // ─── GET /api/schedule ────────────────────────────────────────────

  describe('GET /api/schedule', () => {
    it('returns schedule calendar', async () => {
      const res = await request(app).get('/api/schedule')
      expect(res.status).toBe(200)
      expect(res.body.slots).toEqual([])
    })
  })

  // ─── GET /api/schedule/next-slot/:platform ────────────────────────

  describe('GET /api/schedule/next-slot/:platform', () => {
    it('returns next slot for platform', async () => {
      const res = await request(app).get('/api/schedule/next-slot/tiktok')
      expect(res.status).toBe(200)
      expect(res.body.platform).toBe('tiktok')
      expect(res.body.nextSlot).toBe('2026-02-15T19:00:00-06:00')
    })
  })

  // ─── GET /api/posts/grouped ───────────────────────────────────────

  describe('GET /api/posts/grouped', () => {
    it('returns empty groups when no items', async () => {
      const res = await request(app).get('/api/posts/grouped')
      expect(res.status).toBe(200)
      expect(res.body.groups).toEqual([])
      expect(res.body.total).toBe(0)
    })

    it('returns grouped items when available', async () => {
      mockGetGroupedItems.mockResolvedValue([
        { videoSlug: 'test-video', items: [makeReviewItem('group-a'), makeReviewItem('group-b')] },
      ])

      const res = await request(app).get('/api/posts/grouped')
      expect(res.status).toBe(200)
      expect(res.body.total).toBe(1)
    })
  })

  // ─── GET /api/init ────────────────────────────────────────────────

  describe('GET /api/init', () => {
    it('returns combined init data', async () => {
      const res = await request(app).get('/api/init')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('groups')
      expect(res.body).toHaveProperty('total')
      expect(res.body).toHaveProperty('accounts')
      expect(res.body).toHaveProperty('profile')
    })
  })

  // ─── POST /api/posts/bulk-approve ─────────────────────────────────

  describe('POST /api/posts/bulk-approve', () => {
    it('returns 400 when itemIds is missing', async () => {
      const res = await request(app).post('/api/posts/bulk-approve').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('itemIds')
    })

    it('returns 400 when itemIds is empty', async () => {
      const res = await request(app).post('/api/posts/bulk-approve').send({ itemIds: [] })
      expect(res.status).toBe(400)
    })

    it('returns 202 accepted for valid itemIds', async () => {
      mockGetContentItems.mockResolvedValue([
        makeContentRecord('bulk-a'),
        makeContentRecord('bulk-b'),
      ])

      const res = await request(app).post('/api/posts/bulk-approve').send({ itemIds: ['bulk-a', 'bulk-b'] })
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)
      expect(res.body.count).toBe(2)

      await new Promise(resolve => setTimeout(resolve, 300))
    })
  })

  // ─── POST /api/posts/bulk-reject ──────────────────────────────────

  describe('POST /api/posts/bulk-reject', () => {
    it('returns 400 when itemIds is missing', async () => {
      const res = await request(app).post('/api/posts/bulk-reject').send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('itemIds')
    })

    it('returns 400 when itemIds is empty', async () => {
      const res = await request(app).post('/api/posts/bulk-reject').send({ itemIds: [] })
      expect(res.status).toBe(400)
    })

    it('returns 202 and rejects items in background', async () => {
      mockGetContentItems.mockResolvedValue([
        makeContentRecord('bulk-reject-a'),
        makeContentRecord('bulk-reject-b'),
      ])

      const res = await request(app).post('/api/posts/bulk-reject').send({ itemIds: ['bulk-reject-a', 'bulk-reject-b'] })
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)
      expect(res.body.count).toBe(2)

      await new Promise(resolve => setTimeout(resolve, 300))

      expect(mockAzureRejectItem).toHaveBeenCalledTimes(2)
    })
  })

  // ─── GET /api/accounts ────────────────────────────────────────────

  describe('GET /api/accounts', () => {
    it('returns accounts list', async () => {
      const res = await request(app).get('/api/accounts')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('accounts')
      expect(Array.isArray(res.body.accounts)).toBe(true)
    })
  })

  // ─── GET /api/profile ─────────────────────────────────────────────

  describe('GET /api/profile', () => {
    it('returns profile info', async () => {
      const res = await request(app).get('/api/profile')
      expect(res.status).toBe(200)
      expect(res.body).toHaveProperty('profile')
    })
  })
})

// ── Server startup test ─────────────────────────────────────────────

describe('startReviewServer', () => {
  it('starts without path-to-regexp errors (regression: /* wildcard)', async () => {
    const { startReviewServer } = await import('../../../L7-app/review/server.js')
    const server = await startReviewServer({ port: 0 })
    expect(server.port).toBeGreaterThan(0)
    await server.close()
  })
})
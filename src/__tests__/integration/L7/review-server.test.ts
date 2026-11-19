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
const mockFindContentItemByRowKey = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const mockIsStorageConfigured = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockStorageProvider = vi.hoisted(() => vi.fn().mockReturnValue('aws'))
const profileConfig = vi.hoisted(() => ({ LATE_PROFILE_ID: '' }))
const mockListAccounts = vi.hoisted(() => vi.fn())
const mockListProfiles = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key', ...profileConfig }),
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

vi.mock('../../../L3-services/storage/reviewDataSource.js', () => ({
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

vi.mock('../../../L3-services/storage/storageService.js', () => ({
  getContentItems: mockGetContentItems,
  findContentItemByRowKey: mockFindContentItemByRowKey,
  isStorageConfigured: mockIsStorageConfigured,
  getStorageProviderName: mockStorageProvider,
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' } },
    async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
    async getScheduledPosts() { return [] },
    listAccounts: mockListAccounts,
    listProfiles: mockListProfiles,
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
import { startReviewServer } from '../../../L7-app/review/server.js'
import type { ReviewItem, ReviewGroup } from '../../../L3-services/storage/reviewDataSource.js'

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
  profileConfig.LATE_PROFILE_ID = ''
  mockListProfiles.mockResolvedValue([{ _id: 'profile-1', name: 'Test Profile' }])
  mockListAccounts.mockResolvedValue([{ _id: 'acc-1', platform: 'tiktok', profileId: 'profile-1' }])
  mockIsStorageConfigured.mockReturnValue(true)
  mockStorageProvider.mockReturnValue('aws')
  mockGetIdeasByIds.mockResolvedValue([])
  mockListPendingItems.mockResolvedValue([])
  mockGetGroupedItems.mockResolvedValue([])
  mockGetItemById.mockResolvedValue(null)
  mockAzureUpdateItem.mockResolvedValue(null)
  mockAzureRejectItem.mockResolvedValue(undefined)
  mockGetContentItems.mockResolvedValue([])
  mockFindContentItemByRowKey.mockResolvedValue(null)
  mockGetMediaStream.mockRejectedValue(new Error('Not found'))
})

it('LateProfileRouting.REQ-006: review identity and accounts follow configured profile and cache switches', async () => {
  const app = buildApp()
  mockListProfiles.mockResolvedValue([
    { _id: 'review-other', name: 'Other' },
    { _id: 'review-target', name: 'Target' },
  ])
  mockListAccounts.mockResolvedValue([
    { _id: 'other-account', platform: 'instagram', profileId: 'review-other' },
    { _id: 'target-account', platform: 'instagram', profileId: { _id: 'review-target', name: 'Target' } },
  ])
  profileConfig.LATE_PROFILE_ID = 'review-target'
  const initial = await request(app).get('/api/init')
  expect(initial.body.profile._id).toBe('review-target')
  expect(initial.body.accounts.map((account: { _id: string }) => account._id)).toEqual(['target-account'])
  expect((await request(app).get('/api/profile')).body.profile._id).toBe('review-target')
  expect((await request(app).get('/api/accounts')).body.accounts).toHaveLength(1)

  profileConfig.LATE_PROFILE_ID = 'review-other'
  expect((await request(app).get('/api/profile')).body.profile._id).toBe('review-other')
  expect((await request(app).get('/api/accounts')).body.accounts.map((account: { _id: string }) => account._id)).toEqual(['other-account'])

  profileConfig.LATE_PROFILE_ID = 'review-missing'
  const missing = await request(app).get('/api/init')
  expect(missing.body.profile).toBeNull()
  expect(missing.body.accounts).toEqual([])
  expect((await request(app).get('/api/profile')).status).toBe(500)
})

it('ReviewStorage.REQ-003: startup reports AWS resources rather than requiring Azure credentials', async () => {
  mockIsStorageConfigured.mockReturnValue(false)
  await expect(startReviewServer()).rejects.toThrow('AWS S3 and DynamoDB')
})

it('ReviewStorage.REQ-003: Azure startup keeps its existing configuration diagnostic', async () => {
  mockIsStorageConfigured.mockReturnValue(false)
  mockStorageProvider.mockReturnValue('azure')
  await expect(startReviewServer()).rejects.toThrow('AZURE_STORAGE_ACCOUNT_NAME')
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

    it('ReviewStorage.REQ-003: lists selected-provider posts without Azure configuration', async () => {
      mockListPendingItems.mockResolvedValue([
        makeReviewItem('item-a'),
        makeReviewItem('item-b'),
      ])

      const res = await request(app).get('/api/posts/pending')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      expect(res.body.total).toBe(2)
    })

    it('listing does not enrich ideas (deferred to per-item fetch)', async () => {
      mockListPendingItems.mockResolvedValue([
        makeReviewItem('idea-a', { ideaIds: ['idea-1', '42'] }),
        makeReviewItem('idea-b', { ideaIds: ['idea-2', 'idea-1'] }),
      ])

      const res = await request(app).get('/api/posts/pending')

      expect(res.status).toBe(200)
      // No idea enrichment on listing endpoints — saves API calls
      expect(mockGetIdeasByIds).not.toHaveBeenCalled()
      expect(res.body.items[0].ideaPublishBy).toBeUndefined()
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
      mockFindContentItemByRowKey.mockResolvedValue(makeContentRecord('detail-item'))
      mockGetItemById.mockResolvedValue(item)

      const res = await request(app).get('/api/posts/detail-item')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe('detail-item')
      expect(res.body.postContent).toBe('Test post content for detail-item')
      expect(res.body.platform).toBe('tiktok')
    })

    it('includes earliest idea publishBy when linked ideas are available', async () => {
      const item = makeReviewItem('detail-idea-item', { ideaIds: ['idea-later', 'idea-earlier'] })
      mockFindContentItemByRowKey.mockResolvedValue(makeContentRecord('detail-idea-item', { ideaIds: ['idea-later', 'idea-earlier'] }))
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

    it('ReviewStorage.REQ-003: rejects selected-provider items', async () => {
      mockFindContentItemByRowKey.mockResolvedValue(makeContentRecord('reject-me'))

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

    it('ReviewStorage.REQ-003: edits selected-provider items', async () => {
      const updatedItem = makeReviewItem('edit-me', { postContent: 'Updated content!' })
      mockFindContentItemByRowKey.mockResolvedValue(makeContentRecord('edit-me'))
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
    it('ReviewStorage.REQ-002: cancels media that arrives after the client disconnects', async () => {
      const stream = new Readable({ read() {} })
      let finishDownload!: (value: { stream: Readable; contentType: string }) => void
      mockGetMediaStream.mockReturnValueOnce(new Promise(resolve => { finishDownload = resolve }))
      let closedResponse!: () => void
      const responseClosed = new Promise<void>(resolve => { closedResponse = resolve })
      const app = express()
      app.use((_req, res, next) => {
        res.once('close', closedResponse)
        res.destroy()
        next()
      })
      app.use(createRouter())
      request(app).get('/api/media/item-1/media.mp4').end(() => {})
      await responseClosed
      finishDownload({ stream, contentType: 'video/mp4' })
      await new Promise(resolve => setImmediate(resolve))
      expect(stream.destroyed).toBe(true)
      stream.destroy()
    })

    it('ReviewStorage.REQ-002: cancels upstream media when the playback client disconnects', async () => {
      const stream = new Readable({ read() {} })
      mockGetMediaStream.mockResolvedValueOnce({ stream, contentType: 'video/mp4' })
      const closed = new Promise<void>(resolve => stream.once('close', resolve))
      const app = express()
      app.use((_req, res, next) => {
        res.once('pipe', () => res.destroy())
        next()
      })
      app.use(createRouter())
      request(app).get('/api/media/item-1/media.mp4').end(() => {})
      await closed
      expect(stream.destroyed).toBe(true)
    })

    it('ReviewStorage.REQ-002: preserves unsatisfiable range errors', async () => {
      mockGetMediaStream.mockRejectedValueOnce(Object.assign(new Error('Range not satisfiable'), { statusCode: 416 }))
      const res = await request(buildApp()).get('/api/media/item-1/media.mp4').set('Range', 'bytes=99999-')
      expect(res.status).toBe(416)
    })

    it('ReviewStorage.REQ-002: stream failures return JSON without stale media-length headers', async () => {
      const stream = new Readable({ read() { this.destroy(new Error('Download failed')) } })
      mockGetMediaStream.mockResolvedValueOnce({ stream, contentType: 'video/mp4', contentLength: 100 })
      const res = await request(buildApp()).get('/api/media/item-1/media.mp4')
      expect(res.status).toBe(500)
      expect(res.headers['content-type']).toContain('application/json')
      expect(res.body.error).toBe('Stream error')
    })

    it('ReviewStorage.REQ-002: forwards byte ranges and partial content metadata', async () => {
      mockGetMediaStream.mockResolvedValue({
        stream: Readable.from(Buffer.from('part')),
        contentType: 'video/mp4',
        contentLength: 4,
        contentRange: 'bytes 0-3/10',
        acceptRanges: 'bytes',
        statusCode: 206,
      })
      const res = await request(app).get('/api/media/item-1/media.mp4').set('Range', 'bytes=0-3')
      expect(mockGetMediaStream).toHaveBeenCalledWith('item-1', 'media.mp4', 'bytes=0-3')
      expect(res.status).toBe(206)
      expect(res.headers['content-range']).toBe('bytes 0-3/10')
      expect(res.headers['content-length']).toBe('4')
      expect(res.headers['accept-ranges']).toBe('bytes')
    })

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
      // Grouped items should NOT have ideaPublishBy (deferred to per-item fetch)
      expect(res.body.groups[0].items[0].ideaPublishBy).toBeUndefined()
    })
  })

  // ─── GET /api/init ────────────────────────────────────────────────

  describe('GET /api/init', () => {
    it('ReviewStorage.REQ-001: returns a storage failure instead of an empty queue', async () => {
      mockGetGroupedItems.mockRejectedValueOnce(new Error('AWS access denied for content table'))
      const res = await request(app).get('/api/init')
      expect(res.status).toBe(503)
      expect(res.body.error).toContain('AWS access denied')
      expect(res.body.groups).toBeUndefined()
    })

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
  it('starts without path-to-regexp errors (regression: /{*splat} wildcard)', async () => {
    const { startReviewServer } = await import('../../../L7-app/review/server.js')
    const server = await startReviewServer({ port: 0 })
    expect(server.port).toBeGreaterThan(0)
    await server.close()
  })

  it('SPA fallback serves index.html for non-API paths', async () => {
    const { startReviewServer } = await import('../../../L7-app/review/server.js')
    const server = await startReviewServer({ port: 0 })
    const res = await request(`http://localhost:${server.port}`).get('/some/deep/route')
    expect(res.status).toBe(200)
    await server.close()
  })
})
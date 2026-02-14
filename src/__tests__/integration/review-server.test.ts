import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs, closeSync } from 'node:fs'
import path from 'node:path'
import tmp from 'tmp'

// ── Mock setup ─────────────────────────────────────────────────────────

const tmpDirObj = tmp.dirSync({ prefix: 'vidpipe-review-test-', unsafeCleanup: false })
const tmpDir = tmpDirObj.name

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: tmpDir, LATE_API_KEY: 'test-key' }),
  initConfig: () => ({ OUTPUT_DIR: tmpDir, LATE_API_KEY: 'test-key' }),
}))

vi.mock('../../services/lateApi.js', () => ({
  LateApiClient: class {
    async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' } }
    async createPost() { return { _id: 'test-post-id', status: 'scheduled' } }
    async getScheduledPosts() { return [] }
    async listAccounts() { return [] }
  },
}))

vi.mock('../../services/scheduler.js', () => ({
  findNextSlot: async () => '2026-02-15T19:00:00-06:00',
  getScheduleCalendar: async () => [],
}))

vi.mock('../../services/accountMapping.js', () => ({
  getAccountId: async () => 'test-account-id',
}))

vi.mock('../../services/scheduleConfig.js', () => ({
  loadScheduleConfig: async () => ({ timezone: 'America/Chicago', platforms: {} }),
}))

// ── Import after mocks ────────────────────────────────────────────────

import express from 'express'
import request from 'supertest'
import { createRouter } from '../../review/routes.js'
import type { QueueItemMetadata } from '../../services/postStore.js'

// Build a lightweight Express app with just the API router
function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item',
    platform: 'tiktok',
    accountId: '',
    sourceVideo: '/test/video',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: null,
    hashtags: ['test'],
    links: [],
    characterCount: 20,
    platformCharLimit: 2200,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

async function createTestItem(id: string, overrides: Partial<QueueItemMetadata> = {}) {
  const dir = path.join(tmpDir, 'publish-queue', id)
  await fs.mkdir(dir, { recursive: true })
  
  const metadataTmp = tmp.fileSync({ dir, postfix: '.tmp', keep: true })
  await fs.writeFile(
    metadataTmp.name,
    JSON.stringify(makeMetadata({ id, ...overrides })),
  )
  closeSync(metadataTmp.fd) // Close file descriptor on Windows before rename
  await fs.rename(metadataTmp.name, path.join(dir, 'metadata.json'))
  
  const postTmp = tmp.fileSync({ dir, postfix: '.tmp', keep: true })
  await fs.writeFile(postTmp.name, `Test post content for ${id}`)
  closeSync(postTmp.fd) // Close file descriptor on Windows before rename
  await fs.rename(postTmp.name, path.join(dir, 'post.md'))
}

// ── Lifecycle ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await fs.mkdir(path.join(tmpDir, 'publish-queue'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'published'), { recursive: true })
})

afterAll(async () => {
  // Don't call both fs.rm and removeCallback - they conflict
  // Use removeCallback to let tmp clean up properly
  try {
    tmpDirObj.removeCallback()
  } catch {
    // Ignore if already cleaned up
  }
})

beforeEach(async () => {
  // Clean queue between tests
  await fs.rm(path.join(tmpDir, 'publish-queue'), { recursive: true, force: true })
  await fs.rm(path.join(tmpDir, 'published'), { recursive: true, force: true })
  await fs.mkdir(path.join(tmpDir, 'publish-queue'), { recursive: true })
  await fs.mkdir(path.join(tmpDir, 'published'), { recursive: true })
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
      await createTestItem('item-a')
      await createTestItem('item-b')

      const res = await request(app).get('/api/posts/pending')
      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(2)
      expect(res.body.total).toBe(2)
    })

    it('items are sorted by createdAt', async () => {
      await createTestItem('older', { createdAt: '2025-01-01T00:00:00Z' })
      await createTestItem('newer', { createdAt: '2025-06-01T00:00:00Z' })
      await createTestItem('oldest', { createdAt: '2024-06-01T00:00:00Z' })

      const res = await request(app).get('/api/posts/pending')
      expect(res.status).toBe(200)
      const ids = res.body.items.map((i: { id: string }) => i.id)
      expect(ids).toEqual(['oldest', 'older', 'newer'])
    })
  })

  // ─── GET /api/posts/:id ────────────────────────────────────────────

  describe('GET /api/posts/:id', () => {
    it('returns 404 for non-existent item', async () => {
      const res = await request(app).get('/api/posts/does-not-exist')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('returns item with full content', async () => {
      await createTestItem('detail-item')

      const res = await request(app).get('/api/posts/detail-item')
      expect(res.status).toBe(200)
      expect(res.body.id).toBe('detail-item')
      expect(res.body.postContent).toBe('Test post content for detail-item')
      expect(res.body.metadata.platform).toBe('tiktok')
    })
  })

  // ─── POST /api/posts/:id/approve ──────────────────────────────────

  describe('POST /api/posts/:id/approve', () => {
    it('returns 404 for non-existent item', async () => {
      const res = await request(app).post('/api/posts/ghost/approve')
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('approves item and returns scheduledFor', async () => {
      await createTestItem('approve-me')

      const res = await request(app).post('/api/posts/approve-me/approve')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.scheduledFor).toBe('2026-02-15T19:00:00-06:00')
      expect(res.body.latePostId).toBe('test-post-id')
    })

    it('moves item to published/ folder', async () => {
      await createTestItem('approve-move')

      await request(app).post('/api/posts/approve-move/approve')

      // No longer in queue
      const pendingRes = await request(app).get('/api/posts/approve-move')
      expect(pendingRes.status).toBe(404)

      // Exists in published dir
      const publishedMeta = JSON.parse(
        await fs.readFile(
          path.join(tmpDir, 'published', 'approve-move', 'metadata.json'),
          'utf-8',
        ),
      )
      expect(publishedMeta.status).toBe('published')
      expect(publishedMeta.latePostId).toBe('test-post-id')
    })
  })

  // ─── POST /api/posts/:id/reject ───────────────────────────────────

  describe('POST /api/posts/:id/reject', () => {
    it('returns 404-ish for non-existent item', async () => {
      // rejectItem silently succeeds (rm on non-existent path doesn't throw)
      const res = await request(app).post('/api/posts/ghost/reject')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })

    it('deletes item from queue', async () => {
      await createTestItem('reject-me')

      // Verify it exists first
      const before = await request(app).get('/api/posts/reject-me')
      expect(before.status).toBe(200)

      const res = await request(app).post('/api/posts/reject-me/reject')
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)

      // Verify it's gone
      const after = await request(app).get('/api/posts/reject-me')
      expect(after.status).toBe(404)
    })
  })

  // ─── PUT /api/posts/:id ───────────────────────────────────────────

  describe('PUT /api/posts/:id', () => {
    it('returns 404 for non-existent item', async () => {
      const res = await request(app)
        .put('/api/posts/ghost')
        .send({ postContent: 'New content' })
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('Item not found')
    })

    it('updates post content', async () => {
      await createTestItem('edit-me')

      const res = await request(app)
        .put('/api/posts/edit-me')
        .send({ postContent: 'Updated content!' })
      expect(res.status).toBe(200)
      expect(res.body.postContent).toBe('Updated content!')

      // Verify persisted
      const check = await request(app).get('/api/posts/edit-me')
      expect(check.body.postContent).toBe('Updated content!')
    })

    it('updates metadata fields', async () => {
      await createTestItem('edit-meta')

      const res = await request(app)
        .put('/api/posts/edit-meta')
        .send({ metadata: { hashtags: ['updated', 'tags'] } })
      expect(res.status).toBe(200)
      expect(res.body.metadata.hashtags).toEqual(['updated', 'tags'])
      // Original fields preserved
      expect(res.body.metadata.platform).toBe('tiktok')
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

  // ─── GET /api/posts/grouped ─────────────────────────────────────────

  describe('GET /api/posts/grouped', () => {
    it('returns empty array when no items', async () => {
      const res = await request(app).get('/api/posts/grouped')
      expect(res.status).toBe(200)
      expect(res.body.groups).toHaveLength(0)
      expect(res.body.total).toBe(0)
    })

    it('groups posts by sourceVideo and sourceClip', async () => {
      // Create 2 posts for same video/clip (different platforms)
      await createTestItem('video1-tiktok', { 
        platform: 'tiktok',
        sourceVideo: '/videos/video1',
        sourceClip: '/clips/short1',
        clipType: 'short',
      })
      await createTestItem('video1-youtube', { 
        platform: 'youtube',
        sourceVideo: '/videos/video1',
        sourceClip: '/clips/short1',
        clipType: 'short',
      })
      
      // Create 1 post for different video
      await createTestItem('video2-tiktok', { 
        platform: 'tiktok',
        sourceVideo: '/videos/video2',
        sourceClip: null,
        clipType: 'video',
      })

      const res = await request(app).get('/api/posts/grouped')
      expect(res.status).toBe(200)
      expect(res.body.groups).toHaveLength(2)
      expect(res.body.total).toBe(2)

      // Find the video1 group
      const video1Group = res.body.groups.find((g: { sourceVideo: string }) => 
        g.sourceVideo === '/videos/video1'
      )
      expect(video1Group).toBeDefined()
      expect(video1Group.items).toHaveLength(2)
      expect(video1Group.clipType).toBe('short')
      expect(video1Group.sourceClip).toBe('/clips/short1')

      // Find the video2 group
      const video2Group = res.body.groups.find((g: { sourceVideo: string }) => 
        g.sourceVideo === '/videos/video2'
      )
      expect(video2Group).toBeDefined()
      expect(video2Group.items).toHaveLength(1)
      expect(video2Group.clipType).toBe('video')
      expect(video2Group.sourceClip).toBeNull()
    })
  })

  // ─── POST /api/posts/bulk-approve ─────────────────────────────────────

  describe('POST /api/posts/bulk-approve', () => {
    it('returns 400 when itemIds is missing', async () => {
      const res = await request(app)
        .post('/api/posts/bulk-approve')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('itemIds')
    })

    it('returns 400 when itemIds is empty array', async () => {
      const res = await request(app)
        .post('/api/posts/bulk-approve')
        .send({ itemIds: [] })
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('itemIds')
    })

    it('approves multiple items at once', async () => {
      await createTestItem('bulk-1')
      await createTestItem('bulk-2')
      await createTestItem('bulk-3')

      const res = await request(app)
        .post('/api/posts/bulk-approve')
        .send({ itemIds: ['bulk-1', 'bulk-2', 'bulk-3'] })
      
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.results).toHaveLength(3)
      expect(res.body.count).toBe(3)

      // Verify all items are gone from queue
      const check1 = await request(app).get('/api/posts/bulk-1')
      const check2 = await request(app).get('/api/posts/bulk-2')
      const check3 = await request(app).get('/api/posts/bulk-3')
      expect(check1.status).toBe(404)
      expect(check2.status).toBe(404)
      expect(check3.status).toBe(404)
    })
  })

  // ─── POST /api/posts/bulk-reject ───────────────────────────────────────

  describe('POST /api/posts/bulk-reject', () => {
    it('returns 400 when itemIds is missing', async () => {
      const res = await request(app)
        .post('/api/posts/bulk-reject')
        .send({})
      expect(res.status).toBe(400)
      expect(res.body.error).toContain('itemIds')
    })

    it('rejects multiple items at once', async () => {
      await createTestItem('reject-bulk-1')
      await createTestItem('reject-bulk-2')

      const res = await request(app)
        .post('/api/posts/bulk-reject')
        .send({ itemIds: ['reject-bulk-1', 'reject-bulk-2'] })
      
      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.count).toBe(2)

      // Verify all items are gone
      const check1 = await request(app).get('/api/posts/reject-bulk-1')
      const check2 = await request(app).get('/api/posts/reject-bulk-2')
      expect(check1.status).toBe(404)
      expect(check2.status).toBe(404)
    })
  })
})

// ── Server startup test ─────────────────────────────────────────────

describe('startReviewServer', () => {
  it('starts without path-to-regexp errors (regression: /* wildcard)', async () => {
    const { startReviewServer } = await import('../../review/server.js')
    const server = await startReviewServer({ port: 0 })
    expect(server.port).toBeGreaterThan(0)
    await server.close()
  })
})

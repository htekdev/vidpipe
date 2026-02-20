import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs, closeSync } from 'node:fs'
import path from 'node:path'
import tmp from 'tmp'

// ── Mock setup ─────────────────────────────────────────────────────────

const tmpDirObj = tmp.dirSync({ prefix: 'vidpipe-review-test-', unsafeCleanup: false })
const tmpDir = tmpDirObj.name

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: tmpDir, LATE_API_KEY: 'test-key' }),
  initConfig: () => ({ OUTPUT_DIR: tmpDir, LATE_API_KEY: 'test-key' }),
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
import type { QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'

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
      // Now returns 202 immediately (fire-and-forget), item-not-found is logged
      expect(res.status).toBe(202)
    })

    it('approves item and returns 202 accepted', async () => {
      await createTestItem('approve-me')

      const res = await request(app).post('/api/posts/approve-me/approve')
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)

      // Wait for queue to drain
      await new Promise(resolve => setTimeout(resolve, 200))
    })

    it('moves item to published/ folder', async () => {
      await createTestItem('approve-move')

      await request(app).post('/api/posts/approve-move/approve')

      // Wait for queue to drain
      await new Promise(resolve => setTimeout(resolve, 1000))

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

    it('accepts clipType query parameter', async () => {
      const res = await request(app).get('/api/schedule/next-slot/tiktok?clipType=short')
      expect(res.status).toBe(200)
      expect(res.body.platform).toBe('tiktok')
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

    it('returns grouped items when queue has posts', async () => {
      await createTestItem('group-a', { sourceVideo: '/test/video1', clipType: 'short' })
      await createTestItem('group-b', { sourceVideo: '/test/video1', clipType: 'short' })

      const res = await request(app).get('/api/posts/grouped')
      expect(res.status).toBe(200)
      expect(res.body.total).toBeGreaterThan(0)
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

    it('returns items in groups when queue has posts', async () => {
      await createTestItem('init-item')

      const res = await request(app).get('/api/init')
      expect(res.status).toBe(200)
      expect(res.body.total).toBeGreaterThan(0)
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
      await createTestItem('bulk-a')
      await createTestItem('bulk-b')

      const res = await request(app).post('/api/posts/bulk-approve').send({ itemIds: ['bulk-a', 'bulk-b'] })
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)
      expect(res.body.count).toBe(2)

      // Wait for background processing
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

    it('returns 202 and deletes items in background', async () => {
      await createTestItem('bulk-reject-a')
      await createTestItem('bulk-reject-b')

      const res = await request(app).post('/api/posts/bulk-reject').send({ itemIds: ['bulk-reject-a', 'bulk-reject-b'] })
      expect(res.status).toBe(202)
      expect(res.body.accepted).toBe(true)
      expect(res.body.count).toBe(2)

      // Wait for background processing
      await new Promise(resolve => setTimeout(resolve, 300))

      // Verify items are gone
      const checkA = await request(app).get('/api/posts/bulk-reject-a')
      expect(checkA.status).toBe(404)
      const checkB = await request(app).get('/api/posts/bulk-reject-b')
      expect(checkB.status).toBe(404)
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
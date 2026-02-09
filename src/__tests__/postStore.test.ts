import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

// ── Mock setup ─────────────────────────────────────────────────────────

const tmpDir = path.join(os.tmpdir(), `vidpipe-poststore-${Date.now()}`)

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: tmpDir }),
}))

// ── Import after mocks ────────────────────────────────────────────────

import {
  createItem,
  getPendingItems,
  getItem,
  updateItem,
  approveItem,
  rejectItem,
  itemExists,
  type QueueItemMetadata,
} from '../services/postStore.js'

// ── Helpers ────────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item-1',
    platform: 'twitter',
    accountId: 'acct-123',
    sourceVideo: 'my-video',
    sourceClip: null,
    clipType: 'video',
    sourceMediaPath: null,
    hashtags: ['#dev'],
    links: [],
    characterCount: 42,
    platformCharLimit: 280,
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

// ── Tests ──────────────────────────────────────────────────────────────

describe('postStore', () => {
  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('createItem', () => {
    it('creates folder with metadata.json and post.md', async () => {
      const meta = makeMetadata({ id: 'create-1' })
      const item = await createItem('create-1', meta, 'Hello world')

      expect(item.id).toBe('create-1')
      expect(item.postContent).toBe('Hello world')
      expect(item.hasMedia).toBe(false)

      const metaOnDisk = JSON.parse(
        await fs.readFile(path.join(item.folderPath, 'metadata.json'), 'utf-8'),
      )
      expect(metaOnDisk.platform).toBe('twitter')

      const postOnDisk = await fs.readFile(path.join(item.folderPath, 'post.md'), 'utf-8')
      expect(postOnDisk).toBe('Hello world')
    })

    it('copies media file when provided', async () => {
      const mediaSource = path.join(tmpDir, 'source-media.mp4')
      await fs.writeFile(mediaSource, 'fake-video-bytes')

      const meta = makeMetadata({ id: 'create-media' })
      const item = await createItem('create-media', meta, 'With video', mediaSource)

      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.mp4')

      const mediaBytes = await fs.readFile(item.mediaPath!, 'utf-8')
      expect(mediaBytes).toBe('fake-video-bytes')
    })
  })

  describe('getPendingItems', () => {
    it('returns items sorted by createdAt', async () => {
      const meta1 = makeMetadata({ id: 'sort-a', createdAt: '2025-01-01T00:00:00Z' })
      const meta2 = makeMetadata({ id: 'sort-b', createdAt: '2025-01-02T00:00:00Z' })
      const meta3 = makeMetadata({ id: 'sort-c', createdAt: '2024-12-31T00:00:00Z' })

      await createItem('sort-a', meta1, 'A')
      await createItem('sort-b', meta2, 'B')
      await createItem('sort-c', meta3, 'C')

      const items = await getPendingItems()
      expect(items).toHaveLength(3)
      expect(items[0].id).toBe('sort-c')
      expect(items[1].id).toBe('sort-a')
      expect(items[2].id).toBe('sort-b')
    })
  })

  describe('getItem', () => {
    it('returns null for non-existent item', async () => {
      const item = await getItem('does-not-exist')
      expect(item).toBeNull()
    })

    it('returns existing item', async () => {
      const meta = makeMetadata({ id: 'existing' })
      await createItem('existing', meta, 'Content')

      const item = await getItem('existing')
      expect(item).not.toBeNull()
      expect(item!.postContent).toBe('Content')
    })
  })

  describe('updateItem', () => {
    it('merges metadata updates', async () => {
      const meta = makeMetadata({ id: 'update-meta' })
      await createItem('update-meta', meta, 'Original')

      const updated = await updateItem('update-meta', {
        metadata: { scheduledFor: '2025-06-01T12:00:00Z' },
      })
      expect(updated).not.toBeNull()
      expect(updated!.metadata.scheduledFor).toBe('2025-06-01T12:00:00Z')
      // Original fields preserved
      expect(updated!.metadata.platform).toBe('twitter')
    })

    it('updates post content', async () => {
      const meta = makeMetadata({ id: 'update-content' })
      await createItem('update-content', meta, 'Original')

      const updated = await updateItem('update-content', {
        postContent: 'Updated content',
      })
      expect(updated).not.toBeNull()
      expect(updated!.postContent).toBe('Updated content')
    })

    it('returns null for non-existent item', async () => {
      const updated = await updateItem('no-such-item', { postContent: 'x' })
      expect(updated).toBeNull()
    })
  })

  describe('approveItem', () => {
    it('moves folder to published/ and updates metadata', async () => {
      const meta = makeMetadata({ id: 'approve-1' })
      await createItem('approve-1', meta, 'Approve me')

      await approveItem('approve-1', {
        latePostId: 'late-abc',
        scheduledFor: '2025-06-01T12:00:00Z',
      })

      // No longer in pending
      const pending = await getItem('approve-1')
      expect(pending).toBeNull()

      // Now in published dir
      const publishedMeta = JSON.parse(
        await fs.readFile(
          path.join(tmpDir, 'published', 'approve-1', 'metadata.json'),
          'utf-8',
        ),
      )
      expect(publishedMeta.status).toBe('published')
      expect(publishedMeta.latePostId).toBe('late-abc')
      expect(publishedMeta.publishedAt).toBeTruthy()
    })
  })

  describe('rejectItem', () => {
    it('deletes folder entirely', async () => {
      const meta = makeMetadata({ id: 'reject-1' })
      await createItem('reject-1', meta, 'Reject me')

      await rejectItem('reject-1')

      const exists = await itemExists('reject-1')
      expect(exists).toBeNull()
    })
  })

  describe('itemExists', () => {
    it('returns pending for queued item', async () => {
      const meta = makeMetadata({ id: 'exists-pending' })
      await createItem('exists-pending', meta, 'Pending')

      expect(await itemExists('exists-pending')).toBe('pending')
    })

    it('returns published for approved item', async () => {
      const meta = makeMetadata({ id: 'exists-pub' })
      await createItem('exists-pub', meta, 'Pub')
      await approveItem('exists-pub', {
        latePostId: 'late-x',
        scheduledFor: '2025-06-01T12:00:00Z',
      })

      expect(await itemExists('exists-pub')).toBe('published')
    })

    it('returns null for non-existent item', async () => {
      expect(await itemExists('nonexistent')).toBeNull()
    })
  })
})

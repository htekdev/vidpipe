import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'

// ── Mock setup ─────────────────────────────────────────────────────────

const tmpDirObj = tmp.dirSync({ prefix: 'vidpipe-poststore-', unsafeCleanup: false })
const tmpDir = tmpDirObj.name

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: tmpDir }),
}))

// Allow spying on renameFile from core/fileSystem for the EPERM fallback test
const { mockRenameFile } = vi.hoisted(() => ({
  mockRenameFile: vi.fn() as ReturnType<typeof vi.fn>,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../L1-infra/fileSystem/fileSystem.js')>()
  mockRenameFile.mockImplementation(mod.renameFile)
  return { ...mod, renameFile: mockRenameFile }
})

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
} from '../../../L3-services/postStore/postStore.js'

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
    // Clean directory contents but keep the directory
    const entries = await fs.readdir(tmpDir)
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })),
    )
  })

  afterAll(() => {
    tmpDirObj.removeCallback()
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
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.mp4', mode: 0o600 })
      const mediaSource = mediaTmpFile.name
      await fs.writeFile(mediaSource, 'fake-video-bytes')

      const meta = makeMetadata({ id: 'create-media' })
      const item = await createItem('create-media', meta, 'With video', mediaSource)

      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.mp4')

      const mediaBytes = await fs.readFile(item.mediaPath!, 'utf-8')
      expect(mediaBytes).toBe('fake-video-bytes')
    })

    it('copies PNG image file with correct extension', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.png', mode: 0o600 })
      const mediaSource = mediaTmpFile.name
      await fs.writeFile(mediaSource, 'fake-png-bytes')

      const meta = makeMetadata({ id: 'create-png' })
      const item = await createItem('create-png', meta, 'With image', mediaSource)

      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.png')

      const mediaBytes = await fs.readFile(item.mediaPath!, 'utf-8')
      expect(mediaBytes).toBe('fake-png-bytes')
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

    it('falls back to copy+delete when rename fails with EPERM', async () => {
      const meta = makeMetadata({ id: 'approve-eperm' })
      const item = await createItem('approve-eperm', meta, 'EPERM test', undefined)

      // Write a media file so the folder has content to copy
      await fs.writeFile(path.join(item.folderPath, 'media.mp4'), 'fake-video-bytes')

      // Mock renameFile from core/fileSystem to simulate EPERM (Windows file handle lock)
      mockRenameFile.mockRejectedValueOnce(
        Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }),
      )

      await approveItem('approve-eperm', {
        latePostId: 'late-eperm',
        scheduledFor: '2025-07-01T12:00:00Z',
      })

      // Source folder should be gone
      const pending = await getItem('approve-eperm')
      expect(pending).toBeNull()

      // Published folder should have both files
      const publishedDir = path.join(tmpDir, 'published', 'approve-eperm')
      const publishedMeta = JSON.parse(
        await fs.readFile(path.join(publishedDir, 'metadata.json'), 'utf-8'),
      )
      expect(publishedMeta.status).toBe('published')
      expect(publishedMeta.latePostId).toBe('late-eperm')

      const mediaContent = await fs.readFile(path.join(publishedDir, 'media.mp4'), 'utf-8')
      expect(mediaContent).toBe('fake-video-bytes')
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

  describe('readQueueItem image support', () => {
    it('finds media.png when media.mp4 does not exist', async () => {
      const meta = makeMetadata({ id: 'img-only' })
      const item = await createItem('img-only', meta, 'Image post')
      // Manually create media.png in the folder
      await fs.writeFile(path.join(item.folderPath, 'media.png'), 'fake-png')

      const read = await getItem('img-only')
      expect(read).not.toBeNull()
      expect(read!.hasMedia).toBe(true)
      expect(read!.mediaPath).toContain('media.png')
    })

    it('prefers media.mp4 over media.png when both exist', async () => {
      const meta = makeMetadata({ id: 'both-media' })
      const item = await createItem('both-media', meta, 'Both media')
      await fs.writeFile(path.join(item.folderPath, 'media.mp4'), 'video')
      await fs.writeFile(path.join(item.folderPath, 'media.png'), 'image')

      const read = await getItem('both-media')
      expect(read).not.toBeNull()
      expect(read!.hasMedia).toBe(true)
      expect(read!.mediaPath).toContain('media.mp4')
    })

    it('preserves mediaType field in metadata', async () => {
      const meta = makeMetadata({ id: 'img-type', mediaType: 'image' })
      await createItem('img-type', meta, 'Image type post')

      const read = await getItem('img-type')
      expect(read).not.toBeNull()
      expect(read!.metadata.mediaType).toBe('image')
    })
  })

  describe('validateId (via exported functions)', () => {
    it('rejects path traversal characters', async () => {
      await expect(getItem('../etc/passwd')).rejects.toThrow('Invalid ID format')
    })

    it('rejects empty string', async () => {
      await expect(getItem('')).rejects.toThrow('Invalid ID format')
    })

    it('rejects IDs with dots', async () => {
      await expect(getItem('foo.bar')).rejects.toThrow('Invalid ID format')
    })

    it('rejects IDs with slashes', async () => {
      await expect(getItem('foo/bar')).rejects.toThrow('Invalid ID format')
    })
  })
})

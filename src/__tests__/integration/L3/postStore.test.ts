/**
 * L3 Integration Test — postStore service
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L3 postStore business logic, L0 pure functions
 *
 * Validates queue item CRUD, bulk approval, rejection, grouping,
 * and path-traversal guards with controlled file I/O.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockListDirectoryWithTypes = vi.hoisted(() => vi.fn())
const mockCopyFile = vi.hoisted(() => vi.fn())
const mockRenameFile = vi.hoisted(() => vi.fn())
const mockRemoveDirectory = vi.hoisted(() => vi.fn())
const mockCopyDirectory = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
  ensureDirectory: mockEnsureDirectory,
  listDirectoryWithTypes: mockListDirectoryWithTypes,
  copyFile: mockCopyFile,
  renameFile: mockRenameFile,
  removeDirectory: mockRemoveDirectory,
  copyDirectory: mockCopyDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => {
  const path = require('path')
  return {
    join: (...args: string[]) => path.join(...args),
    resolve: (...args: string[]) => path.resolve(...args),
    basename: (p: string) => path.basename(p),
    dirname: (p: string) => path.dirname(p),
    extname: (p: string) => path.extname(p),
    sep: path.sep,
  }
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: '/test/output' }),
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import {
  createItem,
  getItem,
  getPendingItems,
  getGroupedPendingItems,
  approveItem,
  rejectItem,
  approveBulk,
  updateItem,
  itemExists,
  getPublishedItems,
} from '../../../L3-services/postStore/postStore.js'
import type { QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'

// ── Helpers ───────────────────────────────────────────────────────────

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item-youtube',
    platform: 'youtube',
    accountId: 'acc-1',
    sourceVideo: '/recordings/my-video',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: '/media/short.mp4',
    hashtags: ['#test'],
    links: [{ url: 'https://example.com' }],
    characterCount: 100,
    platformCharLimit: 5000,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: '2026-01-15T10:00:00Z',
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: postStore', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockWriteTextFile.mockResolvedValue(undefined)
    mockCopyFile.mockResolvedValue(undefined)
    mockRenameFile.mockResolvedValue(undefined)
    mockRemoveDirectory.mockResolvedValue(undefined)
    mockCopyDirectory.mockResolvedValue(undefined)
  })

  // ── createItem ────────────────────────────────────────────────────

  describe('createItem', () => {
    it('creates a queue item folder with metadata and post files', async () => {
      const metadata = makeMetadata()
      const item = await createItem('my-short-youtube', metadata, 'Post content here')

      expect(mockEnsureDirectory).toHaveBeenCalled()
      expect(mockWriteJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        metadata,
      )
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('post.md'),
        'Post content here',
      )
      expect(item.id).toBe('my-short-youtube')
      expect(item.postContent).toBe('Post content here')
      expect(item.hasMedia).toBe(false)
      expect(item.mediaPath).toBeNull()
    })

    it('copies media file when mediaSourcePath is provided', async () => {
      const metadata = makeMetadata()
      const item = await createItem('my-short-youtube', metadata, 'Content', '/source/video.mp4')

      expect(mockCopyFile).toHaveBeenCalledWith(
        '/source/video.mp4',
        expect.stringContaining('media.mp4'),
      )
      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.mp4')
    })

    it('copies PNG image file with correct extension', async () => {
      const metadata = makeMetadata()
      const item = await createItem('my-short-youtube', metadata, 'Content', '/source/cover.png')

      expect(mockCopyFile).toHaveBeenCalledWith(
        '/source/cover.png',
        expect.stringContaining('media.png'),
      )
      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.png')
    })

    it('rejects invalid ID with path traversal characters', async () => {
      const metadata = makeMetadata()
      await expect(createItem('../evil', metadata, 'x')).rejects.toThrow('Invalid ID format')
      await expect(createItem('foo/bar', metadata, 'x')).rejects.toThrow('Invalid ID format')
    })

    it('rejects empty ID', async () => {
      const metadata = makeMetadata()
      await expect(createItem('', metadata, 'x')).rejects.toThrow('Invalid ID format')
    })
  })

  // ── getItem ───────────────────────────────────────────────────────

  describe('getItem', () => {
    it('reads metadata and post content for an existing item', async () => {
      const metadata = makeMetadata({ id: 'clip-youtube' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))  // metadata.json
        .mockResolvedValueOnce('Hello world')              // post.md
      mockFileExists.mockResolvedValue(false)               // no media.mp4

      const item = await getItem('clip-youtube')

      expect(item).not.toBeNull()
      expect(item!.id).toBe('clip-youtube')
      expect(item!.metadata.platform).toBe('youtube')
      expect(item!.postContent).toBe('Hello world')
      expect(item!.hasMedia).toBe(false)
    })

    it('returns null when metadata read fails', async () => {
      mockReadTextFile.mockRejectedValue(new Error('ENOENT'))

      const item = await getItem('nonexistent')
      expect(item).toBeNull()
    })

    it('rejects invalid ID format', async () => {
      await expect(getItem('../etc/passwd')).rejects.toThrow('Invalid ID format')
    })

    it('finds media.png when media.mp4 does not exist', async () => {
      const metadata = makeMetadata({ id: 'img-item' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Image post')
      mockFileExists
        .mockResolvedValueOnce(false)  // media.mp4 not found
        .mockResolvedValueOnce(true)   // media.png found

      const item = await getItem('img-item')

      expect(item).not.toBeNull()
      expect(item!.hasMedia).toBe(true)
      expect(item!.mediaPath).toContain('media.png')
    })

    it('prefers media.mp4 over media.png when both exist', async () => {
      const metadata = makeMetadata({ id: 'both-item' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Both media')
      mockFileExists.mockResolvedValueOnce(true)  // media.mp4 found (stops checking)

      const item = await getItem('both-item')

      expect(item).not.toBeNull()
      expect(item!.hasMedia).toBe(true)
      expect(item!.mediaPath).toContain('media.mp4')
    })

    it('preserves mediaType field in metadata', async () => {
      const metadata = makeMetadata({ id: 'typed-item', mediaType: 'image' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Typed post')
      mockFileExists.mockResolvedValue(false)

      const item = await getItem('typed-item')

      expect(item).not.toBeNull()
      expect(item!.metadata.mediaType).toBe('image')
    })
  })

  // ── getPendingItems ───────────────────────────────────────────────

  describe('getPendingItems', () => {
    it('returns empty array when queue directory is empty', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([])

      const items = await getPendingItems()
      expect(items).toEqual([])
    })

    it('reads all subdirectories as queue items', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([
        { name: 'item-a-youtube', isDirectory: () => true },
        { name: 'item-b-tiktok', isDirectory: () => true },
      ])
      // item-a metadata, post, media check
      const metaA = makeMetadata({ id: 'item-a-youtube', createdAt: '2026-01-15T10:00:00Z' })
      const metaB = makeMetadata({ id: 'item-b-tiktok', platform: 'tiktok', createdAt: '2026-01-15T09:00:00Z' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metaA))  // item-a metadata
        .mockResolvedValueOnce('Post A')                // item-a post
        .mockResolvedValueOnce(JSON.stringify(metaB))  // item-b metadata
        .mockResolvedValueOnce('Post B')                // item-b post
      mockFileExists.mockResolvedValue(false) // no media

      const items = await getPendingItems()
      expect(items).toHaveLength(2)
    })

    it('sorts items with media first, then by createdAt', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([
        { name: 'no-media', isDirectory: () => true },
        { name: 'has-media', isDirectory: () => true },
      ])

      const metaNoMedia = makeMetadata({ id: 'no-media', createdAt: '2026-01-01T00:00:00Z' })
      const metaHasMedia = makeMetadata({ id: 'has-media', createdAt: '2026-01-02T00:00:00Z' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metaNoMedia))
        .mockResolvedValueOnce('text post')
        .mockResolvedValueOnce(JSON.stringify(metaHasMedia))
        .mockResolvedValueOnce('media post')
      // readQueueItem checks media.mp4 then media.png for each item
      // no-media: mp4=false, png=false
      // has-media: mp4=true
      mockFileExists
        .mockResolvedValueOnce(false)  // no-media: media.mp4
        .mockResolvedValueOnce(false)  // no-media: media.png
        .mockResolvedValueOnce(true)   // has-media: media.mp4

      const items = await getPendingItems()
      expect(items[0].id).toBe('has-media')
      expect(items[1].id).toBe('no-media')
    })

    it('returns empty array when listDirectoryWithTypes throws', async () => {
      mockListDirectoryWithTypes.mockRejectedValue(new Error('ENOENT'))
      const items = await getPendingItems()
      expect(items).toEqual([])
    })
  })

  // ── getGroupedPendingItems ────────────────────────────────────────

  describe('getGroupedPendingItems', () => {
    it('groups items by sourceVideo and clip slug', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([
        { name: 'my-clip-youtube', isDirectory: () => true },
        { name: 'my-clip-tiktok', isDirectory: () => true },
        { name: 'other-clip-linkedin', isDirectory: () => true },
      ])

      const meta1 = makeMetadata({
        id: 'my-clip-youtube', platform: 'youtube',
        sourceVideo: '/rec/vid1', createdAt: '2026-01-15T10:00:00Z',
      })
      const meta2 = makeMetadata({
        id: 'my-clip-tiktok', platform: 'tiktok',
        sourceVideo: '/rec/vid1', createdAt: '2026-01-15T11:00:00Z',
      })
      const meta3 = makeMetadata({
        id: 'other-clip-linkedin', platform: 'linkedin',
        sourceVideo: '/rec/vid1', createdAt: '2026-01-15T12:00:00Z',
      })

      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(meta1)).mockResolvedValueOnce('Post 1')
        .mockResolvedValueOnce(JSON.stringify(meta2)).mockResolvedValueOnce('Post 2')
        .mockResolvedValueOnce(JSON.stringify(meta3)).mockResolvedValueOnce('Post 3')
      mockFileExists.mockResolvedValue(false)

      const groups = await getGroupedPendingItems()
      // my-clip-youtube and my-clip-tiktok share the same clip slug "my-clip"
      const myClipGroup = groups.find(g => g.items.some(i => i.id === 'my-clip-youtube'))
      expect(myClipGroup).toBeDefined()
      expect(myClipGroup!.items).toHaveLength(2)

      const otherGroup = groups.find(g => g.items.some(i => i.id === 'other-clip-linkedin'))
      expect(otherGroup).toBeDefined()
      expect(otherGroup!.items).toHaveLength(1)
    })

    it('returns empty array when no pending items', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([])
      const groups = await getGroupedPendingItems()
      expect(groups).toEqual([])
    })
  })

  // ── approveItem ───────────────────────────────────────────────────

  describe('approveItem', () => {
    it('updates metadata to published and moves to published dir', async () => {
      const metadata = makeMetadata({ id: 'clip-youtube', status: 'pending_review' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Post content')
      mockFileExists.mockResolvedValue(false)

      await approveItem('clip-youtube', {
        latePostId: 'late-123',
        scheduledFor: '2026-02-01T19:00:00Z',
        publishedUrl: 'https://youtube.com/watch?v=abc',
      })

      // Should write updated metadata
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('metadata.json'),
        expect.stringContaining('"published"'),
      )
      // Should move folder to published dir
      expect(mockRenameFile).toHaveBeenCalled()
    })

    it('falls back to copy+delete on EPERM rename error (Windows)', async () => {
      const metadata = makeMetadata({ id: 'clip-tiktok' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Post')
      mockFileExists.mockResolvedValue(false)

      const epermError = new Error('EPERM') as NodeJS.ErrnoException
      epermError.code = 'EPERM'
      mockRenameFile.mockRejectedValue(epermError)

      await approveItem('clip-tiktok', {
        latePostId: 'late-456',
        scheduledFor: '2026-02-01T19:00:00Z',
      })

      expect(mockCopyDirectory).toHaveBeenCalled()
      expect(mockRemoveDirectory).toHaveBeenCalled()
    })

    it('does nothing when item does not exist', async () => {
      mockReadTextFile.mockRejectedValue(new Error('ENOENT'))

      await approveItem('nonexistent', {
        latePostId: 'late-789',
        scheduledFor: '2026-02-01T19:00:00Z',
      })

      expect(mockWriteTextFile).not.toHaveBeenCalled()
      expect(mockRenameFile).not.toHaveBeenCalled()
    })

    it('rejects invalid ID format', async () => {
      await expect(
        approveItem('../bad', { latePostId: 'x', scheduledFor: 'y' }),
      ).rejects.toThrow('Invalid ID format')
    })
  })

  // ── rejectItem ────────────────────────────────────────────────────

  describe('rejectItem', () => {
    it('removes the queue item directory', async () => {
      await rejectItem('clip-instagram')
      expect(mockRemoveDirectory).toHaveBeenCalledWith(
        expect.stringContaining('clip-instagram'),
        { recursive: true },
      )
    })

    it('does not throw when removeDirectory fails', async () => {
      mockRemoveDirectory.mockRejectedValue(new Error('ENOENT'))
      await expect(rejectItem('missing-item')).resolves.toBeUndefined()
    })

    it('rejects invalid ID format', async () => {
      await expect(rejectItem('../../etc')).rejects.toThrow('Invalid ID format')
    })
  })

  // ── approveBulk ───────────────────────────────────────────────────

  describe('approveBulk', () => {
    it('approves multiple items and returns results', async () => {
      const meta1 = makeMetadata({ id: 'item-a-youtube' })
      const meta2 = makeMetadata({ id: 'item-b-tiktok' })

      // First getItem call (for item-a)
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(meta1))
        .mockResolvedValueOnce('Post A')
      // Second getItem call in approveItem for item-a (re-reads)
        .mockResolvedValueOnce(JSON.stringify(meta1))
        .mockResolvedValueOnce('Post A')
      // First getItem call (for item-b)
        .mockResolvedValueOnce(JSON.stringify(meta2))
        .mockResolvedValueOnce('Post B')
      // Second getItem call in approveItem for item-b (re-reads)
        .mockResolvedValueOnce(JSON.stringify(meta2))
        .mockResolvedValueOnce('Post B')

      mockFileExists.mockResolvedValue(false)

      const publishData = new Map([
        ['item-a-youtube', { latePostId: 'l1', scheduledFor: '2026-02-01T19:00:00Z' }],
        ['item-b-tiktok', { latePostId: 'l2', scheduledFor: '2026-02-01T20:00:00Z' }],
      ])

      const results = await approveBulk(['item-a-youtube', 'item-b-tiktok'], publishData)
      expect(results).toHaveLength(2)
      expect(results[0].itemId).toBe('item-a-youtube')
      expect(results[1].itemId).toBe('item-b-tiktok')
    })

    it('skips items with no publish data', async () => {
      const publishData = new Map<string, { latePostId: string; scheduledFor: string }>()
      const results = await approveBulk(['no-data-item'], publishData)
      expect(results).toHaveLength(0)
    })

    it('continues processing after individual item failures', async () => {
      // First item will fail due to invalid ID format (path traversal characters)
      // Second item works
      const meta = makeMetadata({ id: 'good-item-youtube' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(meta))
        .mockResolvedValueOnce('Post')
      mockFileExists.mockResolvedValue(false)

      const publishData = new Map([
        ['../bad-item', { latePostId: 'l1', scheduledFor: '2026-02-01T19:00:00Z' }],
        ['good-item-youtube', { latePostId: 'l2', scheduledFor: '2026-02-01T20:00:00Z' }],
      ])

      const results = await approveBulk(['../bad-item', 'good-item-youtube'], publishData)
      // Only the successful one appears in results
      expect(results).toHaveLength(1)
      expect(results[0].itemId).toBe('good-item-youtube')
    })
  })

  // ── updateItem ────────────────────────────────────────────────────

  describe('updateItem', () => {
    it('updates post content for an existing item', async () => {
      const metadata = makeMetadata({ id: 'clip-youtube' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Old content')
      mockFileExists.mockResolvedValue(false)

      const updated = await updateItem('clip-youtube', { postContent: 'New content' })

      expect(updated).not.toBeNull()
      expect(updated!.postContent).toBe('New content')
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('post.md'),
        'New content',
      )
    })

    it('updates metadata fields while preserving immutable fields', async () => {
      const metadata = makeMetadata({
        id: 'clip-youtube',
        platform: 'youtube',
        hashtags: ['#old'],
        scheduledFor: null,
      })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Post')
      mockFileExists.mockResolvedValue(false)

      const updated = await updateItem('clip-youtube', {
        metadata: {
          hashtags: ['#new', '#tags'],
          scheduledFor: '2026-03-01T10:00:00Z',
        },
      })

      expect(updated).not.toBeNull()
      expect(updated!.metadata.hashtags).toEqual(['#new', '#tags'])
      expect(updated!.metadata.scheduledFor).toBe('2026-03-01T10:00:00Z')
      // Immutable fields should be preserved
      expect(updated!.metadata.id).toBe('clip-youtube')
      expect(updated!.metadata.sourceVideo).toBe('/recordings/my-video')
      expect(updated!.metadata.createdAt).toBe('2026-01-15T10:00:00Z')
    })

    it('returns null when item does not exist', async () => {
      mockReadTextFile.mockRejectedValue(new Error('ENOENT'))
      const result = await updateItem('nonexistent', { postContent: 'x' })
      expect(result).toBeNull()
    })

    it('rejects invalid ID format', async () => {
      await expect(updateItem('../../bad', { postContent: 'x' })).rejects.toThrow('Invalid ID format')
    })
  })

  // ── itemExists ────────────────────────────────────────────────────

  describe('itemExists', () => {
    it('returns "pending" when item exists in queue dir', async () => {
      mockFileExists
        .mockResolvedValueOnce(true)  // queue dir check

      const result = await itemExists('clip-youtube')
      expect(result).toBe('pending')
    })

    it('returns "published" when item exists only in published dir', async () => {
      mockFileExists
        .mockResolvedValueOnce(false) // queue dir check
        .mockResolvedValueOnce(true)  // published dir check

      const result = await itemExists('clip-youtube')
      expect(result).toBe('published')
    })

    it('returns null when item does not exist anywhere', async () => {
      mockFileExists.mockResolvedValue(false)
      const result = await itemExists('nonexistent')
      expect(result).toBeNull()
    })

    it('rejects invalid ID format', async () => {
      await expect(itemExists('../bad')).rejects.toThrow('Invalid ID format')
    })
  })

  // ── getPublishedItems ─────────────────────────────────────────────

  describe('getPublishedItems', () => {
    it('reads from published directory', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([
        { name: 'published-item', isDirectory: () => true },
      ])
      const metadata = makeMetadata({ id: 'published-item', status: 'published' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce('Published post')
      mockFileExists.mockResolvedValue(false)

      const items = await getPublishedItems()
      expect(items).toHaveLength(1)
      expect(items[0].id).toBe('published-item')
    })

    it('returns empty array when published directory is empty', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([])
      const items = await getPublishedItems()
      expect(items).toEqual([])
    })

    it('returns empty array when listDirectoryWithTypes throws', async () => {
      mockListDirectoryWithTypes.mockRejectedValue(new Error('ENOENT'))
      const items = await getPublishedItems()
      expect(items).toEqual([])
    })

    it('sorts published items by createdAt', async () => {
      mockListDirectoryWithTypes.mockResolvedValue([
        { name: 'later', isDirectory: () => true },
        { name: 'earlier', isDirectory: () => true },
      ])
      const metaLater = makeMetadata({ id: 'later', createdAt: '2026-02-01T10:00:00Z' })
      const metaEarlier = makeMetadata({ id: 'earlier', createdAt: '2026-01-01T10:00:00Z' })
      mockReadTextFile
        .mockResolvedValueOnce(JSON.stringify(metaLater))
        .mockResolvedValueOnce('Post later')
        .mockResolvedValueOnce(JSON.stringify(metaEarlier))
        .mockResolvedValueOnce('Post earlier')
      mockFileExists.mockResolvedValue(false)

      const items = await getPublishedItems()
      expect(items[0].id).toBe('earlier')
      expect(items[1].id).toBe('later')
    })
  })
})

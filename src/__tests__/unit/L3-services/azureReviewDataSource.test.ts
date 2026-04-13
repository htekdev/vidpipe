import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'node:stream'

const mockGetContentItems = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockGetContentItem = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const mockUpdateContentStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockDownloadStream = vi.hoisted(() => vi.fn())
const mockUploadBuffer = vi.hoisted(() => vi.fn().mockResolvedValue('https://blob.url'))
const mockDownloadToBuffer = vi.hoisted(() => vi.fn())
const mockDownloadToFileFn = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  getContentItems: mockGetContentItems,
  getContentItem: mockGetContentItem,
  updateContentStatus: mockUpdateContentStatus,
}))

vi.mock('../../../L2-clients/azure/blobClient.js', () => ({
  downloadStream: mockDownloadStream,
  uploadBuffer: mockUploadBuffer,
  downloadToBuffer: mockDownloadToBuffer,
  downloadToFile: mockDownloadToFileFn,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  listPendingItems,
  getGroupedItems,
  getItemById,
  getMediaStream,
  approveItem,
  rejectItem,
  updateItem,
  markPublished,
  getPostContent,
  downloadMediaToFile,
} from '../../../L3-services/azureStorage/azureReviewDataSource.js'

function makeContentRecord(overrides: Record<string, unknown> = {}) {
  return {
    partitionKey: 'my-video',
    rowKey: 'item-1',
    platform: 'youtube',
    clipType: 'short',
    status: 'pending_review',
    blobBasePath: 'content/item-1/',
    mediaType: 'video',
    mediaFilename: 'media.mp4',
    postContent: 'Hello world',
    hashtags: 'dev,coding',
    characterCount: 11,
    scheduledFor: '',
    latePostId: '',
    publishedUrl: '',
    sourceVideoRunId: 'run-1',
    thumbnailFilename: 'thumbnail.png',
    ideaIds: 'idea-1,idea-2',
    createdAt: '2026-01-01T00:00:00Z',
    reviewedAt: '',
    publishedAt: '',
    ...overrides,
  }
}

describe('L3 Unit: Azure Review Data Source', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listPendingItems', () => {
    test('returns mapped review items from pending content records', async () => {
      mockGetContentItems.mockResolvedValueOnce([makeContentRecord()])

      const items = await listPendingItems()

      expect(items).toHaveLength(1)
      expect(items[0]).toEqual(expect.objectContaining({
        id: 'item-1',
        videoSlug: 'my-video',
        platform: 'youtube',
        clipType: 'short',
        status: 'pending_review',
        mediaUrl: '/api/media/item-1/media.mp4',
        postContent: 'Hello world',
        hashtags: ['dev', 'coding'],
        thumbnailUrl: '/api/media/item-1/thumbnail.png',
        ideaIds: ['idea-1', 'idea-2'],
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        blobBasePath: 'content/item-1/',
      }))
      expect(mockGetContentItems).toHaveBeenCalledWith({ status: 'pending_review' })
    })

    test('returns empty array when no pending items', async () => {
      mockGetContentItems.mockResolvedValueOnce([])
      const items = await listPendingItems()
      expect(items).toEqual([])
    })

    test('handles records with empty optional fields', async () => {
      const record = makeContentRecord({
        mediaFilename: '',
        thumbnailFilename: '',
        hashtags: '',
        ideaIds: '',
        scheduledFor: '',
        latePostId: '',
        publishedUrl: '',
        postContent: '',
      })
      mockGetContentItems.mockResolvedValueOnce([record])

      const items = await listPendingItems()

      expect(items[0].mediaUrl).toBe('')
      expect(items[0].thumbnailUrl).toBeNull()
      expect(items[0].hashtags).toEqual([])
      expect(items[0].ideaIds).toEqual([])
      expect(items[0].scheduledFor).toBeNull()
      expect(items[0].latePostId).toBeNull()
      expect(items[0].publishedUrl).toBeNull()
    })
  })

  describe('getGroupedItems', () => {
    test('groups platform variants of the same clip into one group', async () => {
      mockGetContentItems.mockResolvedValueOnce([
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'my-clip-youtube', platform: 'youtube' }),
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'my-clip-instagram', platform: 'instagram' }),
        makeContentRecord({ partitionKey: 'video-b', rowKey: 'other-clip-tiktok', platform: 'tiktok' }),
      ])

      const groups = await getGroupedItems()

      expect(groups).toHaveLength(2)
      // First group should have both youtube and instagram variants
      const clipGroup = groups.find(g => g.items.length === 2)
      expect(clipGroup).toBeDefined()
      expect(clipGroup!.items.map(i => i.platform).sort()).toEqual(['instagram', 'youtube'])
    })

    test('includes clipType in each group', async () => {
      mockGetContentItems.mockResolvedValueOnce([
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'clip-youtube', platform: 'youtube', clipType: 'short' }),
      ])

      const groups = await getGroupedItems()

      expect(groups).toHaveLength(1)
      expect(groups[0].clipType).toBe('short')
    })

    test('sorts groups with media before text-only', async () => {
      mockGetContentItems.mockResolvedValueOnce([
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'text-only-youtube', platform: 'youtube', mediaFilename: '' }),
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'has-media-tiktok', platform: 'tiktok', mediaFilename: 'clip.mp4' }),
      ])

      const groups = await getGroupedItems()

      expect(groups).toHaveLength(2)
      // Media group should come first
      const firstGroupHasMedia = groups[0].items.some(i => Boolean(i.mediaFilename))
      expect(firstGroupHasMedia).toBe(true)
    })

    test('returns empty array when no items', async () => {
      mockGetContentItems.mockResolvedValueOnce([])
      const groups = await getGroupedItems()
      expect(groups).toEqual([])
    })

    test('groups items with twitter platform suffix correctly', async () => {
      mockGetContentItems.mockResolvedValueOnce([
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'clip-twitter', platform: 'twitter' }),
        makeContentRecord({ partitionKey: 'video-a', rowKey: 'clip-youtube', platform: 'youtube' }),
      ])
      const groups = await getGroupedItems()
      expect(groups).toHaveLength(1)
      expect(groups[0].items).toHaveLength(2)
    })
  })

  describe('getItemById', () => {
    test('returns mapped review item when found', async () => {
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord())

      const item = await getItemById('my-video', 'item-1')

      expect(item).not.toBeNull()
      expect(item!.id).toBe('item-1')
      expect(item!.videoSlug).toBe('my-video')
      expect(item!.platform).toBe('youtube')
      expect(mockGetContentItem).toHaveBeenCalledWith('my-video', 'item-1')
    })

    test('returns null when item not found', async () => {
      mockGetContentItem.mockResolvedValueOnce(null)
      const item = await getItemById('my-video', 'nonexistent')
      expect(item).toBeNull()
    })
  })

  describe('getMediaStream', () => {
    test('returns stream and content type for mp4', async () => {
      const fakeStream = Readable.from(['data'])
      mockDownloadStream.mockResolvedValueOnce(fakeStream)

      const result = await getMediaStream('item-1', 'media.mp4')

      expect(result.stream).toBe(fakeStream)
      expect(result.contentType).toBe('video/mp4')
      expect(mockDownloadStream).toHaveBeenCalledWith('content/item-1/media.mp4')
    })

    test('returns correct content type for png', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'thumbnail.png')
      expect(result.contentType).toBe('image/png')
    })

    test('returns correct content type for jpg', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'photo.jpg')
      expect(result.contentType).toBe('image/jpeg')
    })

    test('returns correct content type for jpeg', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'photo.jpeg')
      expect(result.contentType).toBe('image/jpeg')
    })

    test('returns correct content type for webm', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'clip.webm')
      expect(result.contentType).toBe('video/webm')
    })

    test('returns correct content type for gif', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'anim.gif')
      expect(result.contentType).toBe('image/gif')
    })

    test('returns correct content type for webp', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'img.webp')
      expect(result.contentType).toBe('image/webp')
    })

    test('returns correct content type for md', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'post.md')
      expect(result.contentType).toBe('text/markdown')
    })

    test('returns correct content type for json', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'data.json')
      expect(result.contentType).toBe('application/json')
    })

    test('returns octet-stream for unknown extensions', async () => {
      mockDownloadStream.mockResolvedValueOnce(Readable.from(['data']))
      const result = await getMediaStream('item-1', 'file.xyz')
      expect(result.contentType).toBe('application/octet-stream')
    })
  })

  describe('approveItem', () => {
    test('updates content status to approved with reviewedAt', async () => {
      await approveItem('my-video', 'item-1')

      expect(mockUpdateContentStatus).toHaveBeenCalledWith(
        'my-video',
        'item-1',
        'approved',
        expect.objectContaining({ reviewedAt: expect.any(String) }),
      )
    })
  })

  describe('rejectItem', () => {
    test('updates content status to rejected', async () => {
      await rejectItem('my-video', 'item-1')

      expect(mockUpdateContentStatus).toHaveBeenCalledWith('my-video', 'item-1', 'rejected')
    })
  })

  describe('markPublished', () => {
    test('updates content status to published with publish data', async () => {
      await markPublished('my-video', 'item-1', {
        latePostId: 'late-123',
        scheduledFor: '2026-02-15T19:00:00Z',
        publishedUrl: 'https://example.com/post',
      })

      expect(mockUpdateContentStatus).toHaveBeenCalledWith(
        'my-video',
        'item-1',
        'published',
        expect.objectContaining({
          latePostId: 'late-123',
          scheduledFor: '2026-02-15T19:00:00Z',
          publishedUrl: 'https://example.com/post',
          publishedAt: expect.any(String),
        }),
      )
    })

    test('uses empty string for missing publishedUrl', async () => {
      await markPublished('my-video', 'item-1', {
        latePostId: 'late-456',
        scheduledFor: '2026-02-15T19:00:00Z',
      })

      expect(mockUpdateContentStatus).toHaveBeenCalledWith(
        'my-video',
        'item-1',
        'published',
        expect.objectContaining({
          publishedUrl: '',
        }),
      )
    })
  })

  describe('updateItem', () => {
    test('updates post content and re-uploads blob', async () => {
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord()) // first call (read existing)
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord({ postContent: 'Updated!' })) // second call (return updated)

      const result = await updateItem('my-video', 'item-1', { postContent: 'Updated!' })

      expect(result).not.toBeNull()
      expect(mockUploadBuffer).toHaveBeenCalledWith(
        'content/item-1/post.md',
        expect.any(Buffer),
        'text/markdown',
      )
      expect(mockUpdateContentStatus).toHaveBeenCalledWith(
        'my-video',
        'item-1',
        'pending_review',
        expect.objectContaining({
          postContent: 'Updated!',
          characterCount: 8,
        }),
      )
    })

    test('returns null when item not found', async () => {
      mockGetContentItem.mockResolvedValueOnce(null)

      const result = await updateItem('my-video', 'nonexistent', { postContent: 'test' })

      expect(result).toBeNull()
      expect(mockUploadBuffer).not.toHaveBeenCalled()
    })

    test('returns null when updated item not found after save', async () => {
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord()) // first call
      mockGetContentItem.mockResolvedValueOnce(null) // second call returns null

      const result = await updateItem('my-video', 'item-1', { postContent: 'Updated!' })

      expect(result).toBeNull()
    })

    test('skips update when no changes provided', async () => {
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord()) // first call
      mockGetContentItem.mockResolvedValueOnce(makeContentRecord()) // second call

      const result = await updateItem('my-video', 'item-1', {})

      expect(result).not.toBeNull()
      expect(mockUploadBuffer).not.toHaveBeenCalled()
      expect(mockUpdateContentStatus).not.toHaveBeenCalled()
    })
  })

  describe('getPostContent', () => {
    test('returns post content from blob', async () => {
      mockDownloadToBuffer.mockResolvedValueOnce(Buffer.from('My post content'))

      const content = await getPostContent('item-1')

      expect(content).toBe('My post content')
      expect(mockDownloadToBuffer).toHaveBeenCalledWith('content/item-1/post.md')
    })

    test('returns empty string when no post.md found', async () => {
      mockDownloadToBuffer.mockRejectedValueOnce(new Error('BlobNotFound'))

      const content = await getPostContent('item-1')

      expect(content).toBe('')
    })
  })

  describe('downloadMediaToFile', () => {
    test('downloads blob to local file', async () => {
      await downloadMediaToFile('item-1', 'media.mp4', '/local/media.mp4')

      expect(mockDownloadToFileFn).toHaveBeenCalledWith('content/item-1/media.mp4', '/local/media.mp4')
    })
  })
})

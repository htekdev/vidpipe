import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockUploadFile = vi.hoisted(() => vi.fn().mockResolvedValue('https://blob.url'))
const mockIsAzureConfigured = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockDownloadStream = vi.hoisted(() => vi.fn())
const mockDownloadToFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpsertEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockQueryEntities = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockGetEntity = vi.hoisted(() => vi.fn().mockResolvedValue(null))
const mockUpdateEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockReaddir = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
}))

vi.mock('../../../L2-clients/azure/blobClient.js', () => ({
  uploadFile: mockUploadFile,
  isAzureConfigured: mockIsAzureConfigured,
  downloadStream: mockDownloadStream,
  downloadToFile: mockDownloadToFile,
}))

vi.mock('../../../L2-clients/azure/tableClient.js', () => ({
  upsertEntity: mockUpsertEntity,
  queryEntities: mockQueryEntities,
  getEntity: mockGetEntity,
  updateEntity: mockUpdateEntity,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
    AZURE_STORAGE_ACCOUNT_KEY: 'testkey',
    AZURE_CONTAINER_NAME: 'vidpipe',
  }),
}))

import {
  isAzureConfigured,
  getRunId,
  uploadRawVideo,
  updateContentStatus,
  getContentItems,
  uploadContentItem,
  uploadPublishQueue,
  migrateLocalContent,
  getContentItem,
  listVideos,
  getVideoRecord,
  downloadContentMedia,
  uploadVideoFile,
  downloadBlobToFile,
} from '../../../L3-services/azureStorage/azureStorageService.js'

describe('L3 Unit: Azure Storage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('isAzureConfigured delegates to blob client', () => {
    expect(isAzureConfigured()).toBe(true)
    expect(mockIsAzureConfigured).toHaveBeenCalled()
  })

  test('getRunId returns GITHUB_RUN_ID when set', () => {
    vi.stubEnv('GITHUB_RUN_ID', '12345')
    expect(getRunId()).toBe('12345')
    vi.unstubAllEnvs()
  })

  test('getRunId returns UUID when GITHUB_RUN_ID not set', () => {
    vi.stubEnv('GITHUB_RUN_ID', '')
    const id = getRunId()
    expect(id).toBeTruthy()
    expect(id).not.toBe('')
    vi.unstubAllEnvs()
  })

  test('uploadRawVideo uploads file and creates table record', async () => {
    const blobPath = await uploadRawVideo('/videos/video.mp4', 'run-123', {
      originalFilename: 'video.mp4',
      slug: 'my-video',
      size: 1024000,
    })

    expect(blobPath).toBe('raw/run-123-video.mp4')
    expect(mockUploadFile).toHaveBeenCalledWith('raw/run-123-video.mp4', '/videos/video.mp4', 'video/mp4')
    expect(mockUpsertEntity).toHaveBeenCalledWith('Videos', 'video', 'run-123', expect.objectContaining({
      originalFilename: 'video.mp4',
      slug: 'my-video',
      status: 'completed',
    }))
  })

  test('updateContentStatus updates table entity', async () => {
    await updateContentStatus('my-video', 'my-video-youtube', 'approved', { reviewedAt: '2026-01-01' })
    expect(mockUpdateEntity).toHaveBeenCalledWith('Content', 'my-video', 'my-video-youtube', {
      status: 'approved',
      reviewedAt: '2026-01-01',
    })
  })

  test('getContentItems queries with filters', async () => {
    await getContentItems({ videoSlug: 'my-video', status: 'pending_review' })
    expect(mockQueryEntities).toHaveBeenCalledWith('Content', "PartitionKey eq 'my-video' and status eq 'pending_review'")
  })

  test('getContentItems queries with no filters', async () => {
    await getContentItems()
    expect(mockQueryEntities).toHaveBeenCalledWith('Content', '')
  })

  test('getContentItems queries with only videoSlug', async () => {
    await getContentItems({ videoSlug: 'slug-1' })
    expect(mockQueryEntities).toHaveBeenCalledWith('Content', "PartitionKey eq 'slug-1'")
  })

  test('getContentItems queries with only status', async () => {
    await getContentItems({ status: 'approved' })
    expect(mockQueryEntities).toHaveBeenCalledWith('Content', "status eq 'approved'")
  })

  // uploadVideoFile
  test('uploadVideoFile uploads file to blob storage', async () => {
    const result = await uploadVideoFile('/local/video.mp4', 'raw/run-1-video.mp4')
    expect(mockUploadFile).toHaveBeenCalledWith('raw/run-1-video.mp4', '/local/video.mp4', 'video/mp4')
    expect(result).toBe('https://blob.url')
  })

  // downloadBlobToFile
  test('downloadBlobToFile delegates to blob client', async () => {
    await downloadBlobToFile('raw/run-1-video.mp4', '/local/output.mp4')
    expect(mockDownloadToFile).toHaveBeenCalledWith('raw/run-1-video.mp4', '/local/output.mp4')
  })

  // getContentItem
  test('getContentItem returns entity from table', async () => {
    const entity = { partitionKey: 'slug', rowKey: 'item-1', platform: 'youtube' }
    mockGetEntity.mockResolvedValueOnce(entity)
    const result = await getContentItem('slug', 'item-1')
    expect(result).toEqual(entity)
    expect(mockGetEntity).toHaveBeenCalledWith('Content', 'slug', 'item-1')
  })

  test('getContentItem returns null when not found', async () => {
    mockGetEntity.mockResolvedValueOnce(null)
    const result = await getContentItem('slug', 'nonexistent')
    expect(result).toBeNull()
  })

  // listVideos
  test('listVideos queries with status filter', async () => {
    mockQueryEntities.mockResolvedValueOnce([])
    const result = await listVideos('completed')
    expect(result).toEqual([])
    expect(mockQueryEntities).toHaveBeenCalledWith('Videos', "PartitionKey eq 'video' and status eq 'completed'")
  })

  test('listVideos queries without status filter', async () => {
    mockQueryEntities.mockResolvedValueOnce([])
    const result = await listVideos()
    expect(result).toEqual([])
    expect(mockQueryEntities).toHaveBeenCalledWith('Videos', "PartitionKey eq 'video'")
  })

  // getVideoRecord
  test('getVideoRecord gets entity from Videos table', async () => {
    const record = { partitionKey: 'video', rowKey: 'run-1', slug: 'test' }
    mockGetEntity.mockResolvedValueOnce(record)
    const result = await getVideoRecord('run-1')
    expect(result).toEqual(record)
    expect(mockGetEntity).toHaveBeenCalledWith('Videos', 'video', 'run-1')
  })

  // downloadContentMedia
  test('downloadContentMedia delegates to blob client downloadStream', async () => {
    const mockStream = { pipe: vi.fn() }
    mockDownloadStream.mockResolvedValueOnce(mockStream)
    const result = await downloadContentMedia('content/item-1/media.mp4')
    expect(result).toBe(mockStream)
    expect(mockDownloadStream).toHaveBeenCalledWith('content/item-1/media.mp4')
  })

  // uploadContentItem
  describe('uploadContentItem', () => {
    test('uploads files and creates table record with metadata.json', async () => {
      mockReaddir.mockResolvedValueOnce(['media.mp4', 'thumbnail.png', 'metadata.json', 'post.md'])
      mockReadFile
        .mockImplementation((path: string) => {
          if (path.includes('metadata.json')) {
            return Promise.resolve(JSON.stringify({
              platform: 'youtube',
              clipType: 'short',
              hashtags: ['dev', 'coding'],
              ideaIds: ['idea-1'],
            }))
          }
          if (path.includes('post.md')) {
            return Promise.resolve('Check out this video!')
          }
          return Promise.reject(new Error('not found'))
        })

      const result = await uploadContentItem('/items/item-1', 'item-1', 'my-video', 'run-1')

      expect(result).toBe('content/item-1/')
      // Uploads 4 files
      expect(mockUploadFile).toHaveBeenCalledTimes(4)
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-1/media.mp4', expect.any(String), 'video/mp4')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-1/thumbnail.png', expect.any(String), 'image/png')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-1/metadata.json', expect.any(String), 'application/json')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-1/post.md', expect.any(String), 'text/markdown')
      // Table record created with metadata.json values
      expect(mockUpsertEntity).toHaveBeenCalledWith('Content', 'my-video', 'item-1', expect.objectContaining({
        platform: 'youtube',
        clipType: 'short',
        status: 'pending_review',
        mediaFilename: 'media.mp4',
        thumbnailFilename: 'thumbnail.png',
        postContent: 'Check out this video!',
        hashtags: 'dev,coding',
        ideaIds: 'idea-1',
      }))
      // Log message confirms blob + table record
      const { default: logger } = await import('../../../L1-infra/logger/configLogger.js')
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('blob + table record'))
    })

    test('handles missing metadata.json and post.md', async () => {
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const result = await uploadContentItem('/items/item-2', 'item-2', 'my-video', 'run-1', {
        platform: 'tiktok',
        clipType: 'short',
      })

      expect(result).toBe('content/item-2/')
      expect(mockUpsertEntity).toHaveBeenCalledWith('Content', 'my-video', 'item-2', expect.objectContaining({
        platform: 'tiktok',
        clipType: 'short',
        postContent: '',
        mediaFilename: 'media.mp4',
      }))
    })

    test('getContentType maps file extensions correctly', async () => {
      mockReaddir.mockResolvedValueOnce(['media.jpg', 'captions.srt', 'data.json', 'readme.md', 'unknown.xyz'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      await uploadContentItem('/items/item-3', 'item-3', 'slug', 'run-1')

      expect(mockUploadFile).toHaveBeenCalledWith('content/item-3/media.jpg', expect.any(String), 'image/jpeg')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-3/captions.srt', expect.any(String), 'text/plain')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-3/data.json', expect.any(String), 'application/json')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-3/readme.md', expect.any(String), 'text/markdown')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-3/unknown.xyz', expect.any(String), 'application/octet-stream')
    })

    test('getContentType handles jpeg extension', async () => {
      mockReaddir.mockResolvedValueOnce(['photo.jpeg'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      await uploadContentItem('/items/item-4', 'item-4', 'slug', 'run-1')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-4/photo.jpeg', expect.any(String), 'image/jpeg')
    })

    test('getContentType handles vtt and ass extensions', async () => {
      mockReaddir.mockResolvedValueOnce(['sub.vtt', 'sub.ass'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      await uploadContentItem('/items/item-5', 'item-5', 'slug', 'run-1')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-5/sub.vtt', expect.any(String), 'text/plain')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-5/sub.ass', expect.any(String), 'text/plain')
    })

    test('getContentType handles png extension', async () => {
      mockReaddir.mockResolvedValueOnce(['image.png'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      await uploadContentItem('/items/item-6', 'item-6', 'slug', 'run-1')
      expect(mockUploadFile).toHaveBeenCalledWith('content/item-6/image.png', expect.any(String), 'image/png')
    })
  })

  // uploadPublishQueue
  describe('uploadPublishQueue', () => {
    test('uploads all items and updates video record', async () => {
      mockReaddir.mockResolvedValueOnce(['item-a', 'item-b'])
      // For each uploadContentItem call, readdir/readFile will be called again
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockResolvedValueOnce(['media.mp4'])

      const result = await uploadPublishQueue('/queue', 'my-video', 'run-1')

      expect(result.uploaded).toBe(2)
      expect(result.errors).toHaveLength(0)
      expect(mockUpdateEntity).toHaveBeenCalledWith('Videos', 'video', 'run-1', { contentCount: 2 })
    })

    test('handles missing publish queue directory', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))

      const result = await uploadPublishQueue('/missing-dir', 'my-video', 'run-1')

      expect(result.uploaded).toBe(0)
      expect(result.errors).toEqual(['Publish queue directory not found'])
    })

    test('captures errors for individual items', async () => {
      mockReaddir.mockResolvedValueOnce(['item-good', 'item-bad'])
      // item-good succeeds
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      // item-bad fails
      mockReaddir.mockRejectedValueOnce(new Error('Permission denied'))

      const result = await uploadPublishQueue('/queue', 'my-video', 'run-1')

      expect(result.uploaded).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('item-bad')
      expect(result.errors[0]).toContain('Permission denied')
    })
  })

  // migrateLocalContent
  describe('migrateLocalContent', () => {
    test('migrates publish-queue and published directories', async () => {
      // First call: readdir('publish-queue')
      mockReaddir.mockResolvedValueOnce(['my-video-youtube', 'my-video-tiktok'])
      // uploadContentItem for my-video-youtube
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      // uploadContentItem for my-video-tiktok
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      // Second call: readdir('published')
      mockReaddir.mockResolvedValueOnce(['old-video-linkedin'])
      // uploadContentItem for old-video-linkedin
      mockReaddir.mockResolvedValueOnce(['media.mp4'])

      const result = await migrateLocalContent('/output')

      expect(result.uploaded).toBe(3)
      expect(result.errors).toHaveLength(0)
    })

    test('handles missing publish-queue directory', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // publish-queue missing
      mockReaddir.mockResolvedValueOnce(['item-1']) // published exists
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      const result = await migrateLocalContent('/output')

      expect(result.uploaded).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    test('handles missing published directory', async () => {
      mockReaddir.mockResolvedValueOnce(['item-1']) // publish-queue exists
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // published missing

      const result = await migrateLocalContent('/output')

      expect(result.uploaded).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    test('captures errors for individual migration items', async () => {
      mockReaddir.mockResolvedValueOnce(['my-video-youtube']) // publish-queue
      mockReaddir.mockRejectedValueOnce(new Error('Disk error')) // uploadContentItem fails
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // published missing

      const result = await migrateLocalContent('/output')

      expect(result.uploaded).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('publish-queue/my-video-youtube')
    })

    test('extractVideoSlug strips known platform suffixes', async () => {
      // Test that extractVideoSlug works by verifying the partition key used
      mockReaddir.mockResolvedValueOnce(['my-cool-video-youtube']) // publish-queue
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // published

      await migrateLocalContent('/output')

      // The partition key passed to upsertEntity should be the slug with platform stripped
      expect(mockUpsertEntity).toHaveBeenCalledWith(
        'Content',
        'my-cool-video', // youtube stripped
        'my-cool-video-youtube',
        expect.objectContaining({ status: 'pending_review' }),
      )
    })

    test('extractVideoSlug strips compound platform suffixes', async () => {
      mockReaddir.mockResolvedValueOnce(['my-cool-video-instagram-reels']) // publish-queue
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // published

      await migrateLocalContent('/output')

      expect(mockUpsertEntity).toHaveBeenCalledWith(
        'Content',
        'my-cool-video', // instagram-reels stripped
        'my-cool-video-instagram-reels',
        expect.objectContaining({ status: 'pending_review' }),
      )
    })

    test('extractVideoSlug returns full id when no platform suffix', async () => {
      mockReaddir.mockResolvedValueOnce(['unknown-item']) // publish-queue
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // published

      await migrateLocalContent('/output')

      expect(mockUpsertEntity).toHaveBeenCalledWith(
        'Content',
        'unknown-item', // no platform to strip
        'unknown-item',
        expect.any(Object),
      )
    })

    test('extractVideoSlug strips all simple platforms', async () => {
      const platforms = ['tiktok', 'instagram', 'linkedin', 'x']
      for (const platform of platforms) {
        vi.clearAllMocks()
        mockReaddir.mockResolvedValueOnce([`slug-${platform}`])
        mockReaddir.mockResolvedValueOnce(['media.mp4'])
        mockReadFile.mockRejectedValue(new Error('ENOENT'))
        mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))

        await migrateLocalContent('/output')

        expect(mockUpsertEntity).toHaveBeenCalledWith(
          'Content',
          'slug',
          `slug-${platform}`,
          expect.any(Object),
        )
      }
    })

    test('extractVideoSlug strips instagram-feed suffix', async () => {
      mockReaddir.mockResolvedValueOnce(['my-video-instagram-feed'])
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))

      await migrateLocalContent('/output')

      expect(mockUpsertEntity).toHaveBeenCalledWith(
        'Content',
        'my-video',
        'my-video-instagram-feed',
        expect.any(Object),
      )
    })

    test('published items use published status', async () => {
      mockReaddir.mockRejectedValueOnce(new Error('ENOENT')) // publish-queue missing
      mockReaddir.mockResolvedValueOnce(['my-video-youtube']) // published
      mockReaddir.mockResolvedValueOnce(['media.mp4'])
      mockReadFile.mockRejectedValue(new Error('ENOENT'))

      await migrateLocalContent('/output')

      expect(mockUpsertEntity).toHaveBeenCalledWith(
        'Content',
        'my-video',
        'my-video-youtube',
        expect.objectContaining({ status: 'published' }),
      )
    })
  })
})

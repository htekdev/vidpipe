import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockIsAzureConfigured = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockUploadRawVideo = vi.hoisted(() => vi.fn().mockResolvedValue('raw/123-video.mp4'))
const mockUploadPublishQueue = vi.hoisted(() => vi.fn().mockResolvedValue({ uploaded: 5, errors: [] }))
const mockGetRunId = vi.hoisted(() => vi.fn().mockReturnValue('test-run-id'))
const mockMigrateLocalContent = vi.hoisted(() => vi.fn().mockResolvedValue({ uploaded: 0, errors: [] }))
const mockPushConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ uploaded: 3 }))
const mockPullConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ downloaded: 3 }))

vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  isAzureConfigured: mockIsAzureConfigured,
  uploadRawVideo: mockUploadRawVideo,
  uploadPublishQueue: mockUploadPublishQueue,
  getRunId: mockGetRunId,
  migrateLocalContent: mockMigrateLocalContent,
}))

vi.mock('../../../L3-services/azureStorage/azureConfigService.js', () => ({
  pushConfig: mockPushConfig,
  pullConfig: mockPullConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  isCloudEnabled,
  uploadPipelineResults,
  pullConfig,
  pushConfig,
  migrateLocalContent,
} from '../../../L4-agents/cloudStorage/cloudStorageOperations.js'

describe('L4 Unit: Cloud Storage Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('isCloudEnabled returns true when Azure configured', () => {
    expect(isCloudEnabled()).toBe(true)
  })

  test('isCloudEnabled returns false when Azure not configured', () => {
    mockIsAzureConfigured.mockReturnValueOnce(false)
    expect(isCloudEnabled()).toBe(false)
  })

  test('uploadPipelineResults uploads video and queue', async () => {
    const result = await uploadPipelineResults('/videos/video.mp4', '/queue', 'my-video', {
      originalFilename: 'video.mp4',
      size: 1024,
    })

    expect(result.runId).toBe('test-run-id')
    expect(result.videoUploaded).toBe(true)
    expect(result.contentUploaded).toBe(5)
    expect(result.errors).toHaveLength(0)
    expect(mockUploadRawVideo).toHaveBeenCalled()
    expect(mockUploadPublishQueue).toHaveBeenCalled()
  })

  test('uploadPipelineResults handles video upload failure gracefully', async () => {
    mockUploadRawVideo.mockRejectedValueOnce(new Error('Upload failed'))

    const result = await uploadPipelineResults('/videos/video.mp4', '/queue', 'my-video', {
      originalFilename: 'video.mp4',
      size: 1024,
    })

    expect(result.videoUploaded).toBe(false)
    expect(result.contentUploaded).toBe(5)
    expect(mockUploadPublishQueue).toHaveBeenCalled()
  })

  test('pullConfig delegates to azureConfigService', async () => {
    const result = await pullConfig('/target')
    expect(result.downloaded).toBe(3)
    expect(mockPullConfig).toHaveBeenCalledWith('/target')
  })

  test('pushConfig delegates to azureConfigService', async () => {
    const result = await pushConfig('/source')
    expect(result.uploaded).toBe(3)
    expect(mockPushConfig).toHaveBeenCalledWith('/source')
  })

  test('migrateLocalContent delegates to azureStorageService', async () => {
    const result = await migrateLocalContent('/output')
    expect(result).toEqual({ uploaded: 0, errors: [] })
    expect(mockMigrateLocalContent).toHaveBeenCalledWith('/output')
  })
})

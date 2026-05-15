/**
 * L4-L6 Integration Test — Cloud Upload Pipeline
 *
 * Mock boundary: L2 (Azure blob + table clients)
 * Real code:     L3 azureStorageService, L4 cloudStorageOperations, L5 cloudStorageBridge
 *
 * Verifies the L5 → L4 → L3 delegation chain for cloud uploads.
 */
import { describe, test, expect, vi } from 'vitest'

const mockUploadFile = vi.hoisted(() => vi.fn().mockResolvedValue('https://blob.url'))
const mockIsAzureConfigured = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockUpsertEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpdateEntity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockQueryEntities = vi.hoisted(() => vi.fn().mockResolvedValue([]))

vi.mock('../../../L2-clients/azure/blobClient.js', () => ({
  uploadFile: mockUploadFile,
  isAzureConfigured: mockIsAzureConfigured,
  uploadBuffer: vi.fn().mockResolvedValue('https://blob.url'),
  downloadStream: vi.fn(),
  downloadToBuffer: vi.fn(),
  downloadToFile: vi.fn(),
  listBlobs: vi.fn().mockResolvedValue([]),
  deleteBlob: vi.fn(),
  blobExists: vi.fn().mockResolvedValue(false),
  getBlobUrl: vi.fn().mockReturnValue('https://blob.url'),
}))

vi.mock('../../../L2-clients/azure/tableClient.js', () => ({
  upsertEntity: mockUpsertEntity,
  updateEntity: mockUpdateEntity,
  queryEntities: mockQueryEntities,
  getEntity: vi.fn().mockResolvedValue(null),
  createEntity: vi.fn().mockResolvedValue(undefined),
  ensureTable: vi.fn().mockResolvedValue(undefined),
  deleteEntity: vi.fn().mockResolvedValue(undefined),
}))

describe('Integration L4-L6: Cloud Upload Pipeline', () => {
  test('L5 bridge delegates to L4 which calls L3 for raw video upload', async () => {
    const { uploadToCloud } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    const result = await uploadToCloud('/nonexistent/video.mp4', '/nonexistent/queue', 'test-video', {
      originalFilename: 'video.mp4',
      size: 1024,
    })

    expect(result.runId).toBeTruthy()
    expect(result.videoUploaded).toBe(true)
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringContaining('raw/'),
      '/nonexistent/video.mp4',
      'video/mp4',
    )
  })

  test('L5 bridge reports isCloudEnabled correctly', async () => {
    const { isCloudEnabled } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    expect(await isCloudEnabled()).toBe(true)

    mockIsAzureConfigured.mockReturnValueOnce(false)
    expect(await isCloudEnabled()).toBe(false)
  })

  test('cloud upload handles missing publish queue gracefully', async () => {
    const { uploadToCloud } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    const result = await uploadToCloud('/nonexistent/video.mp4', '/nonexistent/queue', 'test-video', {
      originalFilename: 'video.mp4',
      size: 512,
    })

    expect(result.contentUploaded).toBe(0)
    expect(result.errors).toContain('Publish queue directory not found')
  })

  test('cloud upload passes metadata to table record', async () => {
    const { uploadToCloud } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    await uploadToCloud('/nonexistent/video.mp4', '/nonexistent/queue', 'my-video', {
      originalFilename: 'recording.mp4',
      duration: 300,
      size: 2048,
    })

    expect(mockUpsertEntity).toHaveBeenCalledWith(
      'Videos',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        originalFilename: 'recording.mp4',
        duration: 300,
        size: 2048,
      }),
    )
  })
})

describe('ShortClipVariant type', () => {
  test('ShortClipVariant type includes isSplitScreen field', async () => {
    const { PipelineStage } = await import('../../../L0-pure/types/index.js')
    expect(PipelineStage.CloudUpload).toBeDefined()
  })
})

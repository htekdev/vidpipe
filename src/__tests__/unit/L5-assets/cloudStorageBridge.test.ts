import { describe, test, expect, vi } from 'vitest'

const mockIsCloudEnabled = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockUploadPipelineResults = vi.hoisted(() => vi.fn().mockResolvedValue({
  runId: 'test-run', videoUploaded: true, contentUploaded: 3, errors: [],
}))

vi.mock('../../../L4-agents/cloudStorage/cloudStorageOperations.js', () => ({
  isCloudEnabled: mockIsCloudEnabled,
  uploadPipelineResults: mockUploadPipelineResults,
}))

describe('L5 Unit: Cloud Storage Bridge', () => {
  test('isCloudEnabled delegates to L4', async () => {
    const { isCloudEnabled } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    const result = await isCloudEnabled()
    expect(result).toBe(true)
  })

  test('uploadToCloud delegates to L4 uploadPipelineResults', async () => {
    const { uploadToCloud } = await import('../../../L5-assets/bridges/cloudStorageBridge.js')
    const result = await uploadToCloud('/tmp/video.mp4', '/tmp/queue', 'my-video', {
      originalFilename: 'video.mp4', size: 1024,
    })
    expect(result.runId).toBe('test-run')
    expect(mockUploadPipelineResults).toHaveBeenCalledWith('/tmp/video.mp4', '/tmp/queue', 'my-video', {
      originalFilename: 'video.mp4', size: 1024,
    })
  })
})

export async function uploadToCloud(
  inputVideoPath: string,
  publishQueueDir: string,
  videoSlug: string,
  metadata: {
    originalFilename: string
    sourceUrl?: string
    duration?: number
    size: number
  },
): Promise<{
  runId: string
  videoUploaded: boolean
  contentUploaded: number
  errors: string[]
  videoUrl?: string
  assets: Array<{
    itemId: string
    clipType: 'video' | 'short' | 'medium-clip'
    ideaIds: string[]
    blobBasePath: string
    cloudUrl?: string
    thumbnailUrl?: string
    clipSlug?: string
  }>
}> {
  const { uploadPipelineResults } = await import('../../L4-agents/cloudStorage/cloudStorageOperations.js')
  return uploadPipelineResults(inputVideoPath, publishQueueDir, videoSlug, metadata)
}

export async function isCloudEnabled(): Promise<boolean> {
  const { isCloudEnabled: check } = await import('../../L4-agents/cloudStorage/cloudStorageOperations.js')
  return check()
}

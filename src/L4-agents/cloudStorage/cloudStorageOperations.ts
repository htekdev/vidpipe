import logger from '../../L1-infra/logger/configLogger.js'
import * as storageService from '../../L3-services/storage/storageService.js'
import * as azureConfigService from '../../L3-services/azureStorage/azureConfigService.js'

export function isCloudEnabled(): boolean {
  return storageService.isStorageConfigured()
}

export async function uploadPipelineResults(
  inputVideoPath: string,
  publishQueueDir: string,
  videoSlug: string,
  metadata: {
    originalFilename: string
    sourceUrl?: string
    duration?: number
    size: number
  },
): Promise<{ runId: string; videoUploaded: boolean; contentUploaded: number; errors: string[] }> {
  const runId = storageService.getRunId()

  logger.info(`Cloud upload starting (runId: ${runId})`)

  // Upload raw video
  let videoUploaded = false
  try {
    await storageService.uploadRawVideo(inputVideoPath, runId, {
      ...metadata,
      slug: videoSlug,
    })
    videoUploaded = true
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to upload raw video: ${msg}`)
  }

  // Upload publish queue content
  const result = await storageService.uploadPublishQueue(publishQueueDir, videoSlug, runId)

  logger.info(`Cloud upload complete: video=${videoUploaded}, content=${result.uploaded}, errors=${result.errors.length}`)

  return {
    runId,
    videoUploaded,
    contentUploaded: result.uploaded,
    errors: result.errors,
  }
}

export async function pullConfig(targetDir: string): Promise<{ downloaded: number }> {
  if (storageService.getStorageProviderName() !== 'azure') {
    throw new Error('Cloud configuration synchronization is not supported with AWS storage')
  }
  return azureConfigService.pullConfig(targetDir)
}

export async function pushConfig(sourceDir: string): Promise<{ uploaded: number }> {
  if (storageService.getStorageProviderName() !== 'azure') {
    throw new Error('Cloud configuration synchronization is not supported with AWS storage')
  }
  return azureConfigService.pushConfig(sourceDir)
}

export async function migrateLocalContent(outputDir: string): Promise<{ uploaded: number; errors: string[] }> {
  return storageService.migrateLocalContent(outputDir)
}

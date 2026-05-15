import logger from '../../L1-infra/logger/configLogger.js'
import * as azureStorageService from '../../L3-services/azureStorage/azureStorageService.js'
import * as azureConfigService from '../../L3-services/azureStorage/azureConfigService.js'

export function isCloudEnabled(): boolean {
  return azureStorageService.isAzureConfigured()
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
  const runId = azureStorageService.getRunId()

  logger.info(`Cloud upload starting (runId: ${runId})`)

  // Upload raw video
  let videoUploaded = false
  try {
    await azureStorageService.uploadRawVideo(inputVideoPath, runId, {
      ...metadata,
      slug: videoSlug,
    })
    videoUploaded = true
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Failed to upload raw video: ${msg}`)
  }

  // Upload publish queue content
  const result = await azureStorageService.uploadPublishQueue(publishQueueDir, videoSlug, runId)

  logger.info(`Cloud upload complete: video=${videoUploaded}, content=${result.uploaded}, errors=${result.errors.length}`)

  return {
    runId,
    videoUploaded,
    contentUploaded: result.uploaded,
    errors: result.errors,
  }
}

export async function pullConfig(targetDir: string): Promise<{ downloaded: number }> {
  return azureConfigService.pullConfig(targetDir)
}

export async function pushConfig(sourceDir: string): Promise<{ uploaded: number }> {
  return azureConfigService.pushConfig(sourceDir)
}

export async function migrateLocalContent(outputDir: string): Promise<{ uploaded: number; errors: string[] }> {
  return azureStorageService.migrateLocalContent(outputDir)
}

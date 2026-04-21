/**
 * Thumbnail Generation Bridge (L5 → L4)
 *
 * Provides lazy-loaded access to ThumbnailAgent for generating
 * thumbnails for videos and clips. Follows the L5 bridge pattern
 * used by visualEnhancement.ts.
 */
import { join } from '../L1-infra/paths/paths.js'
import { fileExists } from '../L1-infra/fileSystem/fileSystem.js'
import logger from '../L1-infra/logger/configLogger.js'
import { getThumbnailConfig } from '../L1-infra/config/brand.js'
import type { ThumbnailResult, ThumbnailContentType } from '../L0-pure/types/index.js'

/** Context needed for thumbnail generation. */
export interface ThumbnailContext {
  title: string
  description: string
  hook?: string
  topics?: string[]
  videoPath: string
  outputDir: string
  contentType: ThumbnailContentType
  platform?: string
}

/**
 * Generate a thumbnail for a video clip or main video.
 *
 * Lazily loads ThumbnailAgent and delegates generation. Returns the
 * generated thumbnail path, or null if thumbnails are disabled or
 * an existing thumbnail is found (idempotent).
 *
 * @param context - Video/clip context for the agent
 * @param force - If true, regenerate even if thumbnail exists
 * @returns Path to the generated thumbnail, or null if disabled/skipped
 */
export async function generateThumbnailForClip(
  context: ThumbnailContext,
  force = false,
): Promise<string | null> {
  const config = getThumbnailConfig()

  if (!config.enabled) {
    logger.debug('[ThumbnailBridge] Thumbnail generation is disabled')
    return null
  }

  // Check content type rules
  if (config.rules) {
    const ruleEnabled = config.rules[context.contentType]
    if (ruleEnabled === false) {
      logger.debug(`[ThumbnailBridge] Thumbnails disabled for ${context.contentType}`)
      return null
    }
  }

  // Idempotency: skip if thumbnail already exists
  const defaultPath = join(context.outputDir, 'thumbnail.png')
  if (!force && await fileExists(defaultPath)) {
    logger.info(`[ThumbnailBridge] Thumbnail already exists: ${defaultPath}`)
    return defaultPath
  }

  // Lazy-load the ThumbnailAgent to avoid eager initialization
  const { ThumbnailAgent } = await import('../L4-agents/ThumbnailAgent.js')
  const agent = new ThumbnailAgent()

  try {
    const results: ThumbnailResult[] = await agent.generateForClip(context)

    if (results.length === 0) {
      logger.warn(`[ThumbnailBridge] No thumbnails generated for ${context.title}`)
      return null
    }

    const result = results[0]
    logger.info(`[ThumbnailBridge] Thumbnail generated: ${result.outputPath} (reference=${result.referenceUsed})`)
    return result.outputPath
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`[ThumbnailBridge] Failed to generate thumbnail for "${context.title}": ${msg}`)
    return null
  } finally {
    await agent.destroy()
  }
}

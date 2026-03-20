import {
  generateImage as l2GenerateImage,
  generateImageWithReference as l2GenerateImageWithReference,
  COST_BY_QUALITY,
} from '../../L2-clients/openai/imageGeneration.js'
import { costTracker } from '../costTracking/costTracker.js'
import { getThumbnailConfig } from '../../L1-infra/config/brand.js'
import { fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { resolve } from '../../L1-infra/paths/paths.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import type {
  ThumbnailConfig,
  ThumbnailContentType,
  ThumbnailPlatformOverride,
  ThumbnailSize,
  ThumbnailQuality,
} from '../../L0-pure/types/index.js'

/** Resolved thumbnail generation options after merging base + platform overrides. */
export interface ResolvedThumbnailOptions {
  enabled: boolean
  referenceImagePath: string | null
  style: string | null
  promptOverride: string | null
  size: ThumbnailSize
  quality: ThumbnailQuality
}

/**
 * Resolve thumbnail generation options by merging base config with optional
 * platform-specific overrides. Returns fully resolved options ready for generation.
 */
export function resolveThumbnailConfig(
  platform?: string,
  contentType?: ThumbnailContentType,
): ResolvedThumbnailOptions {
  const config = getThumbnailConfig()

  if (!config.enabled) {
    return { enabled: false, referenceImagePath: null, style: null, promptOverride: null, size: 'auto', quality: 'high' }
  }

  // Check if this content type is enabled
  if (contentType && config.rules) {
    const ruleEnabled = config.rules[contentType]
    if (ruleEnabled === false) {
      return { enabled: false, referenceImagePath: null, style: null, promptOverride: null, size: 'auto', quality: 'high' }
    }
  }

  // Start with base config
  let referenceImage = config.referenceImage ?? null
  let style = config.style ?? null
  let promptOverride = config.promptOverride ?? null
  let size: ThumbnailSize = config.size ?? '1536x1024'
  const quality: ThumbnailQuality = config.quality ?? 'high'

  // Apply platform overrides if present
  if (platform && config.platformOverrides) {
    const override: ThumbnailPlatformOverride | undefined = config.platformOverrides[platform]
    if (override) {
      if (override.referenceImage !== undefined) referenceImage = override.referenceImage
      if (override.style !== undefined) style = override.style
      if (override.promptOverride !== undefined) promptOverride = override.promptOverride
      if (override.size !== undefined) size = override.size
    }
  }

  // Resolve reference image path to absolute
  let referenceImagePath: string | null = null
  if (referenceImage) {
    const envConfig = getConfig()
    referenceImagePath = resolve(envConfig.REPO_ROOT, referenceImage)
  }

  return { enabled: true, referenceImagePath, style, promptOverride, size, quality }
}

/**
 * Generate a thumbnail image. If a reference image is configured and exists,
 * uses style transfer via the OpenAI edits endpoint. Otherwise, uses standard
 * text-to-image generation.
 *
 * @param prompt - Description of the thumbnail to generate (may be overridden by config)
 * @param outputPath - Where to save the generated PNG
 * @param platform - Optional platform for platform-specific overrides
 * @param contentType - Content type ('main', 'shorts', 'medium-clips')
 * @returns Path to the saved thumbnail, or null if thumbnails are disabled
 */
export async function generateThumbnail(
  prompt: string,
  outputPath: string,
  platform?: string,
  contentType?: ThumbnailContentType,
): Promise<string | null> {
  const opts = resolveThumbnailConfig(platform, contentType)

  if (!opts.enabled) {
    logger.debug(`[Thumbnail] Thumbnail generation disabled for ${contentType ?? 'unknown'}/${platform ?? 'default'}`)
    return null
  }

  // Use promptOverride if configured, otherwise use the AI-planned prompt
  const finalPrompt = opts.promptOverride ?? prompt
  const genOptions = { size: opts.size, quality: opts.quality, style: opts.style ?? undefined }

  let result: string
  let referenceUsed = false

  // Try reference image style transfer if configured
  if (opts.referenceImagePath && await fileExists(opts.referenceImagePath)) {
    logger.info(`[Thumbnail] Generating with reference image: ${opts.referenceImagePath}`)
    result = await l2GenerateImageWithReference(finalPrompt, outputPath, opts.referenceImagePath, genOptions)
    referenceUsed = true
  } else {
    if (opts.referenceImagePath) {
      logger.warn(`[Thumbnail] Reference image not found: ${opts.referenceImagePath}, falling back to text-to-image`)
    }
    result = await l2GenerateImage(finalPrompt, outputPath, genOptions)
  }

  // Track cost
  costTracker.recordServiceUsage('openai-image-thumbnail', COST_BY_QUALITY[opts.quality], {
    model: 'gpt-image-1.5',
    size: opts.size,
    quality: opts.quality,
    referenceUsed,
    platform: platform ?? 'default',
    contentType: contentType ?? 'unknown',
    prompt: finalPrompt.substring(0, 200),
  })

  return result
}

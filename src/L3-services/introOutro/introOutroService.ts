import { concatVideos, normalizeForConcat } from '../../L2-clients/ffmpeg/videoConcat.js'
import { fileExists, removeFile } from '../../L1-infra/fileSystem/fileSystem.js'
import { resolve, join, dirname } from '../../L1-infra/paths/paths.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import { getIntroOutroConfig } from '../../L1-infra/config/brand.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { resolveIntroOutroToggle, resolveIntroPath, resolveOutroPath } from '../../L0-pure/introOutro/introOutroResolver.js'
import type { IntroOutroVideoType } from '../../L0-pure/types/index.js'

/**
 * Apply intro/outro to a video based on brand configuration.
 *
 * Resolves which intro/outro files to use (per-platform, with fallback to default),
 * checks the toggle rules (per-video-type and per-platform overrides),
 * normalizes the bookend videos to match the content, and concatenates.
 *
 * @param videoPath - Path to the content video (already captioned)
 * @param videoType - Which video type is being processed
 * @param outputPath - Destination path for the result
 * @param platform  - Optional platform for per-platform file/toggle resolution
 * @returns The output path if intro/outro was applied, or the original videoPath if skipped
 */
export async function applyIntroOutro(
  videoPath: string,
  videoType: IntroOutroVideoType,
  outputPath: string,
  platform?: string,
  aspectRatio?: string,
): Promise<string> {
  const envConfig = getConfig()
  if (envConfig.SKIP_INTRO_OUTRO) {
    logger.debug('Intro/outro skipped via SKIP_INTRO_OUTRO')
    return videoPath
  }

  const config = getIntroOutroConfig()
  if (!config.enabled) {
    logger.debug('Intro/outro disabled in brand config')
    return videoPath
  }

  const toggle = resolveIntroOutroToggle(config, videoType, platform)
  if (!toggle.intro && !toggle.outro) {
    logger.debug(`Intro/outro both disabled for ${videoType}${platform ? ` / ${platform}` : ''}`)
    return videoPath
  }

  const brandPath = envConfig.BRAND_PATH
  const brandDir = dirname(brandPath)

  // Resolve file paths (aspect ratio → platform → default)
  const introRelative = toggle.intro ? resolveIntroPath(config, platform, aspectRatio) : null
  const outroRelative = toggle.outro ? resolveOutroPath(config, platform, aspectRatio) : null

  const introPath = introRelative ? resolve(brandDir, introRelative) : null
  const outroPath = outroRelative ? resolve(brandDir, outroRelative) : null

  // Validate files exist (cache results to avoid duplicate I/O)
  const introExists = introPath ? await fileExists(introPath) : false
  const outroExists = outroPath ? await fileExists(outroPath) : false

  if (introPath && !introExists) {
    logger.warn(`Intro video not found: ${introPath} — skipping intro`)
  }
  if (outroPath && !outroExists) {
    logger.warn(`Outro video not found: ${outroPath} — skipping outro`)
  }

  const validIntro = introPath && introExists ? introPath : null
  const validOutro = outroPath && outroExists ? outroPath : null

  if (!validIntro && !validOutro) {
    logger.debug('No valid intro/outro files found — skipping')
    return videoPath
  }

  // Normalize bookend videos to match content codec/resolution
  const videoDir = dirname(outputPath)
  const segments: string[] = []
  const normalizedIntroPath = validIntro ? join(videoDir, '.intro-normalized.mp4') : null
  const normalizedOutroPath = validOutro ? join(videoDir, '.outro-normalized.mp4') : null

  try {
    if (validIntro && normalizedIntroPath) {
      await normalizeForConcat(validIntro, videoPath, normalizedIntroPath)
      segments.push(normalizedIntroPath)
    }

    segments.push(videoPath)

    if (validOutro && normalizedOutroPath) {
      await normalizeForConcat(validOutro, videoPath, normalizedOutroPath)
      segments.push(normalizedOutroPath)
    }

    logger.info(`Applying intro/outro (${validIntro ? 'intro' : ''}${validIntro && validOutro ? '+' : ''}${validOutro ? 'outro' : ''}) for ${videoType}${platform ? ` / ${platform}` : ''}: ${outputPath}`)

    await concatVideos(segments, outputPath, { fadeDuration: config.fadeDuration })

    return outputPath
  } finally {
    // Best-effort cleanup of temporary normalized files
    if (normalizedIntroPath) await removeFile(normalizedIntroPath).catch(() => {})
    if (normalizedOutroPath) await removeFile(normalizedOutroPath).catch(() => {})
  }
}

import { concatVideos, normalizeForConcat } from '../../L2-clients/ffmpeg/videoConcat.js'
import { fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
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

  // Validate files exist
  if (introPath && !(await fileExists(introPath))) {
    logger.warn(`Intro video not found: ${introPath} — skipping intro`)
  }
  if (outroPath && !(await fileExists(outroPath))) {
    logger.warn(`Outro video not found: ${outroPath} — skipping outro`)
  }

  const validIntro = introPath && (await fileExists(introPath)) ? introPath : null
  const validOutro = outroPath && (await fileExists(outroPath)) ? outroPath : null

  if (!validIntro && !validOutro) {
    logger.debug('No valid intro/outro files found — skipping')
    return videoPath
  }

  // Normalize bookend videos to match content codec/resolution
  const videoDir = dirname(outputPath)
  const segments: string[] = []

  if (validIntro) {
    const normalizedIntro = join(videoDir, '.intro-normalized.mp4')
    if (config.fadeDuration > 0) {
      // xfade will re-encode anyway, normalize for consistent resolution
      await normalizeForConcat(validIntro, videoPath, normalizedIntro)
      segments.push(normalizedIntro)
    } else {
      await normalizeForConcat(validIntro, videoPath, normalizedIntro)
      segments.push(normalizedIntro)
    }
  }

  segments.push(videoPath)

  if (validOutro) {
    const normalizedOutro = join(videoDir, '.outro-normalized.mp4')
    await normalizeForConcat(validOutro, videoPath, normalizedOutro)
    segments.push(normalizedOutro)
  }

  logger.info(`Applying intro/outro (${validIntro ? 'intro' : ''}${validIntro && validOutro ? '+' : ''}${validOutro ? 'outro' : ''}) for ${videoType}${platform ? ` / ${platform}` : ''}: ${outputPath}`)

  await concatVideos(segments, outputPath, { fadeDuration: config.fadeDuration })

  return outputPath
}

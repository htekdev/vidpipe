import { execFileRaw } from '../../L1-infra/process/process.js'
import { ensureDirectory, copyFile } from '../../L1-infra/fileSystem/fileSystem.js'
import { dirname, join } from '../../L1-infra/paths/paths.js'
import { getFFmpegPath } from './ffmpeg.js'
import logger from '../../L1-infra/logger/configLogger'
import { detectWebcamRegion, getVideoResolution, type WebcamRegion } from './faceDetection'

const ffmpegPath = getFFmpegPath()

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Supported output aspect ratios.
 * - `16:9` — standard landscape (YouTube, desktop)
 * - `9:16` — portrait / vertical (TikTok, Reels, Shorts)
 * - `1:1`  — square (LinkedIn, Twitter)
 * - `4:5`  — tall feed (Instagram feed)
 */
export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5'

/** Social-media platforms we generate video variants for. */
export type Platform =
  | 'tiktok'
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'instagram-feed'
  | 'linkedin'
  | 'youtube'
  | 'twitter'

/**
 * Maps each platform to its preferred aspect ratio.
 * Multiple platforms may share a ratio (e.g. TikTok + Reels both use 9:16),
 * which lets {@link generatePlatformVariants} deduplicate encodes.
 */
export const PLATFORM_RATIOS: Record<Platform, AspectRatio> = {
  'tiktok': '9:16',
  'youtube-shorts': '9:16',
  'instagram-reels': '9:16',
  'instagram-feed': '4:5',
  'linkedin': '1:1',
  'youtube': '16:9',
  'twitter': '1:1',
}

/**
 * Canonical pixel dimensions for each aspect ratio.
 * Width is always 1080 px for non-landscape ratios (the standard vertical
 * video width); landscape stays at 1920×1080 for full HD.
 */
export const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
}

export interface ConvertOptions {
  /** Fallback to letterbox/pillarbox instead of cropping (default: false) */
  letterbox?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the FFmpeg `-vf` filter string for a simple center-crop conversion.
 *
 * This is the **fallback** used when smart layout (webcam detection + split-screen)
 * is unavailable. It center-crops the source frame to the target aspect ratio,
 * discarding content on the sides (or top/bottom).
 *
 * **Letterbox mode**: instead of cropping, scales the video to fit inside the
 * target dimensions and pads the remaining space with black bars. Useful when
 * you don't want to lose any content (e.g. screen recordings with important
 * edges).
 *
 * **Crop formulas** assume a 16:9 landscape source. `ih` = input height,
 * `iw` = input width. We compute the crop width from the height to maintain
 * the target ratio, then center the crop horizontally.
 *
 * @param targetRatio - The desired output aspect ratio
 * @param letterbox - If true, pad with black bars instead of cropping
 * @returns An FFmpeg `-vf` filter string
 */
function buildCropFilter(targetRatio: AspectRatio, letterbox: boolean): string {
  if (letterbox) {
    const { width, height } = DIMENSIONS[targetRatio]
    // Scale to fit within target dimensions, then pad with black bars
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`
  }

  switch (targetRatio) {
    case '9:16':
      // Center-crop landscape to portrait: crop width = ih*9/16, keep full height
      return 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920'
    case '1:1':
      // Center-crop to square: use height as the dimension (smaller axis for 16:9)
      return 'crop=ih:ih:(iw-ih)/2:0,scale=1080:1080'
    case '4:5':
      // Center-crop landscape to 4:5: crop width = ih*4/5, keep full height
      return 'crop=ih*4/5:ih:(iw-ih*4/5)/2:0,scale=1080:1350'
    case '16:9':
      // Same ratio — just ensure standard dimensions
      return 'scale=1920:1080'
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a video's aspect ratio using FFmpeg center-crop.
 *
 * - 16:9 → 9:16: crops the center column to portrait
 * - 16:9 → 1:1:  crops to a center square
 * - Same ratio:  stream-copies without re-encoding
 *
 * @returns The output path on success
 */
export async function convertAspectRatio(
  inputPath: string,
  outputPath: string,
  targetRatio: AspectRatio,
  options: ConvertOptions = {},
): Promise<string> {
  const outputDir = dirname(outputPath)
  await ensureDirectory(outputDir)

  const sourceRatio: AspectRatio = '16:9' // our videos are always landscape

  // Same ratio — stream copy
  if (sourceRatio === targetRatio && !options.letterbox) {
    logger.info(`Aspect ratio already ${targetRatio}, copying → ${outputPath}`)
    await copyFile(inputPath, outputPath)
    return outputPath
  }

  const vf = buildCropFilter(targetRatio, options.letterbox ?? false)
  logger.info(`Converting aspect ratio to ${targetRatio} (filter: ${vf}) → ${outputPath}`)

  const args = [
    '-y',
    '-i', inputPath,
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'copy',
    '-threads', '4',
    outputPath,
  ]

  return new Promise<string>((resolve, reject) => {
    execFileRaw(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`Aspect ratio conversion failed: ${stderr || error.message}`)
        reject(new Error(`Aspect ratio conversion failed: ${stderr || error.message}`))
        return
      }
      logger.info(`Aspect ratio conversion complete: ${outputPath}`)
      resolve(outputPath)
    })
  })
}

// ── Smart Layout ─────────────────────────────────────────────────────────────

/**
 * Configuration for the smart split-screen layout.
 *
 * The split-screen stacks two regions vertically: the **screen content** on top
 * and the **webcam face** on the bottom. Each field controls the geometry of
 * the final composite:
 *
 * @property label - Human-readable name for logging (e.g. "SmartPortrait")
 * @property targetW - Output width in pixels. All smart layouts use 1080 px
 *   (vertical video standard) so both the screen and cam panels share the
 *   same width.
 * @property screenH - Height of the top panel (screen recording). Combined
 *   with `camH`, this determines the total output height and the visual
 *   ratio between screen content and webcam. Roughly ~65% of total height.
 * @property camH - Height of the bottom panel (webcam). Roughly ~35% of
 *   total height. The webcam is AR-matched and center-cropped to fill this
 *   panel edge-to-edge without black bars.
 * @property fallbackRatio - Aspect ratio to use with the simple center-crop
 *   path ({@link buildCropFilter}) when webcam detection fails.
 */
interface SmartLayoutConfig {
  label: string
  targetW: number
  screenH: number
  camH: number
  fallbackRatio: AspectRatio
}

/**
 * Shared smart conversion: detects a webcam overlay in the source video and
 * builds a **split-screen** layout (screen on top, webcam on bottom).
 *
 * ### Why split-screen?
 * Screen recordings with a webcam overlay (e.g. top-right corner) waste space
 * when naively center-cropped to portrait/square. The split-screen approach
 * gives the screen content and webcam each their own dedicated panel, making
 * both fully visible in a narrow frame.
 *
 * ### Algorithm
 * 1. Run {@link detectWebcamRegion} to find the webcam bounding box.
 * 2. **Screen crop**: exclude the webcam columns so only the screen content
 *    remains, then scale to `targetW × screenH` (letterboxing if needed).
 * 3. **Webcam crop**: aspect-ratio-match the webcam region to `targetW × camH`.
 *    If the webcam is wider than the target, we keep full height and
 *    center-crop width; if taller, we keep full width and center-crop height.
 *    This ensures the webcam fills its panel edge-to-edge with **no black bars**.
 * 4. **vstack**: vertically stack `[screen][cam]` into the final frame.
 *
 * Falls back to simple center-crop ({@link buildCropFilter}) if no webcam is
 * detected.
 *
 * @param inputPath - Source video (assumed 16:9 landscape with optional webcam overlay)
 * @param outputPath - Destination path for the converted video
 * @param config - Layout geometry (see {@link SmartLayoutConfig})
 * @returns The output path on success
 */
async function convertWithSmartLayout(
  inputPath: string,
  outputPath: string,
  config: SmartLayoutConfig,
  webcamOverride?: WebcamRegion | null,
): Promise<string> {
  const { label, targetW, screenH, camH, fallbackRatio } = config
  const outputDir = dirname(outputPath)
  await ensureDirectory(outputDir)

  const webcam = webcamOverride !== undefined ? webcamOverride : await detectWebcamRegion(inputPath)

  if (!webcam) {
    logger.info(`[${label}] No webcam found, falling back to center-crop`)
    return convertAspectRatio(inputPath, outputPath, fallbackRatio)
  }

  const resolution = await getVideoResolution(inputPath)

  // Determine screen crop region (exclude webcam area using detected bounds)
  // Add a small margin (2% of width) to ensure the webcam overlay is fully excluded
  // even when face detection bounding boxes aren't pixel-perfect
  const margin = Math.round(resolution.width * 0.02)
  let screenCropX: number
  let screenCropW: number
  if (webcam.position === 'top-right' || webcam.position === 'bottom-right') {
    screenCropX = 0
    screenCropW = Math.max(0, webcam.x - margin)
  } else {
    screenCropX = webcam.x + webcam.width + margin
    screenCropW = Math.max(0, resolution.width - screenCropX)
  }

  // Crop webcam to match target bottom-section aspect ratio, then scale to fill
  const targetAR = targetW / camH
  const webcamAR = webcam.width / webcam.height

  let faceX: number, faceY: number, faceW: number, faceH: number
  if (webcamAR > targetAR) {
    // Webcam wider than target: keep full height, center-crop width
    faceH = webcam.height
    faceW = Math.round(faceH * targetAR)
    faceX = webcam.x + Math.round((webcam.width - faceW) / 2)
    faceY = webcam.y
  } else {
    // Webcam taller than target: keep full width, center-crop height
    faceW = webcam.width
    faceH = Math.round(faceW / targetAR)
    faceX = webcam.x
    faceY = webcam.y + Math.round((webcam.height - faceH) / 2)
  }

  const filterComplex = [
    `[0:v]crop=${screenCropW}:ih:${screenCropX}:0,scale=${targetW}:${screenH}:force_original_aspect_ratio=decrease,` +
      `pad=${targetW}:${screenH}:(ow-iw)/2:(oh-ih)/2:black[screen]`,
    `[0:v]crop=${faceW}:${faceH}:${faceX}:${faceY},scale=${targetW}:${camH}[cam]`,
    '[screen][cam]vstack[out]',
  ].join(';')

  logger.info(`[${label}] Split-screen layout: webcam at ${webcam.position} → ${outputPath}`)

  const args = [
    '-y',
    '-i', inputPath,
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-threads', '4',
    outputPath,
  ]

  return new Promise<string>((resolve, reject) => {
    execFileRaw(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`[${label}] FFmpeg failed: ${stderr || error.message}`)
        reject(new Error(`${label} conversion failed: ${stderr || error.message}`))
        return
      }
      logger.info(`[${label}] Complete: ${outputPath}`)
      resolve(outputPath)
    })
  })
}

/**
 * Smart portrait (9:16) conversion → 1080×1920.
 *
 * Screen panel: 1080×1248 (65%), Webcam panel: 1080×672 (35%).
 * Total: 1080×1920 — standard TikTok / Reels / Shorts dimensions.
 *
 * Falls back to center-crop 9:16 if no webcam is detected.
 *
 * @param inputPath - Source landscape video
 * @param outputPath - Destination path for the portrait video
 */
export async function convertToPortraitSmart(
  inputPath: string,
  outputPath: string,
  webcamOverride?: WebcamRegion | null,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartPortrait',
    targetW: 1080,
    screenH: 1248,
    camH: 672,
    fallbackRatio: '9:16',
  }, webcamOverride)
}

/**
 * Smart square (1:1) conversion → 1080×1080.
 *
 * Screen panel: 1080×700 (65%), Webcam panel: 1080×380 (35%).
 * Total: 1080×1080 — standard LinkedIn / Twitter square format.
 *
 * Falls back to center-crop 1:1 if no webcam is detected.
 *
 * @param inputPath - Source landscape video
 * @param outputPath - Destination path for the square video
 */
export async function convertToSquareSmart(
  inputPath: string,
  outputPath: string,
  webcamOverride?: WebcamRegion | null,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartSquare',
    targetW: 1080,
    screenH: 700,
    camH: 380,
    fallbackRatio: '1:1',
  }, webcamOverride)
}

/**
 * Smart feed (4:5) conversion → 1080×1350.
 *
 * Screen panel: 1080×878 (65%), Webcam panel: 1080×472 (35%).
 * Total: 1080×1350 — Instagram feed's preferred tall format.
 *
 * Falls back to center-crop 4:5 if no webcam is detected.
 *
 * @param inputPath - Source landscape video
 * @param outputPath - Destination path for the 4:5 video
 */
export async function convertToFeedSmart(
  inputPath: string,
  outputPath: string,
  webcamOverride?: WebcamRegion | null,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartFeed',
    targetW: 1080,
    screenH: 878,
    camH: 472,
    fallbackRatio: '4:5',
  }, webcamOverride)
}

/** Options for {@link generatePlatformVariants}. */
export interface GeneratePlatformVariantsOptions {
  /**
   * Use the vision-based LayoutAgent instead of ONNX face detection.
   * **EXPERIMENTAL/DISABLED**: The agent analyzes frame content and constructs FFmpeg commands dynamically.
   * The vision-based approach is not yet reliable; using the existing ONNX face detection pipeline instead.
   * Default: false (uses existing ONNX/heuristic pipeline).
   * @deprecated Set to false; the LayoutAgent feature is experimental and disabled.
   */
  useAgent?: boolean
  /** Pre-detected webcam region from the main video's layout.json.
   * When provided, smart converters skip per-clip webcam detection. */
  webcamOverride?: WebcamRegion | null
}

/**
 * Generate platform-specific aspect-ratio variants of a short clip.
 *
 * ### Routing logic
 * 1. Maps each requested platform to its aspect ratio via {@link PLATFORM_RATIOS}.
 * 2. **Deduplicates by ratio** — if TikTok and Reels both need 9:16, only one
 *    encode is performed and both platforms reference the same output file.
 * 3. Skips 16:9 entirely since the source is already landscape.
 * 4. Routes each ratio to its smart converter (portrait / square / feed) for
 *    split-screen layout, falling back to {@link convertAspectRatio} for any
 *    ratio without a smart converter.
 *
 * ### Agent mode (DISABLED)
 * **NOTE**: The vision-based {@link LayoutAgent} is experimental and has been disabled.
 * The `useAgent` option is kept for API compatibility but currently has no effect.
 * All conversions use the ONNX face detection pipeline ({@link convertToPortraitSmart}, etc.).
 *
 * @param inputPath - Source video (16:9 landscape)
 * @param outputDir - Directory to write variant files into
 * @param slug - Base filename slug (e.g. "my-video-short-1")
 * @param platforms - Platforms to generate for (default: tiktok + linkedin)
 * @param options - Additional options (useAgent is deprecated; all conversions use ONNX pipeline)
 * @returns Array of variant metadata (one entry per platform, deduplicated files)
 */
export async function generatePlatformVariants(
  inputPath: string,
  outputDir: string,
  slug: string,
  platforms: Platform[] = ['tiktok', 'linkedin'],
  options: GeneratePlatformVariantsOptions = {},
): Promise<{ platform: Platform; aspectRatio: AspectRatio; path: string; width: number; height: number }[]> {
  await ensureDirectory(outputDir)

  // Deduplicate by aspect ratio to avoid redundant encodes
  const ratioMap = new Map<AspectRatio, Platform[]>()
  for (const p of platforms) {
    const ratio = PLATFORM_RATIOS[p]
    if (ratio === '16:9') continue // skip — original is already 16:9
    const list = ratioMap.get(ratio) ?? []
    list.push(p)
    ratioMap.set(ratio, list)
  }

  const variants: { platform: Platform; aspectRatio: AspectRatio; path: string; width: number; height: number }[] = []

  for (const [ratio, associatedPlatforms] of ratioMap) {
    const suffix = ratio === '9:16' ? 'portrait' : ratio === '4:5' ? 'feed' : 'square'
    const outPath = join(outputDir, `${slug}-${suffix}.mp4`)

    try {
      if (ratio === '9:16') {
        // NOTE: LayoutAgent support is DISABLED - vision-based approach not working well yet
        // The useAgent option is kept for backwards compatibility but is ignored.
        // All portrait conversions use the ONNX face detection pipeline.
        if (options.useAgent) {
          logger.warn(`[generatePlatformVariants] LayoutAgent is disabled, falling back to ONNX pipeline`)
        }
        await convertToPortraitSmart(inputPath, outPath, options.webcamOverride)
      } else if (ratio === '1:1') {
        await convertToSquareSmart(inputPath, outPath, options.webcamOverride)
      } else if (ratio === '4:5') {
        await convertToFeedSmart(inputPath, outPath, options.webcamOverride)
      } else {
        await convertAspectRatio(inputPath, outPath, ratio)
      }
      const dims = DIMENSIONS[ratio]
      for (const p of associatedPlatforms) {
        variants.push({ platform: p, aspectRatio: ratio, path: outPath, width: dims.width, height: dims.height })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn(`Skipping ${ratio} variant for ${slug}: ${message}`)
    }
  }

  return variants
}

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import pathMod from 'path'
import logger from '../../config/logger'
import { detectWebcamRegion, getVideoResolution } from './faceDetection'

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

// ── Types ────────────────────────────────────────────────────────────────────

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5'

export type Platform =
  | 'tiktok'
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'instagram-feed'
  | 'linkedin'
  | 'youtube'
  | 'twitter'

export const PLATFORM_RATIOS: Record<Platform, AspectRatio> = {
  'tiktok': '9:16',
  'youtube-shorts': '9:16',
  'instagram-reels': '9:16',
  'instagram-feed': '4:5',
  'linkedin': '1:1',
  'youtube': '16:9',
  'twitter': '1:1',
}

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
 * Build the FFmpeg `-vf` filter string for a given aspect ratio conversion.
 * Uses simple center-crop (MVP approach).
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
  const outputDir = pathMod.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })

  const sourceRatio: AspectRatio = '16:9' // our videos are always landscape

  // Same ratio — stream copy
  if (sourceRatio === targetRatio && !options.letterbox) {
    logger.info(`Aspect ratio already ${targetRatio}, copying → ${outputPath}`)
    await fs.copyFile(inputPath, outputPath)
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
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
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

interface SmartLayoutConfig {
  label: string
  targetW: number
  screenH: number
  camH: number
  fallbackRatio: AspectRatio
}

/**
 * Shared smart conversion: detects webcam overlay and creates a split-screen
 * layout (screen top + webcam bottom). Falls back to center-crop if no webcam
 * is detected. The webcam is AR-matched and center-cropped to fill its section
 * edge-to-edge with no black bars.
 */
async function convertWithSmartLayout(
  inputPath: string,
  outputPath: string,
  config: SmartLayoutConfig,
): Promise<string> {
  const { label, targetW, screenH, camH, fallbackRatio } = config
  const outputDir = pathMod.dirname(outputPath)
  await fs.mkdir(outputDir, { recursive: true })

  const webcam = await detectWebcamRegion(inputPath)

  if (!webcam) {
    logger.info(`[${label}] No webcam found, falling back to center-crop`)
    return convertAspectRatio(inputPath, outputPath, fallbackRatio)
  }

  const resolution = await getVideoResolution(inputPath)

  // Determine screen crop region (exclude webcam area using detected bounds)
  let screenCropX: number
  let screenCropW: number
  if (webcam.position === 'top-right' || webcam.position === 'bottom-right') {
    screenCropX = 0
    screenCropW = webcam.x
  } else {
    screenCropX = webcam.x + webcam.width
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
    execFile(ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
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
 * Smart portrait conversion: detects webcam overlay and creates a split-screen
 * layout (screen top ~65%, webcam bottom ~35%). Falls back to center-crop if
 * no webcam is detected.
 */
export async function convertToPortraitSmart(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartPortrait',
    targetW: 1080,
    screenH: 1248,
    camH: 672,
    fallbackRatio: '9:16',
  })
}

/**
 * Smart square conversion: detects webcam overlay and creates a split-screen
 * layout (screen top ~65%, webcam bottom ~35%). Falls back to center-crop if
 * no webcam is detected.
 */
export async function convertToSquareSmart(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartSquare',
    targetW: 1080,
    screenH: 700,
    camH: 380,
    fallbackRatio: '1:1',
  })
}

/**
 * Smart feed (4:5) conversion: detects webcam overlay and creates a split-screen
 * layout (screen top ~65%, webcam bottom ~35%). Falls back to center-crop if
 * no webcam is detected.
 */
export async function convertToFeedSmart(
  inputPath: string,
  outputPath: string,
): Promise<string> {
  return convertWithSmartLayout(inputPath, outputPath, {
    label: 'SmartFeed',
    targetW: 1080,
    screenH: 878,
    camH: 472,
    fallbackRatio: '4:5',
  })
}

/**
 * Generate platform-specific variants of a short clip.
 * Returns the paths of generated variants keyed by platform.
 */
export async function generatePlatformVariants(
  inputPath: string,
  outputDir: string,
  slug: string,
  platforms: Platform[] = ['tiktok', 'linkedin'],
): Promise<{ platform: Platform; aspectRatio: AspectRatio; path: string; width: number; height: number }[]> {
  await fs.mkdir(outputDir, { recursive: true })

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
    const outPath = pathMod.join(outputDir, `${slug}-${suffix}.mp4`)

    try {
      if (ratio === '9:16') {
        await convertToPortraitSmart(inputPath, outPath)
      } else if (ratio === '1:1') {
        await convertToSquareSmart(inputPath, outPath)
      } else if (ratio === '4:5') {
        await convertToFeedSmart(inputPath, outPath)
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

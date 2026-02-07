import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import sharp from 'sharp'
import logger from '../../config/logger'

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'

// ── Types ────────────────────────────────────────────────────────────────────

export interface WebcamRegion {
  x: number
  y: number
  width: number
  height: number
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  confidence: number
}

export interface CornerAnalysis {
  position: WebcamRegion['position']
  x: number
  y: number
  width: number
  height: number
  skinToneRatio: number
  variance: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const SAMPLE_FRAMES = 5
const ANALYSIS_WIDTH = 320
const ANALYSIS_HEIGHT = 180
// Corner region = 25% of each dimension
const CORNER_FRACTION = 0.25
const MIN_SKIN_RATIO = 0.05
const MIN_CONFIDENCE = 0.3

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath],
      (error, stdout) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${error.message}`))
          return
        }
        resolve(parseFloat(stdout.trim()))
      },
    )
  })
}

export async function getVideoResolution(videoPath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        videoPath,
      ],
      (error, stdout) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${error.message}`))
          return
        }
        const [w, h] = stdout.trim().split(',').map(Number)
        resolve({ width: w, height: h })
      },
    )
  })
}

async function extractSampleFrames(videoPath: string, tempDir: string): Promise<string[]> {
  const duration = await getVideoDuration(videoPath)
  // Space frames evenly, avoiding very start/end
  const interval = Math.max(1, Math.floor(duration / (SAMPLE_FRAMES + 1)))

  const timestamps: number[] = []
  for (let i = 1; i <= SAMPLE_FRAMES; i++) {
    timestamps.push(i * interval)
  }

  const framePaths: string[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const framePath = path.join(tempDir, `frame_${i}.png`)
    framePaths.push(framePath)

    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath,
        [
          '-y',
          '-ss', timestamps[i].toFixed(2),
          '-i', videoPath,
          '-vf', `scale=${ANALYSIS_WIDTH}:${ANALYSIS_HEIGHT}`,
          '-frames:v', '1',
          '-q:v', '2',
          framePath,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
        (error) => {
          if (error) {
            reject(new Error(`Frame extraction failed at ${timestamps[i]}s: ${error.message}`))
            return
          }
          resolve()
        },
      )
    })
  }

  return framePaths
}

/**
 * Check if a pixel (in RGB) falls within skin-tone range.
 * Uses simplified HSV heuristic: hue ~0-50°, moderate saturation.
 */
export function isSkinTone(r: number, g: number, b: number): boolean {
  // Rule-based skin detection in RGB space (avoids HSV conversion overhead)
  // Skin typically: R > 95, G > 40, B > 20, max-min > 15, |R-G| > 15, R > G, R > B
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return (
    r > 95 && g > 40 && b > 20 &&
    (max - min) > 15 &&
    Math.abs(r - g) > 15 &&
    r > g && r > b
  )
}

async function analyzeCorner(
  framePath: string,
  position: WebcamRegion['position'],
): Promise<CornerAnalysis> {
  const cornerW = Math.floor(ANALYSIS_WIDTH * CORNER_FRACTION)
  const cornerH = Math.floor(ANALYSIS_HEIGHT * CORNER_FRACTION)

  let left: number
  let top: number
  switch (position) {
    case 'top-left':     left = 0; top = 0; break
    case 'top-right':    left = ANALYSIS_WIDTH - cornerW; top = 0; break
    case 'bottom-left':  left = 0; top = ANALYSIS_HEIGHT - cornerH; break
    case 'bottom-right': left = ANALYSIS_WIDTH - cornerW; top = ANALYSIS_HEIGHT - cornerH; break
  }

  const { data, info } = await sharp(framePath)
    .extract({ left, top, width: cornerW, height: cornerH })
    .raw()
    .toBuffer({ resolveWithObject: true })

  const totalPixels = info.width * info.height
  const channels = info.channels
  let skinCount = 0
  let sumR = 0, sumG = 0, sumB = 0
  let sumR2 = 0, sumG2 = 0, sumB2 = 0

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    if (isSkinTone(r, g, b)) skinCount++

    sumR += r; sumG += g; sumB += b
    sumR2 += r * r; sumG2 += g * g; sumB2 += b * b
  }

  const skinToneRatio = skinCount / totalPixels

  // Compute variance across all channels as a measure of visual complexity
  const meanR = sumR / totalPixels
  const meanG = sumG / totalPixels
  const meanB = sumB / totalPixels
  const varR = sumR2 / totalPixels - meanR * meanR
  const varG = sumG2 / totalPixels - meanG * meanG
  const varB = sumB2 / totalPixels - meanB * meanB
  const variance = (varR + varG + varB) / 3

  return {
    position,
    x: left,
    y: top,
    width: cornerW,
    height: cornerH,
    skinToneRatio,
    variance,
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Calculate confidence that a corner contains a webcam overlay based on
 * per-frame scores. Combines consistency (fraction of non-zero frames) with
 * average score.
 */
export function calculateCornerConfidence(scores: number[]): number {
  if (scores.length === 0) return 0
  const nonZeroCount = scores.filter(s => s > 0).length
  const consistency = nonZeroCount / scores.length
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  return consistency * Math.min(avgScore * 10, 1)
}

/**
 * Detect a webcam overlay region in a screen recording.
 *
 * Samples frames at even intervals and analyzes each corner for skin-tone
 * pixels and visual variance. A corner with consistent skin-tone presence
 * across multiple frames is likely a webcam overlay.
 *
 * @returns The detected region in original video resolution, or null if none found.
 */
export async function detectWebcamRegion(videoPath: string): Promise<WebcamRegion | null> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'face-detect-'))

  try {
    const resolution = await getVideoResolution(videoPath)
    const framePaths = await extractSampleFrames(videoPath, tempDir)

    const positions: WebcamRegion['position'][] = [
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
    ]

    // Analyze all corners across all frames
    const scoresByPosition = new Map<WebcamRegion['position'], number[]>()
    for (const pos of positions) {
      scoresByPosition.set(pos, [])
    }

    for (const framePath of framePaths) {
      for (const pos of positions) {
        const analysis = await analyzeCorner(framePath, pos)
        // Score = skin ratio weighted by variance (webcam corners are visually busy)
        const score = analysis.skinToneRatio > MIN_SKIN_RATIO
          ? analysis.skinToneRatio * Math.min(analysis.variance / 1000, 1)
          : 0
        scoresByPosition.get(pos)!.push(score)
      }
    }

    // Find the corner with the highest consistent score
    let bestPosition: WebcamRegion['position'] | null = null
    let bestConfidence = 0

    for (const [pos, scores] of scoresByPosition) {
      const confidence = calculateCornerConfidence(scores)

      if (confidence > bestConfidence) {
        bestConfidence = confidence
        bestPosition = pos
      }
    }

    if (!bestPosition || bestConfidence < MIN_CONFIDENCE) {
      logger.info('[FaceDetection] No webcam region detected')
      return null
    }

    // Map from analysis resolution back to original resolution
    const scaleX = resolution.width / ANALYSIS_WIDTH
    const scaleY = resolution.height / ANALYSIS_HEIGHT
    const cornerW = Math.floor(ANALYSIS_WIDTH * CORNER_FRACTION)
    const cornerH = Math.floor(ANALYSIS_HEIGHT * CORNER_FRACTION)

    let origX: number
    let origY: number
    switch (bestPosition) {
      case 'top-left':     origX = 0; origY = 0; break
      case 'top-right':    origX = resolution.width - Math.round(cornerW * scaleX); origY = 0; break
      case 'bottom-left':  origX = 0; origY = resolution.height - Math.round(cornerH * scaleY); break
      case 'bottom-right':
        origX = resolution.width - Math.round(cornerW * scaleX)
        origY = resolution.height - Math.round(cornerH * scaleY)
        break
    }

    const region: WebcamRegion = {
      x: origX,
      y: origY,
      width: Math.round(cornerW * scaleX),
      height: Math.round(cornerH * scaleY),
      position: bestPosition,
      confidence: Math.round(bestConfidence * 100) / 100,
    }

    logger.info(
      `[FaceDetection] Webcam detected at ${region.position} ` +
      `(${region.x},${region.y} ${region.width}x${region.height}) confidence=${region.confidence}`,
    )

    return region
  } finally {
    // Clean up temp frames
    const files = await fs.readdir(tempDir).catch(() => [] as string[])
    for (const f of files) {
      await fs.unlink(path.join(tempDir, f)).catch(() => {})
    }
    await fs.rmdir(tempDir).catch(() => {})
  }
}

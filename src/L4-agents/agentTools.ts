/**
 * Core I/O tools for vision agents.
 *
 * Provides utilities for:
 * - Frame capture from video
 * - Video metadata extraction
 * - Transcript reading with time range filtering
 * - Chapter loading
 * - Arbitrary FFmpeg command execution
 * - Image generation (DALL-E)
 */

import tmp from 'tmp'
import { join } from '../L1-infra/paths/paths.js'
import { readJsonFile, ensureDirectory } from '../L1-infra/fileSystem/fileSystem.js'
import { execCommand, execFileRaw } from '../L1-infra/process/process.js'
import { getFFmpegPath, getFFprobePath } from '../L3-services/videoOperations/videoOperations.js'
import { Word } from '../L0-pure/types/index.js'
import logger from '../L1-infra/logger/configLogger.js'

// ============================================================================
// TYPES
// ============================================================================

export interface FrameCaptureResult {
  imagePath: string
}

export interface VideoInfo {
  width: number
  height: number
  duration: number
  fps: number
}

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

export interface TranscriptResult {
  text: string
  words: TranscriptWord[]
}

export interface ChapterEntry {
  time: number
  title: string
}

export interface ChaptersResult {
  chapters: ChapterEntry[]
}

export interface FfmpegResult {
  success: boolean
  outputPath?: string
  error?: string
}

export interface ImageGenerationResult {
  imagePath: string
}

export interface DrawRegion {
  x: number
  y: number
  width: number
  height: number
  label: string
  color?: string // Default: red for first, blue for second, etc.
}

export interface DrawRegionsResult {
  imagePath: string
}

// ============================================================================
// FRAME CAPTURE
// ============================================================================

/**
 * Capture a single frame from video at the given timestamp.
 *
 * Uses FFmpeg to extract a high-quality JPEG frame.
 *
 * @param videoPath - Path to the source video file
 * @param timestamp - Time in seconds from the start of the video
 * @returns Object containing the path to the captured frame
 */
export async function captureFrame(
  videoPath: string,
  timestamp: number,
): Promise<FrameCaptureResult> {
  const outputPath = tmp.fileSync({ postfix: '.jpg' }).name

  logger.debug(`[agentTools] Capturing frame at ${timestamp}s from ${videoPath}`)

  // Validate timestamp against video duration to avoid FFmpeg silently outputting last frame
  const info = await getVideoInfo(videoPath)
  if (info.duration > 0 && timestamp > info.duration) {
    throw new Error(`Frame capture failed at ${timestamp}s: timestamp exceeds video duration (${info.duration}s)`)
  }

  const ffmpegPath = getFFmpegPath()
  const args = [
    '-ss', String(timestamp),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y',
    outputPath,
  ]

  try {
    await execCommand(ffmpegPath, args, { timeout: 30000 })
    logger.debug(`[agentTools] Frame captured: ${outputPath}`)
    return { imagePath: outputPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Frame capture failed at ${timestamp}s: ${message}`)
  }
}

// ============================================================================
// DRAW REGIONS (for visual verification before encoding)
// ============================================================================

const REGION_COLORS = ['red', 'blue', 'green', 'yellow', 'cyan', 'magenta']

/**
 * Draw labeled rectangles on an image to visualize crop regions.
 *
 * Use this to verify coordinates BEFORE running expensive FFmpeg encode.
 * The agent can see the annotated frame and confirm regions are correct.
 *
 * @param imagePath - Path to the source image (frame)
 * @param regions - Array of regions to draw with x, y, width, height, label
 * @returns Object containing the path to the annotated image
 */
export async function drawRegions(
  imagePath: string,
  regions: DrawRegion[],
): Promise<DrawRegionsResult> {
  const outputPath = tmp.fileSync({ postfix: '.jpg' }).name

  logger.debug(`[agentTools] Drawing ${regions.length} regions on ${imagePath}`)

  // Build FFmpeg drawbox and drawtext filters
  const filters: string[] = []

  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]
    const color = r.color ?? REGION_COLORS[i % REGION_COLORS.length]

    // Draw rectangle outline (thickness 4)
    filters.push(`drawbox=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}:color=${color}:t=4`)

    // Escape label for FFmpeg drawtext filter (colons, quotes, backslashes, brackets)
    const safeLabel = r.label
      .replace(/\\/g, '/')
      .replace(/'/g, '')
      .replace(/:/g, ' ')
      .replace(/\[/g, '(')
      .replace(/\]/g, ')')
      .replace(/;/g, ' ')
      .replace(/%/g, '')

    // Draw label at top-left of rectangle with background
    filters.push(
      `drawtext=text='${safeLabel}':x=${r.x + 5}:y=${r.y + 5}:fontsize=24:fontcolor=white:box=1:boxcolor=${color}@0.7:boxborderw=5`
    )
  }

  const ffmpegPath = getFFmpegPath()
  const args = [
    '-i', imagePath,
    '-vf', filters.join(','),
    '-q:v', '2',
    '-y',
    outputPath,
  ]

  try {
    await execCommand(ffmpegPath, args, { timeout: 30000 })
    logger.debug(`[agentTools] Annotated frame saved: ${outputPath}`)
    return { imagePath: outputPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to draw regions: ${message}`)
  }
}

// ============================================================================
// VIDEO INFO
// ============================================================================

/**
 * Get video metadata using FFprobe.
 *
 * @param videoPath - Path to the video file
 * @returns Video dimensions, duration, and frame rate
 */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const ffprobePath = getFFprobePath()
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration',
    '-of', 'json',
    videoPath,
  ]

  logger.debug(`[agentTools] Getting video info for ${videoPath}`)

  try {
    const { stdout } = await execCommand(ffprobePath, args, { timeout: 10000 })
    const data = JSON.parse(stdout)

    const stream = data.streams?.[0] ?? {}
    const format = data.format ?? {}

    // Parse frame rate (e.g., "30000/1001" or "30")
    let fps = 30
    if (stream.r_frame_rate) {
      const parts = stream.r_frame_rate.split('/')
      fps = parts.length === 2
        ? parseInt(parts[0]) / parseInt(parts[1])
        : parseFloat(stream.r_frame_rate)
    }

    // Duration from stream or format
    const duration = parseFloat(stream.duration) || parseFloat(format.duration) || 0

    return {
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      duration,
      fps: isFinite(fps) && fps > 0 ? fps : 30,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to get video info: ${message}`)
  }
}

// ============================================================================
// TRANSCRIPT
// ============================================================================

/**
 * Read transcript JSON with optional time range filtering.
 *
 * @param transcriptPath - Path to the transcript JSON file
 * @param startTime - Optional start time in seconds to filter words
 * @param endTime - Optional end time in seconds to filter words
 * @returns Text and word-level timestamps for the requested range
 */
export async function readTranscript(
  transcriptPath: string,
  startTime?: number,
  endTime?: number,
): Promise<TranscriptResult> {
  logger.debug(`[agentTools] Reading transcript from ${transcriptPath}`)

  const transcript = await readJsonFile<{ text: string; words: Word[] }>(transcriptPath)

  let words = transcript.words ?? []

  // Filter by time range if specified
  if (startTime !== undefined || endTime !== undefined) {
    words = words.filter((w) => {
      const afterStart = startTime === undefined || w.start >= startTime
      const beforeEnd = endTime === undefined || w.end <= endTime
      return afterStart && beforeEnd
    })
  }

  // Build text from filtered words
  const text = words.map((w) => w.word).join('').trim()

  return {
    text,
    words: words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    })),
  }
}

// ============================================================================
// CHAPTERS
// ============================================================================

/**
 * Read chapters from a JSON file.
 *
 * @param chaptersPath - Path to the chapters JSON file
 * @returns Array of chapter entries with time and title
 */
export async function getChapters(chaptersPath: string): Promise<ChaptersResult> {
  logger.debug(`[agentTools] Reading chapters from ${chaptersPath}`)

  const chapters = await readJsonFile<Array<{ timestamp: number; title: string }>>(chaptersPath)

  return {
    chapters: chapters.map((c) => ({
      time: c.timestamp,
      title: c.title,
    })),
  }
}

// ============================================================================
// FFMPEG
// ============================================================================

/**
 * Run an arbitrary FFmpeg command.
 *
 * @param args - Array of arguments to pass to FFmpeg
 * @returns Result object with success status, output path (if applicable), and error message
 */
export async function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  const ffmpegPath = getFFmpegPath()

  logger.debug(`[agentTools] Running FFmpeg: ${args.join(' ')}`)

  return new Promise((resolve) => {
    execFileRaw(
      ffmpegPath,
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: 600000 },
      (error, _stdout, stderr) => {
        if (error) {
          // Extract just the meaningful error lines from FFmpeg's verbose stderr
          const errorLines = (stderr || error.message)
            .split('\n')
            .filter((line: string) => {
              const trimmed = line.trim()
              if (!trimmed) return false
              if (trimmed.startsWith('Fontconfig error')) return false
              return /^\[|^Error|^Invalid|No such/.test(trimmed)
            })
          const shortError = errorLines.length > 0
            ? errorLines.join('\n')
            : (stderr || error.message).split('\n').slice(-5).join('\n')
          logger.error(`[agentTools] FFmpeg failed:\n${shortError}`)
          resolve({
            success: false,
            error: shortError,
          })
          return
        }

        // Try to extract output path from args (last non-flag argument)
        let outputPath: string | undefined
        for (let i = args.length - 1; i >= 0; i--) {
          if (!args[i].startsWith('-')) {
            outputPath = args[i]
            break
          }
        }

        logger.debug(`[agentTools] FFmpeg completed successfully`)
        resolve({
          success: true,
          outputPath,
        })
      },
    )
  })
}

// ============================================================================
// IMAGE GENERATION
// ============================================================================

/**
 * Generate an image using DALL-E.
 *
 * @param prompt - Text description of the image to generate
 * @param style - Style modifier (e.g., "vivid", "natural")
 * @param size - Output dimensions
 * @returns Path to the generated image
 * @throws Not implemented error (placeholder for future implementation)
 */
export async function generateImage(
  prompt: string,
  style: string,
  size: '1024x1024' | '1792x1024' | '1024x1792',
): Promise<ImageGenerationResult> {
  // Placeholder - will be implemented when DALL-E integration is added
  logger.warn(`[agentTools] generateImage not implemented yet`)
  throw new Error(
    `generateImage is not yet implemented. ` +
    `Requested: prompt="${prompt.slice(0, 50)}...", style="${style}", size="${size}"`,
  )
}

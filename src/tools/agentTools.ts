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

import os from 'os'
import crypto from 'crypto'
import { join } from '../core/paths.js'
import { readJsonFile, ensureDirectory } from '../core/fileSystem.js'
import { execCommand, execFileRaw } from '../core/process.js'
import { getFFmpegPath, getFFprobePath } from '../core/ffmpeg.js'
import { Word } from '../types/index.js'
import logger from '../config/logger.js'

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
  const uuid = crypto.randomUUID()
  const outputPath = join(os.tmpdir(), `frame-${uuid}.jpg`)

  logger.debug(`[agentTools] Capturing frame at ${timestamp}s from ${videoPath}`)

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
          logger.error(`[agentTools] FFmpeg failed: ${stderr}`)
          resolve({
            success: false,
            error: stderr || error.message,
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

import { analyzeVideoForEnhancements } from '../tools/gemini/geminiClient.js'
import { generateEnhancementImages } from '../agents/GraphicsAgent.js'
import { compositeOverlays } from '../tools/ffmpeg/overlayCompositing.js'
import { getModelForAgent } from '../config/modelConfig.js'
import { ensureDirectory } from '../core/fileSystem.js'
import { join } from '../core/paths.js'
import logger from '../config/logger.js'
import type { VideoFile, Transcript, VisualEnhancementResult } from '../types/index.js'

/**
 * Run the visual enhancement stage.
 *
 * 1. Gemini analyzes the video to find enhancement opportunities
 * 2. GraphicsAgent generates images for each opportunity
 * 3. FFmpeg composites the images onto the video
 *
 * @param videoPath - Path to the cleaned (or original) video
 * @param transcript - Transcript for context (adjusted if silence was removed)
 * @param video - VideoFile metadata (for dimensions, slug, directory)
 * @returns Enhanced video path and overlay metadata, or undefined if no enhancements were made
 */
export async function enhanceVideo(
  videoPath: string,
  transcript: Transcript,
  video: VideoFile,
): Promise<VisualEnhancementResult | undefined> {
  const enhancementsDir = join(video.videoDir, 'enhancements')
  await ensureDirectory(enhancementsDir)

  // Step 1: Gemini enhancement analysis
  logger.info('[VisualEnhancement] Step 1: Analyzing video for enhancement opportunities...')
  const opportunities = await analyzeVideoForEnhancements(
    videoPath,
    video.duration,
    transcript.text,
  )

  if (opportunities.length === 0) {
    logger.info('[VisualEnhancement] No enhancement opportunities identified — skipping')
    return undefined
  }

  logger.info(`[VisualEnhancement] Found ${opportunities.length} enhancement opportunities`)

  // Step 2: Generate images via GraphicsAgent
  logger.info('[VisualEnhancement] Step 2: Generating enhancement images...')
  const overlays = await generateEnhancementImages(
    opportunities,
    enhancementsDir,
    getModelForAgent('GraphicsAgent'),
  )

  if (overlays.length === 0) {
    logger.info('[VisualEnhancement] GraphicsAgent generated no images — skipping compositing')
    return undefined
  }

  logger.info(`[VisualEnhancement] Generated ${overlays.length} enhancement images`)

  // Step 3: Composite overlays onto video
  logger.info('[VisualEnhancement] Step 3: Compositing overlays onto video...')
  const outputPath = join(video.videoDir, `${video.slug}-enhanced.mp4`)

  const videoWidth = video.layout?.width ?? 1920
  const videoHeight = video.layout?.height ?? 1080

  const enhancedVideoPath = await compositeOverlays(
    videoPath,
    overlays,
    outputPath,
    videoWidth,
    videoHeight,
  )

  logger.info(`[VisualEnhancement] Enhanced video created: ${enhancedVideoPath}`)

  let totalImageCost = 0
  for (const overlay of overlays) {
    totalImageCost += 0.07 // estimated per image (high quality)
  }

  return {
    enhancedVideoPath,
    overlays,
    analysisTokens: 0, // tracked by costTracker internally
    imageGenCost: totalImageCost,
  }
}

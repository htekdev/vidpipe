import { analyzeVideoForEnhancements } from '../L4-agents/analysisServiceBridge.js'
import { generateEnhancementImages } from '../L4-agents/GraphicsAgent.js'
import { compositeOverlays } from '../L4-agents/videoServiceBridge.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import { ensureDirectory, writeJsonFile } from '../L1-infra/fileSystem/fileSystem.js'
import { join } from '../L1-infra/paths/paths.js'
import logger from '../L1-infra/logger/configLogger.js'
import type { VideoFile, Transcript, VisualEnhancementResult } from '../L0-pure/types/index.js'

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

  // Step 1: Gemini enhancement analysis (returns raw editorial report)
  logger.info('[VisualEnhancement] Step 1: Analyzing video for enhancement opportunities...')
  const enhancementReport = await analyzeVideoForEnhancements(
    videoPath,
    video.duration,
    transcript.text,
  )

  if (!enhancementReport || enhancementReport.trim().length === 0) {
    logger.info('[VisualEnhancement] No enhancement report generated — skipping')
    return undefined
  }

  logger.info(`[VisualEnhancement] Received editorial report (${enhancementReport.length} chars)`)

  // Step 2: GraphicsAgent makes editorial decisions and generates images
  logger.info('[VisualEnhancement] Step 2: GraphicsAgent making editorial decisions and generating images...')
  const overlays = await generateEnhancementImages(
    enhancementReport,
    enhancementsDir,
    video.duration,
    getModelForAgent('GraphicsAgent'),
  )

  if (overlays.length === 0) {
    logger.info('[VisualEnhancement] GraphicsAgent generated no images — skipping compositing')
    return undefined
  }

  logger.info(`[VisualEnhancement] Generated ${overlays.length} enhancement images`)

  await writeJsonFile(join(video.videoDir, 'enhancements-plan.json'), overlays)

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

import { execFileRaw } from '../../core/process.js'
import { getFFmpegPath } from '../../core/ffmpeg.js'
import logger from '../../config/logger.js'
import type { GeneratedOverlay, OverlayRegion } from '../../types/index.js'

/**
 * Get FFmpeg overlay position expressions for a given region.
 * Returns expressions using FFmpeg's built-in variables (main_w, main_h, overlay_w, overlay_h).
 */
export function getOverlayPosition(
  region: OverlayRegion,
  margin: number,
): { x: string; y: string } {
  const m = String(margin)

  switch (region) {
    case 'top-left':
      return { x: m, y: m }
    case 'top-right':
      return { x: `(main_w-overlay_w-${m})`, y: m }
    case 'bottom-left':
      return { x: m, y: `(main_h-overlay_h-${m})` }
    case 'bottom-right':
      return { x: `(main_w-overlay_w-${m})`, y: `(main_h-overlay_h-${m})` }
    case 'center-right':
      return { x: `(main_w-overlay_w-${m})`, y: `((main_h-overlay_h)/2)` }
    case 'center-left':
      return { x: m, y: `((main_h-overlay_h)/2)` }
  }
}

/**
 * Build FFmpeg filter_complex for image overlay compositing.
 * Pure function — no I/O, easy to test.
 *
 * @param overlays - Generated overlays with position and timing info
 * @param videoWidth - Source video width in pixels
 * @param videoHeight - Source video height in pixels
 * @returns FFmpeg filter_complex string
 */
export function buildOverlayFilterComplex(
  overlays: readonly GeneratedOverlay[],
  videoWidth: number,
  videoHeight: number,
): string {
  const margin = Math.round(videoWidth * 0.05)
  const filters: string[] = []

  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i]
    const inputIdx = i + 1 // 0 is the video
    const overlayWidth = Math.round(videoWidth * overlay.opportunity.placement.sizePercent / 100)
    const start = overlay.opportunity.timestampStart
    const end = overlay.opportunity.timestampEnd

    // Scale the image (input is looped via -loop 1 args, so it has a timeline)
    filters.push(`[${inputIdx}:v]scale=${overlayWidth}:-1,format=rgba[img_${i}]`)

    // Overlay with enable window — image appears/disappears at the specified timestamps
    const prev = i === 0 ? '[0:v]' : `[out_${i - 1}]`
    const isLast = i === overlays.length - 1
    const out = isLast ? '[overlaid]' : `[out_${i}]`
    const pos = getOverlayPosition(overlay.opportunity.placement.region, margin)
    filters.push(
      `${prev}[img_${i}]overlay=x=${pos.x}:y=${pos.y}:enable='between(t,${start},${end})':format=auto${out}`,
    )
  }

  // Convert back to yuv420p — overlay with RGBA images produces yuv444p which most players can't decode
  filters.push('[overlaid]format=yuv420p[outv]')

  return filters.join(';')
}

/**
 * Composite image overlays onto a video using FFmpeg.
 *
 * @param videoPath - Source video path
 * @param overlays - Overlays to composite
 * @param outputPath - Output video path
 * @param videoWidth - Source video width
 * @param videoHeight - Source video height
 * @returns Path to the composited video
 */
export async function compositeOverlays(
  videoPath: string,
  overlays: readonly GeneratedOverlay[],
  outputPath: string,
  videoWidth: number,
  videoHeight: number,
): Promise<string> {
  if (overlays.length === 0) {
    throw new Error('[OverlayCompositing] No overlays provided')
  }

  const ffmpegPath = getFFmpegPath()
  const filterComplex = buildOverlayFilterComplex(overlays, videoWidth, videoHeight)

  const args = ['-y', '-i', videoPath]
  for (const overlay of overlays) {
    args.push('-loop', '1', '-i', overlay.imagePath)
  }
  args.push(
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '0:a',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-c:a', 'copy',
    '-shortest',
    outputPath,
  )

  logger.info(`[OverlayCompositing] Compositing ${overlays.length} overlays → ${outputPath}`)

  return new Promise<string>((resolve, reject) => {
    execFileRaw(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`[OverlayCompositing] FFmpeg failed: ${stderr}`)
        reject(new Error(`[OverlayCompositing] FFmpeg overlay compositing failed: ${error.message}`))
        return
      }
      logger.info(`[OverlayCompositing] Complete: ${outputPath}`)
      resolve(outputPath)
    })
  })
}

import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import sharp from 'sharp'
import logger from '../../config/logger'

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Bounding box and metadata for a detected webcam overlay in a screen recording.
 *
 * @property x - Left edge in pixels (original video resolution)
 * @property y - Top edge in pixels (original video resolution)
 * @property width - Width of the webcam region in pixels
 * @property height - Height of the webcam region in pixels
 * @property position - Which corner of the frame the webcam occupies
 * @property confidence - Detection confidence 0–1 (combines skin-tone consistency
 *   across frames with per-frame score strength)
 */
export interface WebcamRegion {
  x: number
  y: number
  width: number
  height: number
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  confidence: number
}

/**
 * Per-frame analysis result for a single corner region.
 *
 * @property skinToneRatio - Fraction of pixels matching the skin-tone heuristic (0–1)
 * @property variance - Average RGB channel variance — high variance means the
 *   region has complex visual content (a face), low variance means a solid
 *   background or static UI element.
 */
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

/** Number of frames sampled evenly across the video for analysis. */
const SAMPLE_FRAMES = 5
/** Width to downscale frames to for fast pixel analysis. */
const ANALYSIS_WIDTH = 320
/** Height to downscale frames to for fast pixel analysis. */
const ANALYSIS_HEIGHT = 180
/** Each corner region is 25% of the frame width/height. */
const CORNER_FRACTION = 0.25
/** Minimum skin-tone pixel ratio to consider a corner as a webcam candidate. */
const MIN_SKIN_RATIO = 0.05
/** Minimum confidence score to accept a webcam detection. */
const MIN_CONFIDENCE = 0.3

// ── Refinement constants ─────────────────────────────────────────────────────

/**
 * Minimum inter-column/row mean difference to accept as a valid overlay edge.
 * The webcam overlay border creates a sharp intensity step between the
 * overlay and the screen content behind it. Values below this threshold
 * are treated as noise or soft gradients.
 */
const REFINE_MIN_EDGE_DIFF = 3.0
/** Webcam must be at least 5% of the frame in each dimension. */
const REFINE_MIN_SIZE_FRAC = 0.05
/** Webcam must be at most 55% of the frame in each dimension. */
const REFINE_MAX_SIZE_FRAC = 0.55

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

// ── Refinement helpers ───────────────────────────────────────────────────────

/**
 * Compute per-column mean grayscale intensity over a horizontal band of rows.
 *
 * Used to find the **vertical edge** of the webcam overlay. Each column gets
 * a single mean brightness value averaged over `yFrom..yTo` rows. The
 * resulting 1-D signal has a sharp step at the overlay boundary, which
 * {@link findPeakDiff} locates.
 *
 * @param data - Raw pixel buffer (RGB or RGBA interleaved)
 * @param width - Image width in pixels
 * @param channels - Bytes per pixel (3 for RGB, 4 for RGBA)
 * @param yFrom - First row (inclusive)
 * @param yTo - Last row (exclusive)
 * @returns Float64Array of length `width` with per-column mean grayscale
 */
function columnMeansForRows(
  data: Buffer, width: number, channels: number,
  yFrom: number, yTo: number,
): Float64Array {
  const means = new Float64Array(width)
  const count = yTo - yFrom
  if (count <= 0) return means
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = yFrom; y < yTo; y++) {
      const idx = (y * width + x) * channels
      sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    }
    means[x] = sum / count
  }
  return means
}

/**
 * Compute per-row mean grayscale intensity over a vertical band of columns.
 *
 * Used to find the **horizontal edge** of the webcam overlay. Each row gets
 * a single mean brightness value averaged over `xFrom..xTo` columns. Works
 * the same way as {@link columnMeansForRows} but rotated 90°.
 *
 * @param data - Raw pixel buffer
 * @param width - Image width in pixels
 * @param channels - Bytes per pixel
 * @param height - Image height in pixels
 * @param xFrom - First column (inclusive)
 * @param xTo - Last column (exclusive)
 * @returns Float64Array of length `height` with per-row mean grayscale
 */
function rowMeansForCols(
  data: Buffer, width: number, channels: number, height: number,
  xFrom: number, xTo: number,
): Float64Array {
  const means = new Float64Array(height)
  const count = xTo - xFrom
  if (count <= 0) return means
  for (let y = 0; y < height; y++) {
    let sum = 0
    for (let x = xFrom; x < xTo; x++) {
      const idx = (y * width + x) * channels
      sum += (data[idx] + data[idx + 1] + data[idx + 2]) / 3
    }
    means[y] = sum / count
  }
  return means
}

/** Element-wise average of Float64Arrays. */
function averageFloat64Arrays(arrays: Float64Array[]): Float64Array {
  if (arrays.length === 0) return new Float64Array(0)
  const len = arrays[0].length
  const result = new Float64Array(len)
  for (const arr of arrays) {
    for (let i = 0; i < len; i++) result[i] += arr[i]
  }
  for (let i = 0; i < len; i++) result[i] /= arrays.length
  return result
}

/**
 * Find the position with the largest intensity step between adjacent elements.
 *
 * "Peak difference" = the index where `|means[i+1] - means[i]|` is maximized
 * within the search range. This corresponds to the webcam overlay's edge,
 * because the overlay border creates a hard brightness transition that
 * persists across all frames, while content-based edges average out.
 *
 * @param means - 1-D array of averaged intensities (from column or row means)
 * @param searchFrom - Start of search range (inclusive)
 * @param searchTo - End of search range (inclusive)
 * @param minDiff - Minimum step magnitude to accept (rejects noise)
 * @returns `{index, magnitude}` — index of the edge, or -1 if no edge exceeds minDiff
 */
export function findPeakDiff(
  means: Float64Array, searchFrom: number, searchTo: number, minDiff: number,
): { index: number; magnitude: number } {
  const lo = Math.max(0, Math.min(searchFrom, searchTo))
  const hi = Math.min(means.length - 1, Math.max(searchFrom, searchTo))
  let maxDiff = 0
  let maxIdx = -1
  for (let i = lo; i < hi; i++) {
    const d = Math.abs(means[i + 1] - means[i])
    if (d > maxDiff) { maxDiff = d; maxIdx = i }
  }
  return maxDiff >= minDiff ? { index: maxIdx, magnitude: maxDiff } : { index: -1, magnitude: maxDiff }
}

/**
 * Refine the webcam bounding box by detecting the overlay's spatial edges.
 *
 * ### Why refinement is needed
 * The coarse phase ({@link detectWebcamRegion}'s corner analysis) only identifies
 * which corner contains a webcam — it uses a fixed 25% region and doesn't know
 * the overlay's exact boundaries. Refinement finds pixel-accurate edges.
 *
 * ### Edge detection algorithm
 * 1. For each sample frame, compute **per-column** and **per-row** mean grayscale
 *    intensities (restricted to the webcam's half of the frame for stronger signal).
 * 2. **Average across all frames** — the overlay border is spatially fixed and
 *    produces a consistent intensity step, while changing video content (slides,
 *    code, etc.) averages out to a smooth gradient. This is the key insight that
 *    makes the approach work without traditional edge detection filters.
 * 3. Use {@link findPeakDiff} to locate the maximum inter-adjacent intensity
 *    difference in the averaged signal — this is the overlay's vertical and
 *    horizontal edge.
 * 4. Sanity-check: the resulting rectangle must be 5–55% of the frame in each
 *    dimension (webcams are never tiny or most of the screen).
 *
 * @param framePaths - Paths to sample frames at analysis resolution (320×180)
 * @param position - Which corner contains the webcam (from coarse phase)
 * @returns Refined bounding box in analysis-resolution coordinates, or null
 *   if no strong edges are found or the result is implausibly sized
 */
export async function refineBoundingBox(
  framePaths: string[],
  position: WebcamRegion['position'],
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (framePaths.length === 0) return null

  const isRight = position.includes('right')
  const isBottom = position.includes('bottom')
  let fw = 0, fh = 0

  const colMeansAll: Float64Array[] = []
  const rowMeansAll: Float64Array[] = []

  for (const fp of framePaths) {
    const { data, info } = await sharp(fp).raw().toBuffer({ resolveWithObject: true })
    fw = info.width; fh = info.height

    // Column means: restrict to rows near the webcam for stronger signal
    const yFrom = isBottom ? Math.floor(fh * 0.35) : 0
    const yTo   = isBottom ? fh : Math.ceil(fh * 0.65)
    colMeansAll.push(columnMeansForRows(data, fw, info.channels, yFrom, yTo))

    // Row means: restrict to columns near the webcam
    const xFrom = isRight ? Math.floor(fw * 0.35) : 0
    const xTo   = isRight ? fw : Math.ceil(fw * 0.65)
    rowMeansAll.push(rowMeansForCols(data, fw, info.channels, fh, xFrom, xTo))
  }

  const avgCols = averageFloat64Arrays(colMeansAll)
  const avgRows = averageFloat64Arrays(rowMeansAll)

  // Search for the inner edge in the relevant portion of the frame
  const xFrom = isRight ? Math.floor(fw * 0.35) : Math.floor(fw * 0.05)
  const xTo   = isRight ? Math.floor(fw * 0.95) : Math.floor(fw * 0.65)
  const xEdge = findPeakDiff(avgCols, xFrom, xTo, REFINE_MIN_EDGE_DIFF)

  const yFrom = isBottom ? Math.floor(fh * 0.35) : Math.floor(fh * 0.05)
  const yTo   = isBottom ? Math.floor(fh * 0.95) : Math.floor(fh * 0.65)
  const yEdge = findPeakDiff(avgRows, yFrom, yTo, REFINE_MIN_EDGE_DIFF)

  if (xEdge.index < 0 || yEdge.index < 0) {
    logger.info(
      `[FaceDetection] Edge refinement: no strong edges ` +
      `(xDiff=${xEdge.magnitude.toFixed(1)}, yDiff=${yEdge.magnitude.toFixed(1)})`,
    )
    return null
  }

  // Build the refined rectangle
  let x: number, y: number, w: number, h: number
  if (isRight) { x = xEdge.index + 1; w = fw - x }
  else         { x = 0; w = xEdge.index }
  if (isBottom) { y = yEdge.index + 1; h = fh - y }
  else          { y = 0; h = yEdge.index }

  // Sanity: webcam should be 5-55% of frame in each dimension
  if (w < fw * REFINE_MIN_SIZE_FRAC || h < fh * REFINE_MIN_SIZE_FRAC ||
      w > fw * REFINE_MAX_SIZE_FRAC || h > fh * REFINE_MAX_SIZE_FRAC) {
    logger.info(
      `[FaceDetection] Refined bounds implausible ` +
      `(${w}x${h} in ${fw}x${fh}), using coarse bounds`,
    )
    return null
  }

  logger.info(
    `[FaceDetection] Refined webcam: (${x},${y}) ${w}x${h} at analysis scale ` +
    `(xDiff=${xEdge.magnitude.toFixed(1)}, yDiff=${yEdge.magnitude.toFixed(1)})`,
  )

  return { x, y, width: w, height: h }
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
 * ### Two-phase approach
 *
 * **Phase 1 — Coarse corner scan:**
 * Samples 5 frames at even intervals across the video and analyzes each of the
 * four corners (25% × 25% regions) for skin-tone pixels and visual variance.
 * A corner with consistent skin-tone presence across multiple frames is likely
 * a webcam overlay. The scoring formula weights skin ratio by variance — webcam
 * corners are visually busy (a moving face), while solid-color UI elements
 * (like a colored status bar) have low variance even if they match skin tones.
 *
 * **Phase 2 — Refined edge detection ({@link refineBoundingBox}):**
 * Once we know which corner, we find the overlay's exact pixel boundaries by
 * looking for persistent intensity edges across frames.
 *
 * All analysis is performed on downscaled frames (320×180) for speed, then
 * results are scaled back to the original video resolution.
 *
 * @param videoPath - Path to the source video file
 * @returns The detected webcam region in original video resolution, or null
 *   if no webcam overlay is found with sufficient confidence
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

    // Refine the bounding box using edge detection, then map to original resolution
    const refined = await refineBoundingBox(framePaths, bestPosition)
    const scaleX = resolution.width / ANALYSIS_WIDTH
    const scaleY = resolution.height / ANALYSIS_HEIGHT

    let origX: number, origY: number, origW: number, origH: number

    if (refined) {
      origX = Math.round(refined.x * scaleX)
      origY = Math.round(refined.y * scaleY)
      origW = Math.round(refined.width * scaleX)
      origH = Math.round(refined.height * scaleY)
    } else {
      // Fall back to coarse 25% corner bounds
      const cornerW = Math.floor(ANALYSIS_WIDTH * CORNER_FRACTION)
      const cornerH = Math.floor(ANALYSIS_HEIGHT * CORNER_FRACTION)
      origW = Math.round(cornerW * scaleX)
      origH = Math.round(cornerH * scaleY)
      switch (bestPosition) {
        case 'top-left':     origX = 0; origY = 0; break
        case 'top-right':    origX = resolution.width - origW; origY = 0; break
        case 'bottom-left':  origX = 0; origY = resolution.height - origH; break
        case 'bottom-right':
          origX = resolution.width - origW
          origY = resolution.height - origH
          break
      }
    }

    const region: WebcamRegion = {
      x: origX,
      y: origY,
      width: origW,
      height: origH,
      position: bestPosition,
      confidence: Math.round(bestConfidence * 100) / 100,
    }

    logger.info(
      `[FaceDetection] Webcam detected at ${region.position} ` +
      `(${region.x},${region.y} ${region.width}x${region.height}) ` +
      `confidence=${region.confidence} refined=${!!refined}`,
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

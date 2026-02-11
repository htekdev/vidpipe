import { execFileRaw } from '../../core/process.js'
import { fileExistsSync, listDirectory, removeFile, removeDirectory, makeTempDir } from '../../core/fileSystem.js'
import { join, modelsDir } from '../../core/paths.js'
import { sharp, ort } from '../../core/media.js'
import { getFFmpegPath, getFFprobePath } from '../../core/ffmpeg.js'
import logger from '../../config/logger'

const ffmpegPath = getFFmpegPath()
const ffprobePath = getFFprobePath()

const MODEL_PATH = join(modelsDir(), 'ultraface-320.onnx')

/** Cached ONNX session — loaded once, reused across calls. */
let cachedSession: ort.InferenceSession | null = null

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

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of frames sampled evenly across the video for analysis. */
const SAMPLE_FRAMES = 5
/** UltraFace model input dimensions. */
const MODEL_WIDTH = 320
const MODEL_HEIGHT = 240
/** Minimum face detection confidence from the ONNX model. */
const MIN_FACE_CONFIDENCE = 0.5
/** Minimum confidence across frames to accept a webcam detection. */
const MIN_DETECTION_CONFIDENCE = 0.3

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
    execFileRaw(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath],
      {},
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
    execFileRaw(
      ffprobePath,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        videoPath,
      ],
      {},
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
  const interval = Math.max(1, Math.floor(duration / (SAMPLE_FRAMES + 1)))

  const timestamps: number[] = []
  for (let i = 1; i <= SAMPLE_FRAMES; i++) {
    timestamps.push(i * interval)
  }

  const framePaths: string[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const framePath = join(tempDir, `frame_${i}.png`)
    framePaths.push(framePath)

    await new Promise<void>((resolve, reject) => {
      execFileRaw(
        ffmpegPath,
        [
          '-y',
          '-ss', timestamps[i].toFixed(2),
          '-i', videoPath,
          '-vf', `scale=${MODEL_WIDTH}:${MODEL_HEIGHT}`,
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

// ── ONNX Face Detection ─────────────────────────────────────────────────────

interface FaceBox {
  x1: number
  y1: number
  x2: number
  y2: number
  confidence: number
}

async function getSession(): Promise<ort.InferenceSession> {
  if (cachedSession) return cachedSession
  if (!fileExistsSync(MODEL_PATH)) {
    throw new Error(`Face detection model not found at ${MODEL_PATH}. Run 'vidpipe doctor' to check dependencies.`)
  }
  cachedSession = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  })
  return cachedSession
}

/**
 * Run UltraFace ONNX model on a frame image. Returns face bounding boxes
 * in normalized coordinates (0-1).
 */
async function detectFacesInFrame(framePath: string): Promise<FaceBox[]> {
  const session = await getSession()

  // Load and preprocess: resize to 320×240, convert to float32 NCHW, normalize to [0,1]
  const { data, info } = await sharp(framePath)
    .resize(MODEL_WIDTH, MODEL_HEIGHT, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = info.width * info.height
  const floatData = new Float32Array(3 * pixels)

  // HWC RGB → NCHW (channel-first), normalize 0-1 with ImageNet mean/std
  const mean = [127, 127, 127]
  const std = 128
  for (let i = 0; i < pixels; i++) {
    floatData[i] = (data[i * 3] - mean[0]) / std             // R
    floatData[pixels + i] = (data[i * 3 + 1] - mean[1]) / std // G
    floatData[2 * pixels + i] = (data[i * 3 + 2] - mean[2]) / std // B
  }

  const inputTensor = new ort.Tensor('float32', floatData, [1, 3, MODEL_HEIGHT, MODEL_WIDTH])
  const results = await session.run({ input: inputTensor })

  const scores = results['scores'].data as Float32Array  // [1, N, 2]
  const boxes = results['boxes'].data as Float32Array     // [1, N, 4]
  const numDetections = scores.length / 2

  const faces: FaceBox[] = []
  for (let i = 0; i < numDetections; i++) {
    const faceScore = scores[i * 2 + 1] // index 1 = face class
    if (faceScore > MIN_FACE_CONFIDENCE) {
      faces.push({
        x1: boxes[i * 4],
        y1: boxes[i * 4 + 1],
        x2: boxes[i * 4 + 2],
        y2: boxes[i * 4 + 3],
        confidence: faceScore,
      })
    }
  }

  return faces
}

/**
 * Determine which corner a face box belongs to. Returns null if the face
 * is in the center of the frame (not a webcam overlay).
 */
function classifyCorner(
  box: FaceBox,
): WebcamRegion['position'] | null {
  const cx = (box.x1 + box.x2) / 2
  const cy = (box.y1 + box.y2) / 2

  // Face center must be in the outer 40% of the frame to be a corner webcam
  const isLeft = cx < 0.4
  const isRight = cx > 0.6
  const isTop = cy < 0.4
  const isBottom = cy > 0.6

  if (isTop && isLeft) return 'top-left'
  if (isTop && isRight) return 'top-right'
  if (isBottom && isLeft) return 'bottom-left'
  if (isBottom && isRight) return 'bottom-right'
  return null // center face — likely full-frame webcam, not an overlay
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
 * per-frame face detections. Higher consistency across frames = more confident.
 */
export function calculateCornerConfidence(scores: number[]): number {
  if (scores.length === 0) return 0
  const nonZeroCount = scores.filter(s => s > 0).length
  const consistency = nonZeroCount / scores.length
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  return consistency * avgScore
}

/**
 * Detect a webcam overlay region in a screen recording using the UltraFace
 * ONNX model for face detection.
 *
 * ### Approach
 * 1. Sample 5 frames evenly across the video
 * 2. Run UltraFace face detection on each frame
 * 3. For each detected face, classify which corner it's in
 * 4. The corner with consistent face detections across frames is the webcam
 * 5. Refine the bounding box using edge detection for exact overlay boundaries
 *
 * @param videoPath - Path to the source video file
 * @returns The detected webcam region in original video resolution, or null
 */
export async function detectWebcamRegion(videoPath: string): Promise<WebcamRegion | null> {
  const tempDir = await makeTempDir('face-detect-')

  try {
    const resolution = await getVideoResolution(videoPath)
    const framePaths = await extractSampleFrames(videoPath, tempDir)

    // Track face detections per corner across all frames
    const cornerScores = new Map<WebcamRegion['position'], number[]>()
    const cornerBoxes = new Map<WebcamRegion['position'], FaceBox[]>()
    for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      cornerScores.set(pos, [])
      cornerBoxes.set(pos, [])
    }

    for (const framePath of framePaths) {
      const faces = await detectFacesInFrame(framePath)

      // Track which corners got a face this frame
      const foundCorners = new Set<WebcamRegion['position']>()

      for (const face of faces) {
        const corner = classifyCorner(face)
        if (corner) {
          foundCorners.add(corner)
          cornerScores.get(corner)!.push(face.confidence)
          cornerBoxes.get(corner)!.push(face)
        }
      }

      // Corners without a face this frame get a 0
      for (const pos of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
        if (!foundCorners.has(pos)) {
          cornerScores.get(pos)!.push(0)
        }
      }
    }

    // Find best corner
    let bestPosition: WebcamRegion['position'] | null = null
    let bestConfidence = 0

    for (const [pos, scores] of cornerScores) {
      const confidence = calculateCornerConfidence(scores)
      logger.debug(`[FaceDetection] Corner ${pos}: confidence=${confidence.toFixed(3)}, scores=[${scores.map(s => s.toFixed(2)).join(',')}]`)
      if (confidence > bestConfidence) {
        bestConfidence = confidence
        bestPosition = pos
      }
    }

    if (!bestPosition || bestConfidence < MIN_DETECTION_CONFIDENCE) {
      logger.info(`[FaceDetection] No webcam region detected (best: ${bestPosition} at ${bestConfidence.toFixed(3)})`)
      return null
    }

    // Compute average face bounding box from model detections
    const boxes = cornerBoxes.get(bestPosition)!
    const avgBox: FaceBox = {
      x1: boxes.reduce((s, b) => s + b.x1, 0) / boxes.length,
      y1: boxes.reduce((s, b) => s + b.y1, 0) / boxes.length,
      x2: boxes.reduce((s, b) => s + b.x2, 0) / boxes.length,
      y2: boxes.reduce((s, b) => s + b.y2, 0) / boxes.length,
      confidence: bestConfidence,
    }

    // Try edge refinement for pixel-accurate webcam overlay boundaries
    const refined = await refineBoundingBox(framePaths, bestPosition)
    const scaleX = resolution.width / MODEL_WIDTH
    const scaleY = resolution.height / MODEL_HEIGHT

    let origX: number, origY: number, origW: number, origH: number

    if (refined) {
      origX = Math.round(refined.x * scaleX)
      origY = Math.round(refined.y * scaleY)
      origW = Math.round(refined.width * scaleX)
      origH = Math.round(refined.height * scaleY)
    } else {
      // Use expanded face bounding box as webcam region estimate
      // Webcam overlay is typically larger than the face (includes some background)
      const expandFactor = 1.4
      const faceCx = (avgBox.x1 + avgBox.x2) / 2
      const faceCy = (avgBox.y1 + avgBox.y2) / 2
      const faceW = (avgBox.x2 - avgBox.x1) * expandFactor
      const faceH = (avgBox.y2 - avgBox.y1) * expandFactor

      origX = Math.max(0, Math.round((faceCx - faceW / 2) * resolution.width))
      origY = Math.max(0, Math.round((faceCy - faceH / 2) * resolution.height))
      origW = Math.min(resolution.width - origX, Math.round(faceW * resolution.width))
      origH = Math.min(resolution.height - origY, Math.round(faceH * resolution.height))
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
    const files = await listDirectory(tempDir).catch(() => [] as string[])
    for (const f of files) {
      await removeFile(join(tempDir, f)).catch(() => {})
    }
    await removeDirectory(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

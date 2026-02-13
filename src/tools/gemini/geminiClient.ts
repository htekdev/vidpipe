/**
 * Gemini Video Understanding Client
 *
 * Uses Google's Gemini API to analyze raw video files and return
 * timestamped editorial direction — cut points, pacing, transitions.
 *
 * Gemini is the only production-ready API that accepts raw video files
 * and returns timestamped analysis without frame extraction.
 */
import { GoogleGenAI, createUserContent, createPartFromUri, createPartFromBase64 } from '@google/genai'
import fs from 'node:fs'
import { getConfig } from '../../config/environment.js'
import logger from '../../config/logger.js'
import { costTracker } from '../../services/costTracker.js'
import { execCommand } from '../../core/process.js'
import { getFFprobePath } from '../../core/ffmpeg.js'


/** Tokens per second of video footage (~263 tokens/s per Gemini docs) */
const VIDEO_TOKENS_PER_SECOND = 263

const EDITORIAL_PROMPT = `You are a professional video editor reviewing raw footage. Analyze this video and write detailed editorial direction in natural language.

Cover these areas with specific timestamps (use MM:SS format):

## Cut Points & Transitions
List every moment where a cut or transition should occur. For each, explain WHY this cut improves the edit and what transition type to use (hard cut, crossfade, dissolve, J-cut, L-cut, jump cut, fade to black).

## Pacing Analysis
Flag sections that are too slow, too fast, or have dead air. Give start/end timestamps and what to do about each issue.

## B-Roll & Graphics Suggestions
Identify moments where text overlays, graphics, zoom-ins, or visual emphasis would improve engagement.

## Hook & Retention
Rate the first 3 seconds (1-10) and suggest specific improvements for viewer retention.

## Content Structure
Break the video into intro/body sections/outro with timestamps and topic for each section.

## Key Moments
Highlight the most engaging, surprising, or important moments that should be emphasized in the edit.

Be specific with timestamps. Be opinionated — say what works and what doesn't. Write as if briefing a human editor.`

/**
 * Upload a video to Gemini and get timestamped editorial direction.
 *
 * @param videoPath - Path to the video file (mp4, webm, mov, etc.)
 * @param durationSeconds - Video duration in seconds (for cost estimation)
 * @param model - Gemini model to use (default: gemini-2.5-flash)
 * @returns Parsed editorial direction
 */
export async function analyzeVideoEditorial(
  videoPath: string,
  durationSeconds: number,
  model: string = 'gemini-2.5-flash',
): Promise<string> {
  const config = getConfig()
  const apiKey = config.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for video editorial analysis. ' +
        'Get a key at https://aistudio.google.com/apikey',
    )
  }

  const ai = new GoogleGenAI({ apiKey })

  logger.info(`[Gemini] Uploading video for editorial analysis: ${videoPath}`)

  // 1. Upload the video file
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: 'video/mp4' },
  })

  if (!file.uri || !file.mimeType || !file.name) {
    throw new Error('Gemini file upload failed — no URI returned')
  }

  // 2. Wait for file to become ACTIVE (Gemini processes uploads async)
  logger.info(`[Gemini] Waiting for file processing to complete...`)
  let fileState = file.state
  while (fileState === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const updated = await ai.files.get({ name: file.name })
    fileState = updated.state
    logger.debug(`[Gemini] File state: ${fileState}`)
  }
  if (fileState !== 'ACTIVE') {
    throw new Error(`Gemini file processing failed — state: ${fileState}`)
  }

  logger.info(`[Gemini] Video ready, requesting editorial analysis (model: ${model})`)

  // 3. Request editorial analysis
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      EDITORIAL_PROMPT,
    ]),
  })

  const text = response.text ?? ''

  if (!text) {
    throw new Error('Gemini returned empty response')
  }

  // 3. Track cost
  const estimatedInputTokens = Math.ceil(durationSeconds * VIDEO_TOKENS_PER_SECOND)
  const estimatedOutputTokens = Math.ceil(text.length / 4) // rough token estimate
  costTracker.recordServiceUsage('gemini', 0, {
    model,
    durationSeconds,
    estimatedInputTokens,
    estimatedOutputTokens,
    videoFile: videoPath,
  })

  logger.info(`[Gemini] Editorial analysis complete (${text.length} chars)`)

  return text
}

// ============================================================================
// IMAGE ELEMENT ANALYSIS
// ============================================================================

/** A detected UI element with its bounding box in pixel coordinates. */
export interface DetectedElement {
  label: string
  x: number
  y: number
  width: number
  height: number
}

const IMAGE_ANALYSIS_PROMPT = `You are a precise visual analysis assistant. Analyze this screenshot and identify all distinct UI elements, text blocks, and interactive regions.

For EACH element, return its bounding box in PIXEL coordinates. The image is IMAGE_WIDTH x IMAGE_HEIGHT pixels.

Return ONLY a JSON array (no markdown fences, no explanation) with this structure:
[
  { "label": "description of element", "x": 100, "y": 200, "width": 300, "height": 50 }
]

Rules:
- Coordinates MUST be in pixels for a IMAGE_WIDTH x IMAGE_HEIGHT image
- x, y = top-left corner of the bounding box
- width, height = size of the bounding box
- x + width must not exceed IMAGE_WIDTH
- y + height must not exceed IMAGE_HEIGHT
- Be PRECISE — the box should tightly fit the element
- Include: text blocks, buttons, panels, terminal output, code regions, webcam overlays, menus, tabs, icons
- Label each element descriptively (e.g., "terminal output showing git status", "VS Code editor tab bar")
- If a query is provided, prioritize elements matching the query but still include other notable elements`

/**
 * Get image dimensions using FFprobe.
 */
async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const ffprobePath = getFFprobePath()
  const args = [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    imagePath,
  ]

  const { stdout } = await execCommand(ffprobePath, args, { timeout: 10000 })
  const data = JSON.parse(stdout)
  const stream = data.streams?.[0] ?? {}

  return {
    width: stream.width ?? 0,
    height: stream.height ?? 0,
  }
}

/**
 * Analyze an image to detect UI elements and return their bounding boxes.
 *
 * @param imagePath - Path to the image file (JPEG or PNG)
 * @param query - Optional: specific elements to look for
 * @param model - Gemini model to use (default: gemini-2.5-flash)
 * @returns Array of detected elements with pixel-coordinate bounding boxes
 */
export async function analyzeImageElements(
  imagePath: string,
  query?: string,
  model: string = 'gemini-2.5-flash',
): Promise<DetectedElement[]> {
  const config = getConfig()
  const apiKey = config.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for image element analysis. ' +
        'Get a key at https://aistudio.google.com/apikey',
    )
  }

  const ai = new GoogleGenAI({ apiKey })

  logger.info(`[Gemini] Analyzing image elements: ${imagePath}`)

  // Get actual image dimensions so we can tell Gemini and validate results
  const { width: imgWidth, height: imgHeight } = await getImageDimensions(imagePath)
  logger.info(`[Gemini] Image dimensions: ${imgWidth}x${imgHeight}`)

  // Read image as base64
  const imageBuffer = fs.readFileSync(imagePath)
  const base64 = imageBuffer.toString('base64')
  const ext = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'

  const imagePart = createPartFromBase64(base64, ext)

  // Build prompt with actual dimensions baked in
  let prompt = IMAGE_ANALYSIS_PROMPT
    .replace(/IMAGE_WIDTH/g, String(imgWidth))
    .replace(/IMAGE_HEIGHT/g, String(imgHeight))
  if (query) {
    prompt += `\n\nSpecific query: "${query}" — prioritize elements related to this query.`
  }

  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([imagePart, prompt]),
  })

  const text = response.text ?? ''

  if (!text) {
    throw new Error('Gemini returned empty response for image analysis')
  }

  logger.debug(`[Gemini] Raw response: ${text}`)

  // Parse the JSON array from response (strip markdown fences if present)
  const jsonStr = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()

  let elements: DetectedElement[]
  try {
    elements = JSON.parse(jsonStr)
  } catch {
    logger.warn(`[Gemini] Failed to parse element JSON, raw text: ${text.slice(0, 200)}`)
    throw new Error(`Failed to parse Gemini element detection response as JSON`)
  }

  // Validate structure
  elements = elements.filter(
    e =>
      typeof e.label === 'string' &&
      typeof e.x === 'number' &&
      typeof e.y === 'number' &&
      typeof e.width === 'number' &&
      typeof e.height === 'number',
  )

  // Detect if Gemini returned coordinates in a normalized/smaller space and rescale.
  // Gemini often returns coords in a [0, 1000] normalized space regardless of prompt.
  if (imgWidth > 0 && imgHeight > 0 && elements.length > 0) {
    const maxX = Math.max(...elements.map(e => e.x + e.width))
    const maxY = Math.max(...elements.map(e => e.y + e.height))

    // If all coordinates fit within ~1000 but the image is much larger,
    // Gemini likely returned normalized [0, 1000] coordinates
    if (maxX <= 1050 && maxY <= 1050 && (imgWidth > 1500 || imgHeight > 1500)) {
      logger.info(`[Gemini] Detected normalized coords (max extent: ${maxX}x${maxY}), rescaling to ${imgWidth}x${imgHeight}`)
      const scaleX = imgWidth / 1000
      const scaleY = imgHeight / 1000
      elements = elements.map(e => ({
        ...e,
        x: Math.round(e.x * scaleX),
        y: Math.round(e.y * scaleY),
        width: Math.round(e.width * scaleX),
        height: Math.round(e.height * scaleY),
      }))
    }
  }

  logger.info(`[Gemini] Detected ${elements.length} elements`)

  return elements
}

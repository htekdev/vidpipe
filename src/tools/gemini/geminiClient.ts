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
import path from 'node:path'
import os from 'node:os'
import { getConfig } from '../../config/environment.js'
import logger from '../../config/logger.js'
import { costTracker } from '../../services/costTracker.js'
import { execCommand } from '../../core/process.js'
import { getFFprobePath } from '../../core/ffmpeg.js'
import { sharp } from '../../core/media.js'


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

const GRID_SPACING = 100

const IMAGE_ANALYSIS_PROMPT = `You are a precise visual analysis assistant. This screenshot has a coordinate grid overlay:
- RED vertical lines with X-axis pixel labels (at top and bottom edges)
- BLUE horizontal lines with Y-axis pixel labels (at left and right edges)
- Grid lines are spaced every ${GRID_SPACING}px. Major lines (every ${GRID_SPACING * 2}px) are thicker.
- Each grid line is labeled with its exact pixel coordinate in a black box.

CRITICAL: Use the grid lines as ANCHORS to determine exact pixel positions.
- For example, if an element's left edge aligns with the red line labeled "400", its x coordinate is 400.
- If an element sits between grid lines labeled "200" and "300", estimate proportionally (e.g., 240 if it's about 40% of the way).
- ALWAYS cross-reference both X and Y grid lines to triangulate each corner.

The image is IMAGE_WIDTH x IMAGE_HEIGHT pixels.

Return ONLY a JSON array (no markdown fences, no explanation) with this structure:
[
  { "label": "description of element", "x": 100, "y": 200, "width": 300, "height": 50 }
]

Rules:
- x, y = top-left corner of the bounding box, determined by nearest grid lines
- width, height = size of the bounding box
- x + width must not exceed IMAGE_WIDTH
- y + height must not exceed IMAGE_HEIGHT
- VERIFY each coordinate against the visible grid lines before returning
- Be PRECISE — the box should tightly fit the element
- Include: text blocks, buttons, panels, terminal output, code regions, webcam overlays, menus, tabs, icons
- Label each element descriptively (e.g., "terminal output showing git status", "VS Code editor tab bar")
- If a query is provided, prioritize elements matching the query but still include other notable elements`

/**
 * Overlay a coordinate grid on an image for Gemini reference.
 * Returns the path to a temporary gridded image.
 */
async function overlayGrid(imagePath: string, spacing: number): Promise<string> {
  const meta = await sharp(imagePath).metadata()
  const w = meta.width!, h = meta.height!
  const fontSize = 16
  const bgPad = 4

  const lines: string[] = []
  const labels: string[] = []

  for (let x = 0; x <= w; x += spacing) {
    const isMajor = x % (spacing * 2) === 0
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,0,0,${isMajor ? 0.7 : 0.4})" stroke-width="${isMajor ? 2 : 1}"/>`)
    const labelText = String(x)
    const labelW = labelText.length * (fontSize * 0.6) + bgPad * 2
    labels.push(`<rect x="${x + 1}" y="0" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${x + bgPad + 1}" y="${fontSize}" font-size="${fontSize}" fill="#FF6666" font-family="monospace" font-weight="bold">${labelText}</text>`)
    labels.push(`<rect x="${x + 1}" y="${h - fontSize - bgPad}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${x + bgPad + 1}" y="${h - bgPad}" font-size="${fontSize}" fill="#FF6666" font-family="monospace" font-weight="bold">${labelText}</text>`)
  }

  for (let y = 0; y <= h; y += spacing) {
    const isMajor = y % (spacing * 2) === 0
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(0,100,255,${isMajor ? 0.7 : 0.4})" stroke-width="${isMajor ? 2 : 1}"/>`)
    const labelText = String(y)
    const labelW = labelText.length * (fontSize * 0.6) + bgPad * 2
    labels.push(`<rect x="0" y="${y + 1}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${bgPad}" y="${y + fontSize + 1}" font-size="${fontSize}" fill="#6699FF" font-family="monospace" font-weight="bold">${labelText}</text>`)
    labels.push(`<rect x="${w - labelW}" y="${y + 1}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${w - labelW + bgPad}" y="${y + fontSize + 1}" font-size="${fontSize}" fill="#6699FF" font-family="monospace" font-weight="bold">${labelText}</text>`)
  }

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${lines.join('\n')}${labels.join('\n')}</svg>`
  )

  const gridPath = path.join(os.tmpdir(), `grid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`)
  await sharp(imagePath)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(gridPath)

  return gridPath
}

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

  // Overlay coordinate grid for better spatial accuracy
  const gridPath = await overlayGrid(imagePath, GRID_SPACING)
  logger.info(`[Gemini] Grid overlay created: ${gridPath}`)

  // Read gridded image as base64
  const imageBuffer = fs.readFileSync(gridPath)
  const base64 = imageBuffer.toString('base64')
  const ext = 'image/jpeg'

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

  // Clamp coordinates to image bounds
  elements = elements.map(e => ({
    ...e,
    x: Math.max(0, Math.round(e.x)),
    y: Math.max(0, Math.round(e.y)),
    width: Math.round(Math.min(e.width, imgWidth - Math.max(0, e.x))),
    height: Math.round(Math.min(e.height, imgHeight - Math.max(0, e.y))),
  }))

  // Clean up temp grid file
  try { fs.unlinkSync(gridPath) } catch { /* ignore */ }

  logger.info(`[Gemini] Detected ${elements.length} elements`)

  return elements
}

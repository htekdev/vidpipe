/**
 * Test: Gemini bounding box accuracy using a coordinate grid overlay.
 *
 * Draws a labeled pixel-coordinate grid on the frame BEFORE sending to Gemini,
 * giving the LLM visual reference points for more precise bounding boxes.
 *
 * Usage: npx tsx test-gemini-bbox-grid.ts
 */
import { captureFrame } from './src/tools/agentTools.js'
import { getConfig } from './src/config/environment.js'
import { setVerbose } from './src/config/logger.js'
import sharp from 'sharp'
import path from 'path'
import fs from 'node:fs'
import { execSync } from 'child_process'
import { GoogleGenAI, createUserContent, createPartFromBase64 } from '@google/genai'

setVerbose()

const config = getConfig()
if (!config.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env')
  process.exit(1)
}

const GRID_SPACING = 100 // pixels between grid lines

/**
 * Draw a coordinate grid overlay on an image.
 * Returns path to the gridded image.
 */
async function drawGrid(imagePath: string, spacing: number): Promise<string> {
  const meta = await sharp(imagePath).metadata()
  const w = meta.width!, h = meta.height!

  const lines: string[] = []
  const labels: string[] = []

  const fontSize = 16
  const bgPad = 4

  // Vertical lines + X labels at top and bottom
  for (let x = 0; x <= w; x += spacing) {
    const isMajor = x % (spacing * 2) === 0
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,0,0,${isMajor ? 0.7 : 0.4})" stroke-width="${isMajor ? 2 : 1}"/>`)
    // Label background + text at top
    const labelText = String(x)
    const labelW = labelText.length * (fontSize * 0.6) + bgPad * 2
    labels.push(`<rect x="${x + 1}" y="0" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${x + bgPad + 1}" y="${fontSize}" font-size="${fontSize}" fill="#FF6666" font-family="monospace" font-weight="bold">${labelText}</text>`)
    // Label at bottom
    labels.push(`<rect x="${x + 1}" y="${h - fontSize - bgPad}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${x + bgPad + 1}" y="${h - bgPad}" font-size="${fontSize}" fill="#FF6666" font-family="monospace" font-weight="bold">${labelText}</text>`)
  }

  // Horizontal lines + Y labels at left and right
  for (let y = 0; y <= h; y += spacing) {
    const isMajor = y % (spacing * 2) === 0
    lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(0,100,255,${isMajor ? 0.7 : 0.4})" stroke-width="${isMajor ? 2 : 1}"/>`)
    const labelText = String(y)
    const labelW = labelText.length * (fontSize * 0.6) + bgPad * 2
    // Label at left
    labels.push(`<rect x="0" y="${y + 1}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${bgPad}" y="${y + fontSize + 1}" font-size="${fontSize}" fill="#6699FF" font-family="monospace" font-weight="bold">${labelText}</text>`)
    // Label at right
    labels.push(`<rect x="${w - labelW}" y="${y + 1}" width="${labelW}" height="${fontSize + bgPad}" fill="rgba(0,0,0,0.7)" rx="2"/>`)
    labels.push(`<text x="${w - labelW + bgPad}" y="${y + fontSize + 1}" font-size="${fontSize}" fill="#6699FF" font-family="monospace" font-weight="bold">${labelText}</text>`)
  }

  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${lines.join('\n')}${labels.join('\n')}</svg>`
  )

  const gridPath = imagePath.replace(/\.(png|jpg|jpeg)$/i, '-grid.$1')
  await sharp(imagePath)
    .composite([{ input: svg, top: 0, left: 0 }])
    .toFile(gridPath)

  return gridPath
}

interface DetectedElement {
  label: string
  x: number
  y: number
  width: number
  height: number
}

const GRID_PROMPT = `You are a precise visual analysis assistant. This screenshot has a coordinate grid overlay:
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
  { "label": "description", "x": 100, "y": 200, "width": 300, "height": 50 }
]

Rules:
- x, y = top-left corner of the bounding box, determined by nearest grid lines
- width, height = size of the bounding box
- x + width must not exceed IMAGE_WIDTH
- y + height must not exceed IMAGE_HEIGHT
- VERIFY each coordinate against the visible grid lines before returning
- Include: application windows, panels, sidebar, editor, terminal, webcam overlay, taskbar, text blocks, buttons`

// ─── Main ──────────────────────────────────────────────────────────────────────

// Use the screenshot directly instead of extracting from video
const screenshotPath = 'C:\\Users\\floreshector\\Pictures\\Screenshots\\Screenshot 2026-02-13 141056.png'

console.log('=== Gemini BBox Grid Reference Test ===\n')

// Use screenshot directly
console.log(`Using screenshot: ${screenshotPath}`)
const meta = await sharp(screenshotPath).metadata()
const imgW = meta.width!, imgH = meta.height!
console.log(`Image: ${imgW}x${imgH}`)

// Draw grid
console.log(`Drawing ${GRID_SPACING}px coordinate grid...`)
const gridPath = await drawGrid(screenshotPath, GRID_SPACING)
console.log(`Grid image: ${gridPath}`)

// Open grid image so user can see it
const gridCopy = path.resolve('C:\\Repos\\htekdev\\video-auto-note-taker', 'test-bbox-grid-input.jpg')
fs.copyFileSync(gridPath, gridCopy)

// Send gridded image to Gemini
console.log('\nSending gridded image to Gemini...')
const ai = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY })

const imageBuffer = fs.readFileSync(gridPath)
const base64 = imageBuffer.toString('base64')
const ext = gridPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
const imagePart = createPartFromBase64(base64, ext)

const prompt = GRID_PROMPT
  .replace(/IMAGE_WIDTH/g, String(imgW))
  .replace(/IMAGE_HEIGHT/g, String(imgH))

const start = Date.now()
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: createUserContent([imagePart, prompt]),
})
const elapsed = ((Date.now() - start) / 1000).toFixed(1)

const text = response.text ?? ''
console.log(`Response received in ${elapsed}s`)
console.log(`\nRaw response:\n${text}\n`)

// Parse response
const jsonStr = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
let elements: DetectedElement[]
try {
  elements = JSON.parse(jsonStr)
} catch {
  console.error('Failed to parse JSON response')
  process.exit(1)
}

elements = elements.filter(
  e => typeof e.label === 'string' && typeof e.x === 'number' &&
    typeof e.y === 'number' && typeof e.width === 'number' && typeof e.height === 'number'
)

console.log(`Found ${elements.length} elements\n`)

// Validate
let outOfBounds = 0
for (const el of elements) {
  if (el.x < 0 || el.y < 0 || el.x + el.width > imgW + 10 || el.y + el.height > imgH + 10) outOfBounds++
  const pctW = ((el.width / imgW) * 100).toFixed(0)
  const pctH = ((el.height / imgH) * 100).toFixed(0)
  console.log(`  "${el.label}"`)
  console.log(`    → [${el.x}, ${el.y}] ${el.width}x${el.height} (${pctW}%x${pctH}% of screen)`)
}
if (outOfBounds > 0) console.log(`\n⚠ ${outOfBounds} elements out of bounds`)

// Draw boxes on ORIGINAL image (not gridded) for clean comparison
const COLORS = [
  '#FF4444', '#44FF44', '#4444FF', '#FFAA00', '#FF44FF',
  '#44FFFF', '#FF8800', '#8844FF', '#44FF88', '#FF4488',
]

const rects = elements.map((el, i) => {
  const color = COLORS[i % COLORS.length]
  const label = el.label.length > 50 ? el.label.slice(0, 47) + '...' : el.label
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const labelW = Math.min(esc.length * 7.5 + 12, el.width + 100)
  return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="3"/>` +
    `<rect x="${el.x}" y="${Math.max(el.y - 22, 0)}" width="${labelW}" height="22" fill="${color}" opacity="0.85" rx="2"/>` +
    `<text x="${el.x + 4}" y="${Math.max(el.y - 5, 16)}" font-size="13" fill="white" font-weight="bold" font-family="sans-serif">${esc}</text>`
}).join('\n')

const svg = Buffer.from(
  `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
)

const outputPath = path.resolve('C:\\Repos\\htekdev\\video-auto-note-taker', 'test-bbox-grid-result.jpg')
await sharp(screenshotPath)
  .composite([{ input: svg, top: 0, left: 0 }])
  .toFile(outputPath)

console.log(`\n📸 Grid input: ${gridCopy}`)
console.log(`📸 Result with boxes: ${outputPath}`)

// Also create a version with BOTH grid AND boxes for direct comparison
const bothPath = path.resolve('C:\\Repos\\htekdev\\video-auto-note-taker', 'test-bbox-grid-both.jpg')
await sharp(gridPath)
  .composite([{ input: svg, top: 0, left: 0 }])
  .toFile(bothPath)
console.log(`📸 Grid + boxes overlay: ${bothPath}`)

// Open results
try {
  execSync(`start "" "${outputPath}"`, { stdio: 'ignore' })
  execSync(`start "" "${bothPath}"`, { stdio: 'ignore' })
} catch { /* ignore */ }

console.log('\n=== Done ===')

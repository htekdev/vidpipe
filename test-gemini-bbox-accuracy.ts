/**
 * Test: Verify Gemini bounding box accuracy on a screen recording frame.
 *
 * Captures a frame, sends to Gemini with multiple queries, draws boxes,
 * then opens the annotated image for visual inspection.
 *
 * Usage: npx tsx test-gemini-bbox-accuracy.ts
 */
import { captureFrame, drawRegions } from './src/tools/agentTools.js'
import { analyzeImageElements, type DetectedElement } from './src/tools/gemini/geminiClient.js'
import { getConfig } from './src/config/environment.js'
import { setVerbose } from './src/config/logger.js'
import sharp from 'sharp'
import path from 'path'
import { execSync } from 'child_process'

setVerbose()

const config = getConfig()
if (!config.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env')
  process.exit(1)
}

// Pick most recent recording
const videoDir = 'recordings/bandicam-2026-02-10-18-37-56-001'

const TESTS = [
  {
    timestamp: 5,
    queries: [
      {
        name: 'no-query',
        query: undefined,
        description: 'No query — find ALL elements',
      },
      {
        name: 'windows',
        query: 'Identify all distinct application windows, panels, and panes visible on screen. Include: sidebar panels, editor panels, terminal/output panels, chat panels, title bars, status bars, taskbar.',
        description: 'Window-level regions only',
      },
      {
        name: 'specific',
        query: 'terminal output, build status, file explorer sidebar, editor tabs',
        description: 'Specific elements by description',
      },
    ],
  },
]

console.log('=== Gemini Bounding Box Accuracy Test ===\n')

for (const test of TESTS) {
  console.log(`\nCapturing frame at ${test.timestamp}s from ${videoDir}...`)
  const videoFile = path.resolve(videoDir, 'bandicam-2026-02-10-18-37-56-001.mp4')
  const frame = await captureFrame(videoFile, test.timestamp)
  const meta = await sharp(frame.imagePath).metadata()
  console.log(`Frame: ${meta.width}x${meta.height}\n`)

  for (const q of test.queries) {
    console.log(`${'─'.repeat(60)}`)
    console.log(`TEST: ${q.description}`)
    console.log(`Query: ${q.query ?? '(none)'}`)
    console.log(`${'─'.repeat(60)}`)

    const start = Date.now()
    let elements: DetectedElement[]
    try {
      elements = await analyzeImageElements(frame.imagePath, q.query)
    } catch (err) {
      console.error(`  ❌ Failed: ${err instanceof Error ? err.message : err}`)
      continue
    }
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`  Found ${elements.length} elements in ${elapsed}s`)

    // Validate coordinates are reasonable
    const imgW = meta.width!, imgH = meta.height!
    let outOfBounds = 0
    let tooSmall = 0
    let tooLarge = 0

    for (const el of elements) {
      const right = el.x + el.width
      const bottom = el.y + el.height
      if (el.x < 0 || el.y < 0 || right > imgW + 10 || bottom > imgH + 10) outOfBounds++
      if (el.width < 5 || el.height < 5) tooSmall++
      if (el.width > imgW * 0.95 && el.height > imgH * 0.95) tooLarge++
    }

    console.log(`  Validation:`)
    console.log(`    ✓ In-bounds: ${elements.length - outOfBounds}/${elements.length}`)
    if (outOfBounds > 0) console.log(`    ✗ Out-of-bounds: ${outOfBounds}`)
    if (tooSmall > 0) console.log(`    ⚠ Too small (<5px): ${tooSmall}`)
    if (tooLarge > 0) console.log(`    ⚠ Full-screen (>95%): ${tooLarge}`)

    // Print all elements
    console.log(`\n  Elements:`)
    for (const el of elements) {
      const pctW = ((el.width / imgW) * 100).toFixed(0)
      const pctH = ((el.height / imgH) * 100).toFixed(0)
      console.log(`    "${el.label}"`)
      console.log(`      → [${el.x}, ${el.y}] ${el.width}x${el.height} (${pctW}%x${pctH}% of screen)`)
    }

    // Draw bounding boxes and open
    if (elements.length > 0) {
      const outputPath = frame.imagePath.replace(/\.(png|jpg)$/i, `-${q.name}.$1`)
      
      // Use sharp to draw SVG overlay (same approach as our earlier tests)
      const COLORS = [
        '#FF4444', '#44FF44', '#4444FF', '#FFAA00', '#FF44FF',
        '#44FFFF', '#FF8800', '#8844FF', '#44FF88', '#FF4488',
      ]

      const rects = elements.map((el, i) => {
        const color = COLORS[i % COLORS.length]
        const label = el.label.length > 40 ? el.label.slice(0, 37) + '...' : el.label
        const escapedLabel = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        const labelW = Math.min(escapedLabel.length * 8 + 12, el.width)
        return `<rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="3"/>` +
          `<rect x="${el.x}" y="${Math.max(el.y - 20, 0)}" width="${labelW}" height="20" fill="${color}" opacity="0.85" rx="2"/>` +
          `<text x="${el.x + 4}" y="${Math.max(el.y - 5, 14)}" font-size="12" fill="white" font-weight="bold" font-family="sans-serif">${escapedLabel}</text>`
      }).join('\n')

      const svg = Buffer.from(
        `<svg width="${imgW}" height="${imgH}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
      )

      await sharp(frame.imagePath)
        .composite([{ input: svg, top: 0, left: 0 }])
        .toFile(outputPath)

      console.log(`\n  📸 Annotated: ${outputPath}`)

      // Open it
      try {
        execSync(`start "" "${path.resolve(outputPath)}"`, { stdio: 'ignore' })
      } catch { /* ignore */ }
    }

    console.log('')
  }
}

console.log('\n=== Test Complete ===')
console.log('Review the opened images to verify bounding box accuracy.')
console.log('Key things to check:')
console.log('  1. Do boxes tightly fit the actual elements?')
console.log('  2. Are coordinates in pixel space (not normalized 0-1000)?')
console.log('  3. Does the "windows" query find panels vs individual buttons?')

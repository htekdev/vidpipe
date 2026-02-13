/**
 * PoC: Gemini bounding box detection on video frames.
 *
 * Captures frames at key timestamps mentioned in the editorial direction,
 * sends them to Gemini for element detection, then draws the returned
 * bounding boxes on the frame for visual verification.
 *
 * Usage: npx tsx test-gemini-bbox.ts [video-dir]
 */
import { MainVideoAsset } from './src/assets/MainVideoAsset.js'
import { setVerbose } from './src/config/logger.js'
import { getConfig } from './src/config/environment.js'
import { captureFrame, drawRegions } from './src/tools/agentTools.js'
import { analyzeImageElements } from './src/tools/gemini/geminiClient.js'

setVerbose()

const videoDir = process.argv[2] || 'recordings/bandicam-2026-02-10-18-37-56-001'

console.log('=== Gemini Bounding Box Detection PoC ===\n')

const config = getConfig()
if (!config.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env — cannot run test.')
  process.exit(1)
}

// Timestamps from the editorial direction where specific elements are mentioned
const testCases = [
  {
    timestamp: 16,
    query: 'repository memories, preToolUse hook, npm run push, terminal output',
    description: 'Repository memories overriding git push (00:16)',
  },
  {
    timestamp: 50,
    query: 'typecheck, tests, coverage, build, CodeQL, Copilot review, CI polling, quality gates',
    description: 'Quality gates explanation (00:50)',
  },
  {
    timestamp: 81,
    query: 'CodeQL security alerts, unresolved Copilot review threads, failures, 13 security alerts',
    description: 'Pipeline failure results (01:21)',
  },
]

try {
  console.log(`Loading video from: ${videoDir}`)
  const video = await MainVideoAsset.load(videoDir)
  const metadata = await video.getMetadata()
  console.log(`  Resolution: ${metadata.width}x${metadata.height}`)
  console.log(`  Duration: ${metadata.duration}s\n`)

  for (const tc of testCases) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Test: ${tc.description}`)
    console.log(`Timestamp: ${tc.timestamp}s`)
    console.log(`Query: ${tc.query}`)
    console.log('='.repeat(60))

    // 1. Capture frame
    console.log('\n1. Capturing frame...')
    const frame = await captureFrame(video.videoPath, tc.timestamp)
    console.log(`   Frame: ${frame.imagePath}`)

    // 2. Send to Gemini for element detection
    console.log('\n2. Analyzing with Gemini...')
    const start = Date.now()
    const elements = await analyzeImageElements(frame.imagePath, tc.query)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`   Found ${elements.length} elements in ${elapsed}s`)

    // 3. Print detected elements
    console.log('\n3. Detected elements:')
    for (const el of elements) {
      console.log(`   - "${el.label}" → x=${el.x}, y=${el.y}, ${el.width}x${el.height}`)
    }

    // 4. Draw bounding boxes on the frame
    if (elements.length > 0) {
      console.log('\n4. Drawing bounding boxes...')
      const annotated = await drawRegions(
        frame.imagePath,
        elements.map((el, i) => ({
          x: el.x,
          y: el.y,
          width: el.width,
          height: el.height,
          label: el.label.slice(0, 30),
        })),
      )
      console.log(`   Annotated: ${annotated.imagePath}`)
    }
  }

  console.log('\n\n=== PoC Complete ===')
  console.log('Check the annotated images above to verify bounding box accuracy.')

} catch (error) {
  console.error('\n=== Error ===')
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
}

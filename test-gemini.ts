/**
 * Test script for Gemini editorial direction integration.
 * 
 * Usage: npx tsx test-gemini.ts [video-dir]
 * 
 * If no video-dir is provided, uses a default test recording.
 * Tests the full flow: upload video → Gemini analysis → parsed editorial direction.
 */
import { MainVideoAsset } from './src/assets/MainVideoAsset.js'
import { setVerbose } from './src/config/logger.js'
import { getConfig } from './src/config/environment.js'

setVerbose()

const videoDir = process.argv[2] || 'recordings/bandicam-2026-02-10-18-37-56-001'

console.log('=== Gemini Editorial Direction Test ===\n')

// Check API key
const config = getConfig()
if (!config.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env — cannot run test.')
  process.exit(1)
}
console.log(`GEMINI_API_KEY: [REDACTED - ${config.GEMINI_API_KEY.length} characters]`)

try {
  // Load existing video
  console.log(`\nLoading video from: ${videoDir}`)
  const video = await MainVideoAsset.load(videoDir)

  console.log(`  Slug: ${video.slug}`)
  console.log(`  Path: ${video.videoPath}`)

  // Get metadata for duration
  const metadata = await video.getMetadata()
  console.log(`  Duration: ${metadata.duration}s`)
  console.log(`  Resolution: ${metadata.width}x${metadata.height}`)

  // Run editorial direction (force re-generate to test the API call)
  console.log(`\n=== Calling Gemini API ===\n`)
  const start = Date.now()
  const direction = await video.getEditorialDirection({ force: true })
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  if (!direction) {
    console.error('getEditorialDirection() returned null — key may not be configured correctly.')
    process.exit(1)
  }

  console.log(`\nAnalysis complete in ${elapsed}s\n`)

  // Print the markdown editorial direction
  console.log(`=== Editorial Direction ===\n`)
  console.log(direction)

  console.log(`\n=== Saved to ===`)
  console.log(`  ${video.editorialDirectionPath}`)

} catch (error) {
  console.error('\n=== Error ===')
  console.error(error instanceof Error ? error.stack : String(error))
  process.exit(1)
}

/**
 * Test script for ProducerAgent using the new VideoAsset architecture.
 * 
 * Usage: npx tsx test-producer.ts [video-dir]
 * 
 * If no video-dir is provided, uses a default test recording.
 */
import { MainVideoAsset } from './src/assets/MainVideoAsset.js'
import { setVerbose } from './src/config/logger.js'

setVerbose()

const videoDir = process.argv[2] || 'recordings/bandicam-2026-02-10-18-37-56-001'

console.log('=== ProducerAgent Test (VideoAsset Architecture) ===\n')
console.log(`Loading video from: ${videoDir}`)

try {
  // Load existing video using the new VideoAsset pattern
  const video = await MainVideoAsset.load(videoDir)
  
  console.log(`\nVideo loaded:`)
  console.log(`  Slug: ${video.slug}`)
  console.log(`  Path: ${video.videoPath}`)
  
  // Get layout (webcam detection)
  console.log(`\nDetecting layout...`)
  const layout = await video.getLayout()
  console.log(`  Dimensions: ${layout.width}x${layout.height}`)
  console.log(`  Webcam: ${layout.webcam ? `${layout.webcam.position} (${layout.webcam.confidence})` : 'not detected'}`)
  
  // Ensure we have transcript and chapters
  console.log(`\nLoading transcript...`)
  const transcript = await video.getTranscript()
  console.log(`  Duration: ${transcript.duration}s`)
  console.log(`  Segments: ${transcript.segments.length}`)
  
  console.log(`\nLoading chapters...`)
  const chapters = await video.getChapters()
  console.log(`  Chapters: ${chapters.length}`)
  
  // Run the producer to create the final video
  console.log(`\n=== Running ProducerAgent ===\n`)
  const producedPath = await video.getProducedVideo({force: true}, '9:16')
  
  console.log(`\n=== Result ===`)
  console.log(`Produced video: ${producedPath}`)
  
} catch (error) {
  console.error('\n=== Error ===')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

/**
 * Isolate shorts generation for debugging.
 *
 * Loads real data from a recording folder and calls generateShorts()
 * so you can iterate on the ShortsAgent without running the full pipeline.
 *
 * Usage: npx tsx test-shorts.ts [recording-dir]
 */
import { readJsonFile, readTextFile, fileExists } from './src/core/fileSystem.js'
import { join } from './src/core/paths.js'
import { generateShorts } from './src/agents/ShortsAgent.js'
import { writeJsonFile } from './src/core/fileSystem.js'
import logger from './src/config/logger.js'
import type { Transcript, VideoFile, VideoLayout, WebcamRegion } from './src/types/index.js'

const recordingDir = process.argv[2] || 'recordings/bandicam-2026-02-17-14-30-03-313'
const slug = recordingDir.split('/').pop()!

console.log('=== Shorts Generation Test ===\n')
console.log(`Recording dir: ${recordingDir}`)

// 1. Load transcript (edited-fixed has corrected word timestamps)
const transcriptPath = join(recordingDir, 'transcript-edited-fixed.json')
if (!(await fileExists(transcriptPath))) {
  console.error(`Transcript not found: ${transcriptPath}`)
  process.exit(1)
}
const transcript = await readJsonFile<Transcript>(transcriptPath)
console.log(`Transcript: ${transcript.segments.length} segments, ${transcript.duration.toFixed(1)}s`)

// 2. Load optional clip direction
const clipDirectionPath = join(recordingDir, 'clip-direction.md')
let clipDirection: string | undefined
if (await fileExists(clipDirectionPath)) {
  clipDirection = await readTextFile(clipDirectionPath)
  console.log(`Clip direction: loaded (${clipDirection.length} chars)`)
} else {
  console.log('Clip direction: not found, skipping')
}

// 3. Load optional layout for webcam region
const layoutPath = join(recordingDir, 'layout.json')
let webcamOverride: WebcamRegion | null = null
if (await fileExists(layoutPath)) {
  const layout = await readJsonFile<VideoLayout>(layoutPath)
  webcamOverride = layout.webcam
  console.log(`Layout: loaded, webcam=${webcamOverride ? 'detected' : 'none'}`)
} else {
  console.log('Layout: not found, skipping')
}

// 4. Build VideoFile pointing to the edited video
const videoFilename = `${slug}-edited.mp4`
const video: VideoFile = {
  filename: videoFilename,
  repoPath: join(recordingDir, videoFilename),
  videoDir: recordingDir,
  slug: slug,
  originalPath: join(recordingDir, `${slug}.mp4`),
  duration: transcript.duration,
  size: 0,
  createdAt: new Date(),
}

console.log(`\nVideo: ${video.repoPath}`)
console.log('\n--- Running generateShorts() ---\n')

// 5. Generate shorts
const shorts = await generateShorts(
  video,
  transcript,
  undefined,
  clipDirection,
  webcamOverride,
)

// 6. Log results
console.log(`\n=== Results: ${shorts.length} shorts planned ===\n`)
for (const short of shorts) {
  console.log(`[${short.id}] ${short.title}`)
  console.log(`  Duration: ${short.totalDuration.toFixed(1)}s`)
  console.log(`  Segments: ${short.segments.length}`)
  console.log(`  Tags: ${short.tags.join(', ')}`)
  if (short.hook) console.log(`  Hook: ${short.hook}`)
  console.log()
}

// 7. Save results
const outputPath = join(recordingDir, 'test-shorts-result.json')
await writeJsonFile(outputPath, shorts)
console.log(`Results saved to: ${outputPath}`)

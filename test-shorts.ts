/**
 * Isolate shorts generation for debugging.
 *
 * Transcribes the edited video fresh, then runs generateShorts().
 * All logs piped to the recording folder.
 *
 * Usage: npx tsx test-shorts.ts [recording-dir]
 */
import { readJsonFile, readTextFile, fileExists, writeJsonFile } from './src/core/fileSystem.js'
import { join } from './src/core/paths.js'
import { generateShorts } from './src/agents/ShortsAgent.js'
import { transcribeVideo } from './src/services/transcription.js'
import { pushPipe, popPipe } from './src/core/logger.js'
import type { Transcript, VideoFile, VideoLayout, WebcamRegion } from './src/types/index.js'

const recordingDir = process.argv[2] || 'recordings/bandicam-2026-02-17-14-30-03-313'
const slug = recordingDir.split('/').pop()!

pushPipe(recordingDir)

console.log('=== Shorts Generation Test ===\n')
console.log(`Recording dir: ${recordingDir}`)

// 1. Transcribe the edited video fresh
const editedVideoFilename = `${slug}-edited.mp4`
const editedVideoPath = join(recordingDir, editedVideoFilename)
if (!(await fileExists(editedVideoPath))) {
  console.error(`Edited video not found: ${editedVideoPath}`)
  process.exit(1)
}

const video: VideoFile = {
  filename: editedVideoFilename,
  repoPath: editedVideoPath,
  videoDir: recordingDir,
  slug: slug,
  originalPath: join(recordingDir, `${slug}.mp4`),
  duration: 0,
  size: 0,
  createdAt: new Date(),
}

console.log(`Transcribing: ${editedVideoPath}`)
const transcript = await transcribeVideo(video)
console.log(`Transcript: ${transcript.segments.length} segments, ${transcript.duration.toFixed(1)}s`)
await writeJsonFile(join(recordingDir, 'transcript-edited-fresh.json'), transcript)
console.log('Saved: transcript-edited-fresh.json')

// 2. Load optional clip direction
const clipDirectionPath = join(recordingDir, 'clip-direction.md')
let clipDirection: string | undefined
if (await fileExists(clipDirectionPath)) {
  clipDirection = await readTextFile(clipDirectionPath)
  console.log(`Clip direction: loaded (${clipDirection.length} chars)`)
}

// 3. Load optional layout for webcam region
const layoutPath = join(recordingDir, 'layout.json')
let webcamOverride: WebcamRegion | null = null
if (await fileExists(layoutPath)) {
  const layout = await readJsonFile<VideoLayout>(layoutPath)
  webcamOverride = layout.webcam
  console.log(`Layout: loaded, webcam=${webcamOverride ? 'detected' : 'none'}`)
}

// 4. Update video duration from transcript
video.duration = transcript.duration

console.log('\n--- Running generateShorts() ---\n')

try {
  const shorts = await generateShorts(
    video,
    transcript,
    undefined,
    clipDirection,
    webcamOverride,
  )

  console.log(`\n=== Results: ${shorts.length} shorts generated ===\n`)
  for (const short of shorts) {
    console.log(`[${short.id}] ${short.title}`)
    console.log(`  Duration: ${short.totalDuration.toFixed(1)}s`)
    console.log(`  Segments: ${short.segments.length}`)
    console.log(`  Tags: ${short.tags.join(', ')}`)
    if (short.hook) console.log(`  Hook: ${short.hook}`)
    console.log()
  }

  const outputPath = join(recordingDir, 'test-shorts-result.json')
  await writeJsonFile(outputPath, shorts)
  console.log(`Results saved to: ${outputPath}`)
} finally {
  popPipe()
}

/**
 * Test script to verify adjustTranscript produces correct word-level timestamps.
 *
 * Compares the adjusted (mathematically shifted) transcript against a fresh
 * Whisper transcription of the edited video to check for timestamp drift.
 *
 * Usage: npx tsx test-transcript-drift.ts [recording-dir]
 */
import { readTextFile, writeTextFile, fileExists } from './src/core/fileSystem.js'
import { join } from './src/core/paths.js'
import { extractAudio } from './src/tools/ffmpeg/audioExtraction.js'
import { transcribeAudio } from './src/tools/whisper/whisperClient.js'
import type { Transcript } from './src/types/index.js'

const recordingDir = process.argv[2] || 'recordings/bandicam-2026-02-17-14-30-03-313'
const slug = recordingDir.split(/[/\\]/).pop()!
const editedVideo = join(recordingDir, `${slug}-edited.mp4`)
const adjustedPath = join(recordingDir, 'transcript-edited.json')
const freshPath = join(recordingDir, 'transcript-edited-fresh.json')

if (!(await fileExists(adjustedPath))) {
  console.error(`Adjusted transcript not found: ${adjustedPath}`)
  process.exit(1)
}

if (!(await fileExists(editedVideo))) {
  console.error(`Edited video not found: ${editedVideo}`)
  process.exit(1)
}

console.log('=== Transcript Drift Test ===\n')

// 1. Load adjusted transcript
const adjusted: Transcript = JSON.parse(await readTextFile(adjustedPath))
console.log(`Adjusted transcript: ${adjusted.segments.length} segments, duration=${adjusted.duration.toFixed(1)}s`)

// 2. Generate fresh transcript from edited video (or load cached)
let fresh: Transcript
if (await fileExists(freshPath)) {
  console.log(`Loading cached fresh transcript: ${freshPath}`)
  fresh = JSON.parse(await readTextFile(freshPath))
} else {
  console.log(`Transcribing edited video: ${editedVideo}`)
  const audioOut = join('cache', 'drift-test-audio.mp3')
  await extractAudio(editedVideo, audioOut)
  fresh = await transcribeAudio(audioOut)
  await writeTextFile(freshPath, JSON.stringify(fresh, null, 2))
  console.log(`Fresh transcript saved: ${freshPath}`)
}
console.log(`Fresh transcript: ${fresh.segments.length} segments, duration=${fresh.duration.toFixed(1)}s`)

// 3. Compare durations
console.log(`\n--- Duration ---`)
console.log(`Adjusted: ${adjusted.duration.toFixed(2)}s`)
console.log(`Fresh:    ${fresh.duration.toFixed(2)}s`)
console.log(`Drift:    ${Math.abs(adjusted.duration - fresh.duration).toFixed(2)}s`)

// 4. Compare word timestamps at various points
console.log(`\n--- Word-level comparison (segment words) ---`)
const checkpoints = [0, 5, 10, 20, 50, 100, 200, 300]
for (const idx of checkpoints) {
  if (idx >= adjusted.segments.length || idx >= fresh.segments.length) break

  const adjSeg = adjusted.segments[idx]
  const freshSeg = fresh.segments[idx]

  const segDrift = Math.abs(adjSeg.start - freshSeg.start)
  const segStatus = segDrift < 2 ? '✅' : segDrift < 5 ? '⚠️' : '❌'

  console.log(`\nSegment ${idx}: ${segStatus} drift=${segDrift.toFixed(2)}s`)
  console.log(`  Adjusted: ${adjSeg.start.toFixed(2)}-${adjSeg.end.toFixed(2)} "${adjSeg.text.substring(0, 60)}"`)
  console.log(`  Fresh:    ${freshSeg.start.toFixed(2)}-${freshSeg.end.toFixed(2)} "${freshSeg.text.substring(0, 60)}"`)

  // Check nested word timestamps
  if (adjSeg.words.length > 0) {
    const firstWord = adjSeg.words[0]
    const wordDrift = Math.abs(firstWord.start - adjSeg.start)
    if (wordDrift > 5) {
      console.log(`  ❌ WORD DRIFT: first word "${firstWord.word}" starts at ${firstWord.start.toFixed(2)} but segment starts at ${adjSeg.start.toFixed(2)} (drift=${wordDrift.toFixed(2)}s)`)
    }
  }
}

// 5. Check for the specific bug: segment.words not adjusted
console.log(`\n--- Bug check: are segment.words timestamps adjusted? ---`)
const seg0 = adjusted.segments[0]
const topWord0 = adjusted.words[0]
const nestedWord0 = seg0?.words[0]

if (seg0 && topWord0 && nestedWord0) {
  console.log(`Segment[0].start:       ${seg0.start.toFixed(2)}s`)
  console.log(`Top-level words[0]:     ${topWord0.start.toFixed(2)}s - "${topWord0.word}"`)
  console.log(`Segment[0].words[0]:    ${nestedWord0.start.toFixed(2)}s - "${nestedWord0.word}"`)

  if (Math.abs(topWord0.start - nestedWord0.start) > 0.1) {
    console.log(`\n❌ BUG CONFIRMED: top-level words are adjusted but segment.words are NOT!`)
    console.log(`   Top-level word start: ${topWord0.start.toFixed(2)}s`)
    console.log(`   Nested word start:    ${nestedWord0.start.toFixed(2)}s`)
    console.log(`   This causes shorts to reference wrong timestamps.`)
  } else {
    console.log(`\n✅ Both top-level and nested word timestamps are consistent.`)
  }
}

console.log('\n=== Done ===')

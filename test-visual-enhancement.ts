/**
 * Quick iteration script for testing the visual enhancement stage.
 *
 * Usage:
 *   npx tsx test-visual-enhancement.ts <video-path> [--skip-transcribe] [--skip-gemini] [--skip-images]
 *
 * Flags:
 *   --skip-transcribe  Reuse cached transcript from a previous run
 *   --skip-gemini      Reuse cached enhancement opportunities
 *   --skip-images      Reuse cached overlay images, only re-run FFmpeg compositing
 *
 * Output lands in a sibling folder: {video-dir}/{slug}-enhance-test/
 */
import { resolve, join, basename, extname, dirname } from './src/core/paths.js'
import { fileExistsSync, readTextFileSync, writeTextFileSync, ensureDirectorySync } from './src/core/fileSystem.js'
import { initConfig } from './src/config/environment.js'
import { setVerbose } from './src/config/logger.js'
import logger from './src/config/logger.js'
import { ffprobe } from './src/core/ffmpeg.js'
import { transcribeVideo } from './src/services/transcription.js'
import { analyzeVideoForEnhancements } from './src/tools/gemini/geminiClient.js'
import { generateEnhancementImages } from './src/agents/GraphicsAgent.js'
import { compositeOverlays } from './src/tools/ffmpeg/overlayCompositing.js'
import { costTracker } from './src/services/costTracker.js'
import type { Transcript, VideoFile, GeneratedOverlay } from './src/types/index.js'

// ── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const videoArg = args.find(a => !a.startsWith('--'))

if (!videoArg) {
  console.error('Usage: npx tsx test-visual-enhancement.ts <video-path> [--skip-transcribe] [--skip-gemini] [--skip-images]')
  process.exit(1)
}

const videoPath = resolve(videoArg)
if (!fileExistsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`)
  process.exit(1)
}

const skipTranscribe = flags.has('--skip-transcribe')
const skipGemini = flags.has('--skip-gemini')
const skipImages = flags.has('--skip-images')

// ── Setup ───────────────────────────────────────────────────────────────────

initConfig({ verbose: true })
setVerbose()
costTracker.reset()

const slug = basename(videoPath, extname(videoPath)).replace(/\s+/g, '-').toLowerCase()
const workDir = join(dirname(videoPath), `${slug}-enhance-test`)
const enhancementsDir = join(workDir, 'enhancements')
const transcriptPath = join(workDir, 'transcript.json')
const opportunitiesPath = join(enhancementsDir, 'opportunities.json')
const overlaysPath = join(enhancementsDir, 'overlays.json')
const outputPath = join(workDir, `${slug}-enhanced.mp4`)

ensureDirectorySync(enhancementsDir)

async function main(): Promise<void> {
  const start = Date.now()
  console.log(`\n🎬  Visual Enhancement Test`)
  console.log(`   Video:  ${videoPath}`)
  console.log(`   Work:   ${workDir}`)
  console.log(`   Flags:  ${Array.from(flags).join(' ') || '(none)'}\n`)

  // ── 1. Probe video ──────────────────────────────────────────────────────

  console.log('📐 Probing video dimensions...')
  const probe = await ffprobe(videoPath)
  const videoStream = probe.streams.find(s => s.codec_type === 'video')
  const videoWidth = videoStream?.width ?? 1920
  const videoHeight = videoStream?.height ?? 1080
  const duration = Number(probe.format.duration) || 0
  console.log(`   ${videoWidth}x${videoHeight}, ${duration.toFixed(1)}s\n`)

  // ── 2. Transcribe ───────────────────────────────────────────────────────

  let transcript: Transcript
  if (skipTranscribe && fileExistsSync(transcriptPath)) {
    console.log('⏩ Reusing cached transcript')
    transcript = JSON.parse(readTextFileSync(transcriptPath)) as Transcript
  } else {
    console.log('🎤 Transcribing video (Whisper)...')
    const video: VideoFile = {
      originalPath: videoPath,
      repoPath: videoPath,
      videoDir: workDir,
      slug,
      filename: basename(videoPath),
      duration,
      size: 0,
      createdAt: new Date(),
    }
    transcript = await transcribeVideo(video)
    writeTextFileSync(transcriptPath, JSON.stringify(transcript, null, 2))
    console.log(`   ${transcript.segments.length} segments, ${transcript.words.length} words`)
  }
  console.log(`   Transcript: "${transcript.text.substring(0, 120)}..."\n`)

  // ── 3. Gemini enhancement analysis ──────────────────────────────────────

  let enhancementReport: string
  if (skipGemini && fileExistsSync(opportunitiesPath)) {
    console.log('⏩ Reusing cached enhancement report')
    enhancementReport = readTextFileSync(opportunitiesPath)
  } else {
    console.log('🔍 Analyzing video for enhancement opportunities (Gemini)...')
    enhancementReport = await analyzeVideoForEnhancements(videoPath, duration, transcript.text)
    writeTextFileSync(opportunitiesPath, enhancementReport)
  }

  if (!enhancementReport || enhancementReport.trim().length === 0) {
    console.log('   ❌ No enhancement report generated — nothing to do')
    process.exit(0)
  }

  console.log(`   Report length: ${enhancementReport.length} chars`)
  console.log(`   Preview: "${enhancementReport.substring(0, 200)}..."`)
  console.log()

  // ── 4. Generate images (GraphicsAgent) ──────────────────────────────────

  let overlays: GeneratedOverlay[]
  if (skipImages && fileExistsSync(overlaysPath)) {
    console.log('⏩ Reusing cached overlay images')
    overlays = JSON.parse(readTextFileSync(overlaysPath)) as GeneratedOverlay[]
    const missing = overlays.filter(o => !fileExistsSync(o.imagePath))
    if (missing.length > 0) {
      console.error(`   ⚠️  ${missing.length} cached images missing — re-run without --skip-images`)
      process.exit(1)
    }
  } else {
    console.log('🎨 GraphicsAgent making editorial decisions and generating images...')
    overlays = await generateEnhancementImages(enhancementReport, enhancementsDir, duration)
    writeTextFileSync(overlaysPath, JSON.stringify(overlays, null, 2))
  }

  if (overlays.length === 0) {
    console.log('   ❌ No images generated — nothing to composite')
    process.exit(0)
  }

  console.log(`   Generated ${overlays.length} images:`)
  for (const o of overlays) {
    console.log(`     ${basename(o.imagePath)}  →  ${o.opportunity.timestampStart.toFixed(1)}s–${o.opportunity.timestampEnd.toFixed(1)}s`)
  }
  console.log()

  // ── 5. Composite overlays (FFmpeg) ──────────────────────────────────────

  console.log('🎥 Compositing overlays onto video (FFmpeg)...')
  const enhancedPath = await compositeOverlays(videoPath, overlays, outputPath, videoWidth, videoHeight)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✅ Done in ${elapsed}s`)
  console.log(`   Enhanced video: ${enhancedPath}`)
  console.log(`   Cost report:\n${costTracker.formatReport()}`)

  console.log(`\n💡 Re-run tips:`)
  console.log(`   Skip transcription:  npx tsx test-visual-enhancement.ts "${videoArg}" --skip-transcribe`)
  console.log(`   Skip Gemini too:     npx tsx test-visual-enhancement.ts "${videoArg}" --skip-transcribe --skip-gemini`)
  console.log(`   Only re-composite:   npx tsx test-visual-enhancement.ts "${videoArg}" --skip-transcribe --skip-gemini --skip-images`)
}

main().catch(err => {
  logger.error('Test script failed', err)
  console.error('💥 Failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})

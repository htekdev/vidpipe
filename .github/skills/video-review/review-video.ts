/**
 * Video Review Script — Gemini-powered video inspection
 *
 * Usage: npx tsx .github/skills/video-review/review-video.ts <video-path> [prompt]
 */
import 'dotenv/config'
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'

const DEFAULT_PROMPT = `Describe everything you see in this video in detail. Cover:
- Visual layout (what's on screen, positioning of elements)
- Text/captions visible (readability, positioning, any overlap with content)
- Any overlays, graphics, or generated images
- Video quality (resolution feel, compression artifacts, encoding issues)
- Pacing and flow (any jarring cuts, awkward transitions, dead air)
- Anything that looks wrong, glitchy, or could be improved

Be specific with timestamps (MM:SS format). Be opinionated — call out issues directly.`

async function main(): Promise<void> {
  const [videoArg, customPrompt] = process.argv.slice(2)

  if (!videoArg) {
    console.error('Usage: npx tsx review-video.ts <video-path> [prompt]')
    process.exit(1)
  }

  const videoPath = resolve(videoArg)

  if (!existsSync(videoPath)) {
    console.error(`Video not found: ${videoPath}`)
    process.exit(1)
  }

  const stats = statSync(videoPath)
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(1)

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is required.')
    console.error('Get a key at https://aistudio.google.com/apikey')
    process.exit(1)
  }

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-pro'
  const prompt = customPrompt ?? DEFAULT_PROMPT

  console.error(`📹 Reviewing: ${videoPath} (${sizeMB}MB)`)
  console.error(`🤖 Model: ${model}`)
  console.error(`💬 Prompt: ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`)
  console.error('')

  const ai = new GoogleGenAI({ apiKey })

  // Upload video
  console.error('⬆️  Uploading video to Gemini...')
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: 'video/mp4' },
  })

  if (!file.uri || !file.mimeType || !file.name) {
    console.error('❌ Upload failed — no URI returned')
    process.exit(1)
  }

  // Wait for processing
  console.error('⏳ Waiting for video processing...')
  let fileState = file.state
  while (fileState === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const updated = await ai.files.get({ name: file.name })
    fileState = updated.state
  }

  if (fileState !== 'ACTIVE') {
    console.error(`❌ Video processing failed — state: ${fileState}`)
    process.exit(1)
  }

  // Generate analysis
  console.error('🔍 Analyzing video...')
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      prompt,
    ]),
  })

  const text = response.text ?? ''

  if (!text) {
    console.error('❌ Gemini returned empty response')
    process.exit(1)
  }

  // Output analysis to stdout (status messages go to stderr)
  console.log(text)
  console.error('')
  console.error(`✅ Analysis complete (${text.length} chars)`)
}

main().catch((err) => {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})

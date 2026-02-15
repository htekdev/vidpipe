/**
 * Gemini Video Understanding Client
 *
 * Uses Google's Gemini API to analyze raw video files and return
 * timestamped editorial direction — cut points, pacing, transitions.
 *
 * Gemini is the only production-ready API that accepts raw video files
 * and returns timestamped analysis without frame extraction.
 */
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai'
import { getConfig } from '../../config/environment.js'
import logger from '../../config/logger.js'
import { costTracker } from '../../services/costTracker.js'
import type { EnhancementOpportunity } from '../../types/index.js'


/** Tokens per second of video footage (~263 tokens/s per Gemini docs) */
const VIDEO_TOKENS_PER_SECOND = 263

const EDITORIAL_PROMPT = `You are a professional video editor reviewing raw footage. Analyze this video and write detailed editorial direction in natural language.

Cover these areas with specific timestamps (use MM:SS format):

## Cut Points & Transitions
List every moment where a cut or transition should occur. For each, explain WHY this cut improves the edit and what transition type to use (hard cut, crossfade, dissolve, J-cut, L-cut, jump cut, fade to black).

## Pacing Analysis
Flag sections that are too slow, too fast, or have dead air. Give start/end timestamps and what to do about each issue.

## B-Roll & Graphics Suggestions
Identify moments where text overlays, graphics, zoom-ins, or visual emphasis would improve engagement.

## Hook & Retention
Rate the first 3 seconds (1-10) and suggest specific improvements for viewer retention.

## Content Structure
Break the video into intro/body sections/outro with timestamps and topic for each section.

## Key Moments
Highlight the most engaging, surprising, or important moments that should be emphasized in the edit.

## Cleaning Recommendations
Identify sections that should be trimmed or removed entirely to produce a tighter edit. For each:
- Give start/end timestamps (MM:SS format)
- Explain why it should be removed (dead air, filler words, false starts, repeated explanations, off-topic tangents, excessive pauses)
- Rate the confidence (high/medium/low) — high means definitely remove, low means optional

## Hook Snippets for Short Videos
Identify the 3-5 best moments (3-8 seconds each) that could serve as attention-grabbing hooks for the beginning of short-form videos. For each:
- Give start/end timestamps
- Transcribe the exact words spoken (or describe the visual action)
- Explain why this would grab a viewer's attention in the first 3 seconds
- Rate hook strength (1-10)

## Short Video Suggestions
Identify 3-8 potential short clips (15-60 seconds each) that would work well as standalone short-form content (TikTok, YouTube Shorts, Instagram Reels). For each:
- Give start/end timestamps
- Suggest a title (5-10 words)
- Describe the topic/moment and why it works as a standalone clip
- Note if it could be a composite (multiple non-contiguous segments edited together)
- Rate viral potential (1-10)

## Medium Clip Suggestions
Identify 2-4 potential medium-length clips (60-180 seconds) that cover complete topics or narrative arcs. For each:
- Give start/end timestamps (can be multiple segments for composites)
- Suggest a title (5-12 words)
- Describe the topic arc and why this stands alone as complete content
- Suggest a hook line or concept for the opening
- Note key moments within the clip that should be emphasized

Be specific with timestamps. Be opinionated — say what works and what doesn't. Write as if briefing a human editor who will both clean the video AND extract clips from it.`

const CLIP_DIRECTION_PROMPT = `You are a social media content strategist analyzing an edited video to identify the best clips for short-form and medium-form content.

This video has already been cleaned (dead air and filler removed). Analyze it and provide detailed direction for clip extraction.

## Short Video Direction (15-60 seconds each)
For each recommended short clip, provide:
- **Timestamps**: Exact start and end (MM:SS format)
- **Title**: Catchy title for the clip (5-10 words)
- **Hook**: The opening line or visual that grabs attention — transcribe exact words if spoken
- **Topic**: What this clip is about in one sentence
- **Platform fit**: Which platforms this works best for (TikTok, YouTube Shorts, Instagram Reels) and why
- **Engagement potential**: Rate 1-10 with brief justification
- **Composite option**: If combining multiple segments would make a stronger clip, list all segment timestamps
- **Tags**: 3-5 relevant hashtag suggestions

Identify 3-8 shorts. Prioritize: surprising insights, emotional peaks, controversial takes, practical tips, funny moments, and "aha" moments.

## Medium Clip Direction (60-180 seconds each)
For each recommended medium clip, provide:
- **Timestamps**: Exact start and end (MM:SS format) — can be multiple segments for composites
- **Title**: Descriptive title (5-12 words)
- **Hook**: Opening concept or line to grab attention
- **Topic arc**: How the narrative flows from start to end
- **Key moments**: Specific timestamps within the clip that should be emphasized (zoom, text overlay)
- **Standalone score**: Rate 1-10 how well this works without watching the full video
- **Tags**: 3-6 relevant hashtag suggestions

Identify 2-4 medium clips. Prioritize: complete explanations, tutorial segments, deep dives, and compelling narrative arcs.

Be precise with timestamps. Be opinionated about what works and what doesn't. Think about what would make someone stop scrolling.`

/**
 * Upload a video to Gemini and get timestamped editorial direction.
 *
 * @param videoPath - Path to the video file (mp4, webm, mov, etc.)
 * @param durationSeconds - Video duration in seconds (for cost estimation)
 * @param model - Gemini model to use (default: gemini-2.5-flash)
 * @returns Parsed editorial direction
 */
export async function analyzeVideoEditorial(
  videoPath: string,
  durationSeconds: number,
  model: string = 'gemini-2.5-flash',
): Promise<string> {
  const config = getConfig()
  const apiKey = config.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for video editorial analysis. ' +
        'Get a key at https://aistudio.google.com/apikey',
    )
  }

  const ai = new GoogleGenAI({ apiKey })

  logger.info(`[Gemini] Uploading video for editorial analysis: ${videoPath}`)

  // 1. Upload the video file
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: 'video/mp4' },
  })

  if (!file.uri || !file.mimeType || !file.name) {
    throw new Error('Gemini file upload failed — no URI returned')
  }

  // 2. Wait for file to become ACTIVE (Gemini processes uploads async)
  logger.info(`[Gemini] Waiting for file processing to complete...`)
  let fileState = file.state
  while (fileState === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const updated = await ai.files.get({ name: file.name })
    fileState = updated.state
    logger.debug(`[Gemini] File state: ${fileState}`)
  }
  if (fileState !== 'ACTIVE') {
    throw new Error(`Gemini file processing failed — state: ${fileState}`)
  }

  logger.info(`[Gemini] Video ready, requesting editorial analysis (model: ${model})`)

  // 3. Request editorial analysis
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      EDITORIAL_PROMPT,
    ]),
  })

  const text = response.text ?? ''

  if (!text) {
    throw new Error('Gemini returned empty response')
  }

  // 3. Track cost
  const estimatedInputTokens = Math.ceil(durationSeconds * VIDEO_TOKENS_PER_SECOND)
  const estimatedOutputTokens = Math.ceil(text.length / 4) // rough token estimate
  costTracker.recordServiceUsage('gemini', 0, {
    model,
    durationSeconds,
    estimatedInputTokens,
    estimatedOutputTokens,
    videoFile: videoPath,
  })

  logger.info(`[Gemini] Editorial analysis complete (${text.length} chars)`)

  return text
}

/**
 * Upload a video to Gemini and get clip direction for shorts and medium clips.
 *
 * @param videoPath - Path to the cleaned video file (mp4, webm, mov, etc.)
 * @param durationSeconds - Video duration in seconds (for cost estimation)
 * @param model - Gemini model to use (default: gemini-2.5-flash)
 * @returns Clip direction as markdown text
 */
export async function analyzeVideoClipDirection(
  videoPath: string,
  durationSeconds: number,
  model: string = 'gemini-2.5-flash',
): Promise<string> {
  const config = getConfig()
  const apiKey = config.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for video clip direction analysis. ' +
        'Get a key at https://aistudio.google.com/apikey',
    )
  }

  const ai = new GoogleGenAI({ apiKey })

  logger.info(`[Gemini] Uploading video for clip direction analysis: ${videoPath}`)

  // 1. Upload the video file
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: 'video/mp4' },
  })

  if (!file.uri || !file.mimeType || !file.name) {
    throw new Error('Gemini file upload failed — no URI returned')
  }

  // 2. Wait for file to become ACTIVE (Gemini processes uploads async)
  logger.info(`[Gemini] Waiting for file processing to complete...`)
  let fileState = file.state
  while (fileState === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const updated = await ai.files.get({ name: file.name })
    fileState = updated.state
    logger.debug(`[Gemini] File state: ${fileState}`)
  }
  if (fileState !== 'ACTIVE') {
    throw new Error(`Gemini file processing failed — state: ${fileState}`)
  }

  logger.info(`[Gemini] Video ready, requesting clip direction analysis (model: ${model})`)

  // 3. Request clip direction analysis
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      CLIP_DIRECTION_PROMPT,
    ]),
  })

  const text = response.text ?? ''

  if (!text) {
    throw new Error('Gemini returned empty response')
  }

  // 4. Track cost
  const estimatedInputTokens = Math.ceil(durationSeconds * VIDEO_TOKENS_PER_SECOND)
  const estimatedOutputTokens = Math.ceil(text.length / 4) // rough token estimate
  costTracker.recordServiceUsage('gemini', 0, {
    model,
    durationSeconds,
    estimatedInputTokens,
    estimatedOutputTokens,
    videoFile: videoPath,
  })

  logger.info(`[Gemini] Clip direction analysis complete (${text.length} chars)`)

  return text
}

const ENHANCEMENT_ANALYSIS_PROMPT = `You are a visual content strategist analyzing a video to identify moments where an AI-generated image overlay would enhance viewer comprehension.

The speaker's transcript is provided below for context. Your job is to find moments where:
1. The speaker explains an abstract concept (architecture, workflow, algorithm) that would benefit from a diagram or illustration
2. The speaker references something not visible on screen
3. The speaker is teaching a concept where a visual metaphor would help retention
4. The screen is showing something generic (terminal, text editor) while discussing something visual

Do NOT suggest images when:
- The screen already shows relevant visual content (diagrams, UI, demos)
- The speaker is doing a live demonstration that viewers need to see clearly
- The moment is too brief (< 5 seconds) for an overlay to register
- The topic is too simple to need visual aid

Analyze the video layout to determine safe overlay placement:
- If a webcam overlay is visible, note its position and avoid it
- Prefer placing images in areas with less visual activity
- Consider the main content area (code editor, terminal, browser) and avoid obscuring it

Return a JSON array of enhancement opportunities. Each object must have:
- timestampStart: number (seconds from video start)
- timestampEnd: number (seconds, when to stop showing — typically 5-12 seconds after start)
- topic: string (what the speaker is explaining)
- imagePrompt: string (detailed prompt for AI image generation — describe the image to create)
- reason: string (why this visual aid helps the viewer)
- placement: { region: string (one of: "top-left", "top-right", "bottom-left", "bottom-right", "center-right", "center-left"), avoidAreas: string[] (e.g. ["webcam", "code-editor"]), sizePercent: number (15-30, percentage of video width) }
- confidence: number (0.0-1.0, how confident this enhancement is valuable)

Return ONLY the JSON array, no markdown fences, no explanation. Identify 3-8 opportunities maximum.
If no good opportunities exist, return an empty array [].

TRANSCRIPT:
`

/**
 * Upload a video to Gemini and identify moments where AI-generated image
 * overlays would enhance viewer comprehension.
 *
 * @param videoPath - Path to the video file (mp4, webm, mov, etc.)
 * @param durationSeconds - Video duration in seconds (for cost estimation)
 * @param transcript - Full transcript text for context
 * @param model - Gemini model to use (default: gemini-2.5-flash)
 * @returns Filtered array of enhancement opportunities
 */
export async function analyzeVideoForEnhancements(
  videoPath: string,
  durationSeconds: number,
  transcript: string,
  model: string = 'gemini-2.5-flash',
): Promise<EnhancementOpportunity[]> {
  const config = getConfig()
  const apiKey = config.GEMINI_API_KEY

  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is required for video enhancement analysis. ' +
        'Get a key at https://aistudio.google.com/apikey',
    )
  }

  const ai = new GoogleGenAI({ apiKey })

  logger.info(`[Gemini] Uploading video for enhancement analysis: ${videoPath}`)

  // 1. Upload the video file
  const file = await ai.files.upload({
    file: videoPath,
    config: { mimeType: 'video/mp4' },
  })

  if (!file.uri || !file.mimeType || !file.name) {
    throw new Error('Gemini file upload failed — no URI returned')
  }

  // 2. Wait for file to become ACTIVE (Gemini processes uploads async)
  logger.info(`[Gemini] Waiting for file processing to complete...`)
  let fileState = file.state
  while (fileState === 'PROCESSING') {
    await new Promise(resolve => setTimeout(resolve, 2000))
    const updated = await ai.files.get({ name: file.name })
    fileState = updated.state
    logger.debug(`[Gemini] File state: ${fileState}`)
  }
  if (fileState !== 'ACTIVE') {
    throw new Error(`Gemini file processing failed — state: ${fileState}`)
  }

  logger.info(`[Gemini] Video ready, requesting enhancement analysis (model: ${model})`)

  // 3. Request enhancement analysis with video + transcript
  const response = await ai.models.generateContent({
    model,
    contents: createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      ENHANCEMENT_ANALYSIS_PROMPT + transcript,
    ]),
  })

  const text = response.text ?? ''

  if (!text) {
    throw new Error('Gemini returned empty response')
  }

  // 4. Track cost
  const estimatedInputTokens = Math.ceil(durationSeconds * VIDEO_TOKENS_PER_SECOND)
  const estimatedOutputTokens = Math.ceil(text.length / 4) // rough token estimate
  costTracker.recordServiceUsage('gemini', 0, {
    model,
    durationSeconds,
    estimatedInputTokens,
    estimatedOutputTokens,
    videoFile: videoPath,
  })

  logger.info(`[Gemini] Enhancement analysis complete (${text.length} chars)`)

  // Parse JSON response
  let opportunities: EnhancementOpportunity[]
  try {
    // Strip markdown fences if Gemini adds them despite instructions
    const cleaned = text.replace(/^```(?:json)?\n?/gm, '').replace(/\n?```$/gm, '').trim()
    opportunities = JSON.parse(cleaned) as EnhancementOpportunity[]
  } catch {
    logger.warn('[Gemini] Failed to parse enhancement analysis as JSON, returning empty')
    return []
  }

  // Filter by confidence threshold
  opportunities = opportunities.filter(o => o.confidence >= 0.7)

  // Cap at 8
  opportunities = opportunities.slice(0, 8)

  // Ensure minimum 10s gap between consecutive overlays
  const filtered: EnhancementOpportunity[] = []
  for (const opp of opportunities) {
    const lastEnd = filtered.length > 0 ? filtered[filtered.length - 1].timestampEnd : -Infinity
    if (opp.timestampStart >= lastEnd + 10) {
      filtered.push(opp)
    }
  }

  return filtered
}

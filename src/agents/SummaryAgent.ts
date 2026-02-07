import { Tool } from '@github/copilot-sdk'
import { promises as fs } from 'fs'
import path from 'path'

import { BaseAgent } from './BaseAgent'
import { captureFrame } from '../tools/ffmpeg/frameCapture'
import logger from '../config/logger'
import { getBrandConfig } from '../config/brand'
import { getConfig } from '../config/environment'
import type { VideoFile, Transcript, VideoSummary, VideoSnapshot, ShortClip, Chapter } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format seconds → "MM:SS" */
function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Build a compact transcript block with timestamps for the LLM prompt. */
function buildTranscriptBlock(transcript: Transcript): string {
  return transcript.segments
    .map((seg) => `[${fmtTime(seg.start)} → ${fmtTime(seg.end)}] ${seg.text.trim()}`)
    .join('\n')
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(shortsInfo: string, socialPostsInfo: string, captionsInfo: string, chaptersInfo: string): string {
  const brand = getBrandConfig()

  return `You are a Video Summary Agent writing from the perspective of ${brand.name} (${brand.handle}).
Brand voice: ${brand.voice.tone}. ${brand.voice.personality} ${brand.voice.style}

Your job is to analyse a video transcript and produce a beautiful, narrative-style Markdown README.

**Workflow**
1. Read the transcript carefully.
2. Identify 3-8 key topics, decisions, highlights, or memorable moments.
3. For each highlight, decide on a representative timestamp and call the "capture_frame" tool to grab a screenshot.
4. Once all frames are captured, call the "write_summary" tool with the final Markdown.

**Markdown structure — follow this layout exactly:**

\`\`\`
# [Video Title]

> [Compelling one-line hook/tagline that captures the video's value]

[2-3 paragraph natural summary that reads like a blog post, NOT a timeline.
Weave in key insights naturally. Write in the brand voice: ${brand.voice.tone}.
${brand.contentGuidelines.blogFocus}]

---

## Key Moments

[For each key topic: write a narrative paragraph (not bullet points).
Embed the timestamp as an inline badge like \`[0:12]\` within the text, NOT as a section header.
Embed the screenshot naturally within or after the paragraph.
Use blockquotes (>) for standout quotes or insights.]

![Description](thumbnails/snapshot-001.png)

[Continue with next topic paragraph...]

---

## 📊 Quick Reference

| Topic | Timestamp |
|-------|-----------|
| Topic name | \`M:SS\` |
| ... | ... |

---
${chaptersInfo}
${shortsInfo}
${socialPostsInfo}
${captionsInfo}

---

*Generated on [DATE] • Duration: [DURATION] • Tags: [relevant tags]*
\`\`\`

**Writing style rules**
- Write in a narrative, blog-post style — NOT a timestamp-driven timeline.
- Timestamps appear as subtle inline badges like \`[0:12]\` or \`[1:30]\` within sentences, never as section headers.
- The summary paragraphs should flow naturally and be enjoyable to read.
- Use the brand perspective: ${brand.voice.personality}
- Topics to emphasize: ${brand.advocacy.interests.join(', ')}
- Avoid: ${brand.advocacy.avoids.join(', ')}

**Screenshot distribution rules — CRITICAL**
- You MUST spread screenshots across the ENTIRE video duration, from beginning to end.
- Divide the video into equal segments based on the number of screenshots you plan to capture, and pick one timestamp from each segment.
- NO MORE than 2 screenshots should fall within the same 60-second window.
- If the video is longer than 2 minutes, your first screenshot must NOT be in the first 10% and your last screenshot must be in the final 30% of the video.
- Use the suggested timestamp ranges provided in the user message as guidance, but pick the exact moment within each range that best matches a key topic in the transcript.

**Tool rules**
- Always call "capture_frame" BEFORE "write_summary".
- The snapshot index must be a 1-based integer; the filename will be snapshot-001.png, etc.
- In the Markdown, reference screenshots as \`thumbnails/snapshot-001.png\` (relative path).
- Call "write_summary" exactly once with the complete Markdown string.`
}

// ── Tool argument shapes ─────────────────────────────────────────────────────

interface CaptureFrameArgs {
  timestamp: number
  description: string
  index: number
}

interface WriteSummaryArgs {
  markdown: string
  title: string
  overview: string
  keyTopics: string[]
}

// ── SummaryAgent ─────────────────────────────────────────────────────────────

class SummaryAgent extends BaseAgent {
  private videoPath: string
  private outputDir: string
  private snapshots: VideoSnapshot[] = []

  constructor(videoPath: string, outputDir: string, systemPrompt: string) {
    super('SummaryAgent', systemPrompt)
    this.videoPath = videoPath
    this.outputDir = outputDir
  }

  // Resolved paths
  private get thumbnailDir(): string {
    return path.join(this.outputDir, 'thumbnails')
  }

  private get markdownPath(): string {
    return path.join(this.outputDir, 'README.md')
  }

  /* ── Tools exposed to the LLM ─────────────────────────────────────────── */

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'capture_frame',
        description:
          'Capture a screenshot from the video at a specific timestamp. ' +
          'Provide: timestamp (seconds), description (what is shown), index (1-based integer for filename).',
        parameters: {
          type: 'object',
          properties: {
            timestamp: { type: 'number', description: 'Timestamp in seconds to capture' },
            description: { type: 'string', description: 'Brief description of the visual moment' },
            index: { type: 'integer', description: '1-based snapshot index (used for filename)' },
          },
          required: ['timestamp', 'description', 'index'],
        },
        handler: async (rawArgs: unknown) => {
          const args = rawArgs as CaptureFrameArgs
          return this.handleCaptureFrame(args)
        },
      },
      {
        name: 'write_summary',
        description:
          'Write the final Markdown summary to disk. ' +
          'Provide: markdown (full README content), title, overview, and keyTopics array.',
        parameters: {
          type: 'object',
          properties: {
            markdown: { type: 'string', description: 'Complete Markdown content for README.md' },
            title: { type: 'string', description: 'Video title' },
            overview: { type: 'string', description: 'Short overview paragraph' },
            keyTopics: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of key topic names',
            },
          },
          required: ['markdown', 'title', 'overview', 'keyTopics'],
        },
        handler: async (rawArgs: unknown) => {
          const args = rawArgs as WriteSummaryArgs
          return this.handleWriteSummary(args)
        },
      },
    ]
  }

  /* ── Tool dispatch (required by BaseAgent) ─────────────────────────────── */

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'capture_frame':
        return this.handleCaptureFrame(args as unknown as CaptureFrameArgs)
      case 'write_summary':
        return this.handleWriteSummary(args as unknown as WriteSummaryArgs)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /* ── Tool implementations ──────────────────────────────────────────────── */

  private async handleCaptureFrame(args: CaptureFrameArgs): Promise<string> {
    const idx = String(args.index).padStart(3, '0')
    const filename = `snapshot-${idx}.png`
    const outputPath = path.join(this.thumbnailDir, filename)

    await captureFrame(this.videoPath, args.timestamp, outputPath)

    const snapshot: VideoSnapshot = {
      timestamp: args.timestamp,
      description: args.description,
      outputPath,
    }
    this.snapshots.push(snapshot)

    logger.info(`[SummaryAgent] Captured snapshot ${idx} at ${fmtTime(args.timestamp)}`)
    return `Frame captured: thumbnails/${filename}`
  }

  private async handleWriteSummary(args: WriteSummaryArgs): Promise<string> {
    await fs.mkdir(this.outputDir, { recursive: true })
    await fs.writeFile(this.markdownPath, args.markdown, 'utf-8')

    logger.info(`[SummaryAgent] Wrote summary → ${this.markdownPath}`)
    return `Summary written to ${this.markdownPath}`
  }

  /** Expose collected data after the run. */
  getResult(args: WriteSummaryArgs): VideoSummary {
    return {
      title: args.title,
      overview: args.overview,
      keyTopics: args.keyTopics,
      snapshots: this.snapshots,
      markdownPath: this.markdownPath,
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Build the Shorts section for the README template. */
function buildShortsSection(shorts?: ShortClip[]): string {
  if (!shorts || shorts.length === 0) {
    return `
## ✂️ Shorts

| Short | Duration | Description |
|-------|----------|-------------|
| *Shorts will appear here once generated* | | |`
  }

  const rows = shorts
    .map((s) => `| [${s.title}](shorts/${s.slug}.mp4) | ${Math.round(s.totalDuration)}s | ${s.description} |`)
    .join('\n')

  return `
## ✂️ Shorts

| Short | Duration | Description |
|-------|----------|-------------|
${rows}`
}

/** Build the Social Media Posts section for the README template. */
function buildSocialPostsSection(): string {
  return `
## 📱 Social Media Posts

- [TikTok](social-posts/tiktok.md)
- [YouTube](social-posts/youtube.md)
- [Instagram](social-posts/instagram.md)
- [LinkedIn](social-posts/linkedin.md)
- [X / Twitter](social-posts/x.md)
- [Dev.to Blog](social-posts/devto.md)`
}

/** Build the Captions section for the README template. */
function buildCaptionsSection(): string {
  return `
## 🎬 Captions

- [SRT](captions/captions.srt) | [VTT](captions/captions.vtt) | [ASS (Styled)](captions/captions.ass)`
}

/** Format seconds → YouTube-style timestamp for chapters display */
function toYouTubeTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Build the Chapters section for the README template. */
function buildChaptersSection(chapters?: Chapter[]): string {
  if (!chapters || chapters.length === 0) {
    return ''
  }

  const rows = chapters
    .map((ch) => `| \`${toYouTubeTimestamp(ch.timestamp)}\` | ${ch.title} | ${ch.description} |`)
    .join('\n')

  return `
## 📑 Chapters

| Time | Chapter | Description |
|------|---------|-------------|
${rows}

> 📋 [YouTube Timestamps](chapters/chapters-youtube.txt) • [Markdown](chapters/chapters.md) • [JSON](chapters/chapters.json)`
}

/**
 * Generate a beautiful Markdown summary for a video recording.
 *
 * 1. Creates a SummaryAgent with `capture_frame` and `write_summary` tools
 * 2. Builds a prompt containing the full transcript with timestamps
 * 3. Lets the agent analyse the transcript, capture key frames, and write Markdown
 * 4. Returns a {@link VideoSummary} with metadata and snapshot paths
 */
export async function generateSummary(
  video: VideoFile,
  transcript: Transcript,
  shorts?: ShortClip[],
  chapters?: Chapter[],
): Promise<VideoSummary> {
  const config = getConfig()
  const outputDir = path.join(config.OUTPUT_DIR, video.slug)

  // Build content-section snippets for the system prompt
  const shortsInfo = buildShortsSection(shorts)
  const socialPostsInfo = buildSocialPostsSection()
  const captionsInfo = buildCaptionsSection()
  const chaptersInfo = buildChaptersSection(chapters)

  const systemPrompt = buildSystemPrompt(shortsInfo, socialPostsInfo, captionsInfo, chaptersInfo)
  const agent = new SummaryAgent(video.repoPath, outputDir, systemPrompt)

  const transcriptBlock = buildTranscriptBlock(transcript)

  // Pre-calculate suggested screenshot time ranges spread across the full video
  const screenshotCount = Math.min(8, Math.max(3, Math.round(video.duration / 120)))
  const interval = video.duration / screenshotCount
  const suggestedRanges = Array.from({ length: screenshotCount }, (_, i) => {
    const center = Math.round(interval * (i + 0.5))
    const lo = Math.max(0, Math.round(center - interval / 2))
    const hi = Math.min(Math.round(video.duration), Math.round(center + interval / 2))
    return `${fmtTime(lo)}–${fmtTime(hi)} (${lo}s–${hi}s)`
  }).join(', ')

  const userPrompt = [
    `**Video:** ${video.filename}`,
    `**Duration:** ${fmtTime(video.duration)} (${Math.round(video.duration)} seconds)`,
    `**Date:** ${video.createdAt.toISOString().slice(0, 10)}`,
    '',
    `**Suggested screenshot time ranges (one screenshot per range):**`,
    suggestedRanges,
    '',
    '---',
    '',
    '**Transcript:**',
    '',
    transcriptBlock,
  ].join('\n')

  let lastWriteArgs: WriteSummaryArgs | undefined

  // Intercept write_summary args so we can build the return value
  // Uses `as any` to access private method — required by the intercept-and-capture pattern
  const origHandleWrite = (agent as any).handleWriteSummary.bind(agent) as (
    a: WriteSummaryArgs,
  ) => Promise<string>
  ;(agent as any).handleWriteSummary = async (args: WriteSummaryArgs) => {
    lastWriteArgs = args
    return origHandleWrite(args)
  }

  try {
    await agent.run(userPrompt)

    if (!lastWriteArgs) {
      throw new Error('SummaryAgent did not call write_summary')
    }

    return agent.getResult(lastWriteArgs)
  } finally {
    await agent.destroy()
  }
}

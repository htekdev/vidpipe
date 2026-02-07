import { Tool } from '@github/copilot-sdk'
import { promises as fs } from 'fs'
import path from 'path'

import { BaseAgent } from './BaseAgent'
import logger from '../config/logger'
import { getConfig } from '../config/environment'
import type { VideoFile, Transcript, Chapter } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format seconds → "M:SS" or "H:MM:SS" for YouTube timestamps */
function toYouTubeTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** Format seconds → "MM:SS" for table display */
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

// ── Output format generators ─────────────────────────────────────────────────

function generateChaptersJSON(chapters: Chapter[]): string {
  return JSON.stringify({ chapters }, null, 2)
}

function generateYouTubeTimestamps(chapters: Chapter[]): string {
  return chapters
    .map((ch) => `${toYouTubeTimestamp(ch.timestamp)} ${ch.title}`)
    .join('\n')
}

function generateChaptersMarkdown(chapters: Chapter[]): string {
  const rows = chapters
    .map((ch) => `| ${toYouTubeTimestamp(ch.timestamp)} | ${ch.title} | ${ch.description} |`)
    .join('\n')

  return `## Chapters

| Time | Chapter | Description |
|------|---------|-------------|
${rows}
`
}

function generateFFMetadata(chapters: Chapter[], totalDuration: number): string {
  let meta = ';FFMETADATA1\n\n'
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    const startMs = Math.round(ch.timestamp * 1000)
    const endMs = i < chapters.length - 1
      ? Math.round(chapters[i + 1].timestamp * 1000)
      : Math.round(totalDuration * 1000)
    const escapedTitle = ch.title.replace(/[=;#\\]/g, '\\$&')
    meta += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${escapedTitle}\n\n`
  }
  return meta
}

// ── System prompt ────────────────────────────────────────────────────────────

function buildChapterSystemPrompt(): string {
  return `You are a video chapter generator. Analyze the transcript and identify distinct topic segments.

Rules:
- First chapter MUST start at 0:00
- Minimum 3 chapters, maximum 10
- Each chapter should be 2-5 minutes long
- Chapter titles should be concise (3-7 words)
- Look for topic transitions, "moving on", "next", "now let's", etc.
- Include a brief 1-sentence description per chapter

**Output format:**
Call the "generate_chapters" tool with an array of chapter objects.
Each chapter: { timestamp (seconds from start), title (short, 3-7 words), description (1-sentence summary) }

**Title style:**
- Use title case: "Setting Up the Database"
- Be specific: "Configuring PostgreSQL" not "Database Stuff"
- Include the action when relevant: "Building the API Routes"
- Keep under 50 characters`
}

// ── Tool argument shape ──────────────────────────────────────────────────────

interface GenerateChaptersArgs {
  chapters: Chapter[]
}

// ── ChapterAgent ─────────────────────────────────────────────────────────────

class ChapterAgent extends BaseAgent {
  private outputDir: string
  private totalDuration: number

  constructor(outputDir: string, totalDuration: number) {
    super('ChapterAgent', buildChapterSystemPrompt())
    this.outputDir = outputDir
    this.totalDuration = totalDuration
  }

  private get chaptersDir(): string {
    return path.join(this.outputDir, 'chapters')
  }

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'generate_chapters',
        description:
          'Write the identified chapters to disk in all formats. ' +
          'Provide: chapters (array of { timestamp, title, description }).',
        parameters: {
          type: 'object',
          properties: {
            chapters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  timestamp: { type: 'number', description: 'Seconds from video start' },
                  title: { type: 'string', description: 'Short chapter title (3-7 words)' },
                  description: { type: 'string', description: '1-sentence summary' },
                },
                required: ['timestamp', 'title', 'description'],
              },
            },
          },
          required: ['chapters'],
        },
        handler: async (rawArgs: unknown) => {
          const args = rawArgs as GenerateChaptersArgs
          return this.handleGenerateChapters(args)
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'generate_chapters':
        return this.handleGenerateChapters(args as unknown as GenerateChaptersArgs)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async handleGenerateChapters(args: GenerateChaptersArgs): Promise<string> {
    const { chapters } = args
    await fs.mkdir(this.chaptersDir, { recursive: true })

    // Write all 4 formats in parallel
    await Promise.all([
      fs.writeFile(
        path.join(this.chaptersDir, 'chapters.json'),
        generateChaptersJSON(chapters),
        'utf-8',
      ),
      fs.writeFile(
        path.join(this.chaptersDir, 'chapters-youtube.txt'),
        generateYouTubeTimestamps(chapters),
        'utf-8',
      ),
      fs.writeFile(
        path.join(this.chaptersDir, 'chapters.md'),
        generateChaptersMarkdown(chapters),
        'utf-8',
      ),
      fs.writeFile(
        path.join(this.chaptersDir, 'chapters.ffmetadata'),
        generateFFMetadata(chapters, this.totalDuration),
        'utf-8',
      ),
    ])

    logger.info(`[ChapterAgent] Wrote ${chapters.length} chapters in 4 formats → ${this.chaptersDir}`)
    return `Chapters written: ${chapters.length} chapters in 4 formats to ${this.chaptersDir}`
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate chapters for a video recording.
 *
 * 1. Creates a ChapterAgent with a `generate_chapters` tool
 * 2. Builds a prompt containing the full transcript with timestamps
 * 3. Lets the agent analyse the transcript and identify chapter boundaries
 * 4. Returns the array of {@link Chapter} objects
 */
export async function generateChapters(
  video: VideoFile,
  transcript: Transcript,
): Promise<Chapter[]> {
  const config = getConfig()
  const outputDir = path.join(config.OUTPUT_DIR, video.slug)

  const agent = new ChapterAgent(outputDir, video.duration)
  const transcriptBlock = buildTranscriptBlock(transcript)

  const userPrompt = [
    `**Video:** ${video.filename}`,
    `**Duration:** ${fmtTime(video.duration)} (${Math.round(video.duration)} seconds)`,
    '',
    '---',
    '',
    '**Transcript:**',
    '',
    transcriptBlock,
  ].join('\n')

  let capturedChapters: Chapter[] | undefined

  // Intercept generate_chapters args to capture the result
  const origHandler = (agent as any).handleGenerateChapters.bind(agent) as (
    a: GenerateChaptersArgs,
  ) => Promise<string>
  ;(agent as any).handleGenerateChapters = async (args: GenerateChaptersArgs) => {
    capturedChapters = args.chapters
    return origHandler(args)
  }

  try {
    await agent.run(userPrompt)

    if (!capturedChapters) {
      throw new Error('ChapterAgent did not call generate_chapters')
    }

    return capturedChapters
  } finally {
    await agent.destroy()
  }
}

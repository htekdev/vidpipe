import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import type { VideoInfo } from '../tools/agentTools.js'
import { singlePassEdit, type KeepSegment } from '../tools/ffmpeg/singlePassEdit.js'
import type { VideoAsset } from '../assets/VideoAsset.js'
import logger from '../config/logger.js'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional video editor preparing raw footage for visual enhancement. Your goal is to produce a clean, tight edit that's ready for graphics overlays, captions, and social media distribution.

## INFORMATION HIERARCHY

You have three sources of information:
1. **Editorial direction** (from Gemini video AI) — provides editorial judgment: what to cut, pacing issues, hook advice. It watched the actual video and can see visual cues the transcript cannot.
2. **Transcript** — the ground truth for **what was said and when**. Timestamps in the transcript are accurate. Use it to verify that editorial direction timestamps actually match the spoken content.
3. **Your own judgment** — use this to resolve conflicts and make final decisions.

## CONFLICT RESOLUTION

- **Timestamps**: The transcript's timestamps are authoritative. Gemini's timestamps can drift. Always cross-reference the editorial direction's timestamps against the transcript before cutting. If Gemini says "cut 85-108 because it's dead air" but the transcript shows substantive speech at 92-105, trust the transcript.
- **Pacing vs Cleaning**: If the Pacing Analysis recommends removing an entire range but Cleaning Recommendations only flags pieces, favor pacing — it reflects the broader viewing experience.
- **Hook & Retention**: If this section recommends starting at a later point, that overrides granular cleaning cuts in the opening.
- **Valuable content**: Never cut substantive content that the viewer needs to understand the video's message. Filler and dead air around valuable content should be trimmed, but the content itself must be preserved.

## WHAT YOU'RE OPTIMIZING FOR

The video you produce will be further processed by a graphics agent that adds AI-generated image overlays, then captioned, then cut into shorts and medium clips. Your edit needs to:
- Start with the strongest content — no dead air, no "I'm going to make a quick video" preambles
- Flow naturally so captions and overlays land on clean, well-paced segments
- Remove anything that isn't for the viewer (meta-commentary, editor instructions, false starts)

## TOOLS

- **get_video_info** — video duration, dimensions, frame rate
- **get_editorial_direction** — Gemini's full editorial report (cut points, pacing, hook advice, cleaning recommendations)
- **get_transcript** — timestamped transcript (supports start/end filtering)
- **add_cuts** — queue regions for removal (call as many times as needed, use decimal-second precision)
- **finalize_cuts** — merge adjacent cuts and trigger the render (call once at the end)`

// ── Types ────────────────────────────────────────────────────────────────────

interface Removal {
  start: number
  end: number
  reason: string
}

interface GetTranscriptArgs {
  start?: number
  end?: number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Merge overlapping or adjacent removals (gap <= 2 seconds) into larger ranges. */
function mergeRemovals(removals: Removal[]): Removal[] {
  if (removals.length <= 1) return removals

  const sorted = [...removals].sort((a, b) => a.start - b.start)
  const merged: Removal[] = [{ ...sorted[0] }]

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = sorted[i]
    if (curr.start <= prev.end + 2) {
      prev.end = Math.max(prev.end, curr.end)
      prev.reason = `${prev.reason}; ${curr.reason}`
    } else {
      merged.push({ ...curr })
    }
  }

  return merged
}

// ── JSON Schemas ─────────────────────────────────────────────────────────────

const ADD_CUTS_SCHEMA = {
  type: 'object',
  properties: {
    removals: {
      type: 'array',
      description: 'One or more regions to remove from the video',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Start time in seconds (decimal precision, e.g. 14.3)' },
          end: { type: 'number', description: 'End time in seconds (decimal precision, e.g. 37.0)' },
          reason: { type: 'string', description: 'Why this region should be removed' },
        },
        required: ['start', 'end', 'reason'],
      },
    },
  },
  required: ['removals'],
}

/**
 * Result of the produce() method.
 */
export interface ProduceResult {
  /** The agent's summary of edits made */
  summary: string
  /** Path to the output video (if rendering succeeded) */
  outputPath?: string
  /** Whether FFmpeg rendering succeeded */
  success: boolean
  /** Error message if rendering failed */
  error?: string
  /** Number of edits planned */
  editCount?: number
  /** Regions removed from the video */
  removals: { start: number; end: number }[]
  /** Segments kept in the output video */
  keepSegments: { start: number; end: number }[]
}

// ── ProducerAgent ────────────────────────────────────────────────────────────

export class ProducerAgent extends BaseAgent {
  private readonly video: VideoAsset
  private videoDuration: number = 0
  private removals: Removal[] = []
  private renderPromise: Promise<string | void> | null = null
  private outputPath: string = ''

  constructor(video: VideoAsset, model?: string) {
    super('ProducerAgent', SYSTEM_PROMPT, undefined, model)
    this.video = video
  }

  protected resetForRetry(): void {
    this.videoDuration = 0
    this.removals = []
    this.renderPromise = null
    this.outputPath = ''
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'get_video_info',
        description: 'Get video metadata: dimensions, duration, and frame rate.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.handleToolCall('get_video_info', {}),
      },
      {
        name: 'get_transcript',
        description: 'Read the transcript with optional time range filtering.',
        parameters: {
          type: 'object',
          properties: {
            start: { type: 'number', description: 'Optional start time in seconds' },
            end: { type: 'number', description: 'Optional end time in seconds' },
          },
        },
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('get_transcript', rawArgs as Record<string, unknown>),
      },
      {
        name: 'get_editorial_direction',
        description:
          'Get AI-generated editorial guidance from Gemini video analysis. ' +
          'Returns timestamped cut points, pacing notes, and recommendations for cleaning.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.handleToolCall('get_editorial_direction', {}),
      },
      {
        name: 'add_cuts',
        description:
          'Add one or more regions to remove from the video. ' +
          'You can call this multiple times to build your edit list incrementally as you analyze each section.',
        parameters: ADD_CUTS_SCHEMA,
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('add_cuts', rawArgs as Record<string, unknown>),
      },
      {
        name: 'finalize_cuts',
        description:
          'Finalize your edit list and trigger video rendering. ' +
          'Call this ONCE after you have added all cuts with add_cuts. ' +
          'Adjacent/overlapping cuts will be merged automatically.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.handleToolCall('finalize_cuts', {}),
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_video_info': {
        logger.info(`[ProducerAgent] Getting video info`)
        const metadata = await this.video.getMetadata()
        this.videoDuration = metadata.duration
        return {
          width: metadata.width,
          height: metadata.height,
          duration: metadata.duration,
          fps: 30,
        } as VideoInfo
      }

      case 'get_transcript': {
        const { start, end } = args as GetTranscriptArgs
        logger.info(`[ProducerAgent] Reading transcript${start !== undefined ? ` (${start}s-${end}s)` : ''}`)

        const transcript = await this.video.getTranscript()

        let segments = transcript.segments
        if (start !== undefined || end !== undefined) {
          segments = segments.filter(s => {
            if (start !== undefined && s.end < start) return false
            if (end !== undefined && s.start > end) return false
            return true
          })
        }

        return {
          text: segments.map(s => s.text).join(' '),
          segments: segments.map(s => ({
            text: s.text,
            start: s.start,
            end: s.end,
          })),
        }
      }

      case 'get_editorial_direction': {
        logger.info(`[ProducerAgent] Getting editorial direction from Gemini`)

        const direction = await this.video.getEditorialDirection()

        if (!direction) {
          return {
            available: false,
            message: 'Editorial direction not available (GEMINI_API_KEY not configured). Plan cuts based on transcript analysis.',
          }
        }

        return {
          available: true,
          editorialDirection: direction,
        }
      }

      case 'add_cuts': {
        const { removals } = args as { removals: Removal[] }
        this.removals.push(...removals)
        logger.info(`[ProducerAgent] Added ${removals.length} cuts (total: ${this.removals.length})`)
        return `Added ${removals.length} cuts. Total queued: ${this.removals.length}. Call add_cuts again for more, or finalize_cuts when done.`
      }

      case 'finalize_cuts': {
        this.removals = mergeRemovals(this.removals)
        logger.info(`[ProducerAgent] Finalized ${this.removals.length} cuts (after merging), starting render`)

        // Build keepSegments and start rendering (don't await — save promise)
        const sortedRemovals = [...this.removals].sort((a, b) => a.start - b.start)
        const keepSegments: KeepSegment[] = []
        let cursor = 0
        for (const removal of sortedRemovals) {
          if (removal.start > cursor) {
            keepSegments.push({ start: cursor, end: removal.start })
          }
          cursor = Math.max(cursor, removal.end)
        }
        if (cursor < this.videoDuration) {
          keepSegments.push({ start: cursor, end: this.videoDuration })
        }

        const totalRemoval = this.removals.reduce((sum, r) => sum + (r.end - r.start), 0)
        logger.info(
          `[ProducerAgent] ${this.removals.length} removals → ${keepSegments.length} keep segments, removing ${totalRemoval.toFixed(1)}s`,
        )

        this.renderPromise = singlePassEdit(this.video.videoPath, keepSegments, this.outputPath)
        return `Rendering started with ${this.removals.length} cuts. The video is being processed in the background.`
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Run the producer agent to clean the video by removing unwanted segments.
   *
   * @param outputPath - Path for the output video
   */
  async produce(outputPath: string): Promise<ProduceResult> {
    this.removals = []
    this.renderPromise = null
    this.outputPath = outputPath

    const prompt = `Clean this video by removing unwanted segments.

**Video:** ${this.video.videoPath}

Get the video info, editorial direction, and transcript. Analyze them together, then add your cuts and finalize.`

    try {
      const response = await this.run(prompt)
      logger.info(`[ProducerAgent] Agent conversation complete for ${this.video.videoPath}`)

      // Wait for render if finalize_cuts was called
      if (this.renderPromise) {
        await this.renderPromise
        logger.info(`[ProducerAgent] Render complete: ${outputPath}`)

        const sortedRemovals = [...this.removals].sort((a, b) => a.start - b.start)
        const keepSegments: KeepSegment[] = []
        let cursor = 0
        for (const removal of sortedRemovals) {
          if (removal.start > cursor) {
            keepSegments.push({ start: cursor, end: removal.start })
          }
          cursor = Math.max(cursor, removal.end)
        }
        if (cursor < this.videoDuration) {
          keepSegments.push({ start: cursor, end: this.videoDuration })
        }

        return {
          summary: response,
          outputPath,
          success: true,
          editCount: this.removals.length,
          removals: sortedRemovals.map(r => ({ start: r.start, end: r.end })),
          keepSegments,
        }
      }

      // Agent didn't finalize — no cuts planned
      logger.info(`[ProducerAgent] No cuts finalized — video is clean`)
      return {
        summary: response,
        success: true,
        editCount: 0,
        removals: [],
        keepSegments: [{ start: 0, end: this.videoDuration }],
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[ProducerAgent] Production failed: ${message}`)
      return {
        summary: `Production failed: ${message}`,
        success: false,
        error: message,
        removals: [],
        keepSegments: [],
      }
    } finally {
      await this.destroy()
    }
  }
}

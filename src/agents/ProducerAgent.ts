import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import type { VideoInfo } from '../tools/agentTools.js'
import { singlePassEdit, type KeepSegment } from '../tools/ffmpeg/singlePassEdit.js'
import type { VideoAsset } from '../assets/VideoAsset.js'
import logger from '../config/logger.js'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional video cleaner. Your job is to analyze videos and identify regions that should be removed for a tighter, cleaner edit.

## CONTEXT TOOLS (use these first to understand the video)
- **get_video_info**: Get video dimensions, duration, and frame rate
- **get_transcript**: Read what's being said (with optional time range filtering)
- **get_editorial_direction**: Get AI-generated editorial guidance (cut points, pacing notes) from Gemini video analysis. Use this to inform your cleaning decisions.

## WHAT TO REMOVE
- **Dead air**: Long silences with no meaningful content
- **Filler words**: Excessive "um", "uh", "like", "you know" clusters
- **Bad takes**: False starts, stumbles, repeated sentences where the speaker restarts
- **Long pauses**: Extended gaps between sentences (>3 seconds) that don't serve a purpose
- **Redundant content**: Sections where the same point is repeated without adding value

## WHAT TO PRESERVE
- **Intentional pauses**: Dramatic pauses, thinking pauses before important points
- **Demonstrations**: Silence during live coding, UI interaction, or waiting for results
- **Meaningful silence**: Pauses that give the viewer time to absorb information
- **All substantive content**: When in doubt, keep it

## WORKFLOW

1. Call get_video_info to know the video duration
2. Call get_editorial_direction to get AI-powered editorial guidance (cut points, pacing issues)
3. Call get_transcript (in sections if long) to understand what's being said and find removable regions
4. When ready, call **plan_cuts** with your list of regions to remove

## GUIDELINES
- Be conservative: aim for 10-20% removal at most
- Each removal should have a clear reason
- Don't remove short pauses (<1 second) — they sound natural
- Focus on making the video tighter, not shorter for its own sake
- Use editorial direction from Gemini to identify problematic regions`

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

// ── JSON Schemas ─────────────────────────────────────────────────────────────

const PLAN_CUTS_SCHEMA = {
  type: 'object',
  properties: {
    removals: {
      type: 'array',
      description: 'Array of regions to remove from the video',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Start time in seconds' },
          end: { type: 'number', description: 'End time in seconds' },
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

  constructor(video: VideoAsset, model?: string) {
    super('ProducerAgent', SYSTEM_PROMPT, undefined, model)
    this.video = video
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
        name: 'plan_cuts',
        description:
          'Submit your list of regions to remove from the video. Call this ONCE with ALL planned removals.',
        parameters: PLAN_CUTS_SCHEMA,
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('plan_cuts', rawArgs as Record<string, unknown>),
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

      case 'plan_cuts': {
        const { removals } = args as { removals: Removal[] }
        logger.info(`[ProducerAgent] Received plan with ${removals.length} removals`)
        this.removals = removals
        return `Plan received with ${removals.length} removals. Video will be rendered automatically.`
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

    const prompt = `Analyze this video and decide which segments should be removed for a cleaner edit.

**Video:** ${this.video.videoPath}

## Instructions

1. Call get_video_info to know the video duration.
2. Call get_editorial_direction to get AI-powered editorial guidance (cut points, pacing issues).
3. Call get_transcript to understand what's being said and identify removable regions.
4. Call **plan_cuts** with your list of regions to remove.

Focus on removing dead air, filler words, bad takes, and redundant content. Be conservative — aim for 10-20% removal at most.`

    try {
      const response = await this.run(prompt)
      logger.info(`[ProducerAgent] Agent planning complete for ${this.video.videoPath}`)

      if (this.removals.length === 0) {
        logger.info(`[ProducerAgent] No removals planned — video is clean`)
        return {
          summary: response,
          success: true,
          editCount: 0,
          removals: [],
          keepSegments: [{ start: 0, end: this.videoDuration }],
        }
      }

      // Safety cap: limit removals to 20% of video duration
      const maxRemoval = this.videoDuration * 0.20
      let totalRemoval = 0
      const sortedByDuration = [...this.removals].sort(
        (a, b) => (b.end - b.start) - (a.end - a.start),
      )
      const cappedRemovals: Removal[] = []
      for (const r of sortedByDuration) {
        const dur = r.end - r.start
        if (totalRemoval + dur <= maxRemoval) {
          cappedRemovals.push(r)
          totalRemoval += dur
        }
      }

      if (cappedRemovals.length < this.removals.length) {
        logger.warn(
          `[ProducerAgent] Safety cap: reduced ${this.removals.length} removals to ${cappedRemovals.length} (max 20% of ${this.videoDuration}s = ${maxRemoval.toFixed(1)}s)`,
        )
      }

      // Sort by start time for keepSegment construction
      const sortedRemovals = [...cappedRemovals].sort((a, b) => a.start - b.start)

      // Convert removals to keepSegments (inverse)
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

      logger.info(
        `[ProducerAgent] ${cappedRemovals.length} removals → ${keepSegments.length} keep segments, removing ${totalRemoval.toFixed(1)}s`,
      )

      // Render via singlePassEdit
      await singlePassEdit(this.video.videoPath, keepSegments, outputPath)

      logger.info(`[ProducerAgent] Render complete: ${outputPath}`)

      return {
        summary: response,
        outputPath,
        success: true,
        editCount: cappedRemovals.length,
        removals: sortedRemovals.map(r => ({ start: r.start, end: r.end })),
        keepSegments,
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

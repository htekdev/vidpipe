import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import {
  captureFrame,
  runFfmpeg,
  type VideoInfo,
  type FfmpegResult,
} from '../tools/agentTools.js'
import { analyzeImageElements } from '../tools/gemini/geminiClient.js'
import { EdlAccumulator } from '../tools/edl/accumulator.js'
import { compileEdl } from '../tools/edl/compiler.js'
import type { WebcamRegion } from '../types/edl.js'
import type { AspectRatio } from '../types/index.js'
import type { VideoAsset } from '../assets/VideoAsset.js'
import { fontsDir, join } from '../core/paths.js'
import logger from '../config/logger.js'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional video producer. Your job is to analyze videos and plan production edits to maximize viewer engagement.

## CONTEXT TOOLS (use these first to understand the video)
- **get_video_info**: Get video dimensions, duration, and frame rate
- **get_transcript**: Read what's being said (with optional time range filtering)
- **get_chapters**: Get chapter structure with timestamps and titles
- **get_editorial_direction**: Get AI-generated editorial guidance (cut points, pacing, transitions, b-roll, hook analysis) from Gemini video analysis. This gives you timestamped recommendations based on visual + audio analysis of the actual video. Use this to inform your edit plan.
- **capture_frame**: Capture a frame at a timestamp for visual inspection

## EDIT TYPES TO PLAN

### Layouts (how webcam and screen content are arranged)
- **only_webcam**: Show only the webcam feed, filling the full frame
  - Use for: intros, outros, personal commentary, emotional moments
- **only_screen**: Show only the screen capture, filling the full frame
  - Use for: detailed code walkthroughs, demos, reading documentation
- **split_layout**: Layout depends on target aspect ratio:
  - For 16:9 (landscape): shows the original frame scaled to fit (no split)
  - For 9:16/1:1/4:5 (portrait/square): creates a vstack of screen (65%) on top + webcam (35%) below
  - Use for: default layout across all aspect ratios
- **zoom_webcam**: Zoom in on webcam (params: scale, default 1.2)
  - Use for: emphasis during reactions, personal moments
- **zoom_screen**: Zoom in on a region of screen
  - **IMPORTANT**: Before using zoom_screen, capture a frame at that timestamp first.
    Look at the frame and specify a region {x, y, width, height} (normalized 0-1 coordinates)
    that targets where the interesting content is (cursor position, active code, UI element).
    Without a region, it zooms to the center which often misses the action.
  - Use for: highlighting code, UI elements, terminal output

### Transitions (how to move between layouts)
- **fade**: Smooth crossfade (params: duration, default 0.5s)
- **swipe**: Slide transition (params: direction - left/right/up/down)
- **zoom_transition**: Dramatic zoom blur
- **cut**: Instant hard cut

### Effects (overlays and modifications)
- **text_overlay**: Add text (params: text, position, animation: 'none'|'fade-in'|'slide-up'|'pop')
- **highlight_region**: Draw highlight box (params: x, y, width, height in normalized 0-1 coords, color, animation: 'none'|'pulse'|'draw', dimOutside: boolean)
- **slow_motion**: Change speed (params: speed - 0.5 = half, 2.0 = double)
- **fade_to_black**: Fade video and audio to black (params: duration, default 1.0s). Use at video end.

## WORKFLOW

1. Call get_video_info to know the video duration
2. Call get_chapters to understand the structure
3. Call get_editorial_direction to get AI-powered editorial guidance (cut points, pacing issues, transition recommendations, b-roll suggestions)
4. Call get_transcript (in sections if long) to understand the content
5. Optionally capture frames and use **analyze_frame** to detect specific UI elements for precise zoom/highlight coordinates
6. When ready, call **plan_edits** with your complete edit plan, incorporating the editorial direction's recommendations

## SEGMENT TRIMMING (Removing dead air / filler)
You can SKIP content by leaving GAPS between layout decisions. For example:
- Layout 1: split_layout from 0.0 to 2.0
- Layout 2: split_layout from 3.0 to 5.0
→ The gap at 2.0–3.0 is automatically excluded from the output.
Use this to cut hesitation, filler words ("um", "uh"), dead air, and pauses.

## PLANNING TIPS
- Start with split_layout as default for the whole video
- Switch to only_webcam for personal moments (intros, reactions)
- Switch to only_screen for detailed technical content
- **For zoom_screen**: ALWAYS capture a frame first to see where the interesting
  content is, then specify a region parameter with normalized coordinates.
  Example: region: {x: 0.1, y: 0.2, width: 0.5, height: 0.6}
- Add fade transitions at chapter boundaries
- Add text_overlay for chapter titles (try 'fade-in' or 'pop' animation)
- Use highlight_region with normalized coords (0-1) to highlight specific UI elements
- Use analyze_frame to find precise coordinates of elements before zooming or highlighting
- Add fade_to_black at the end of the video for a clean outro
- To trim dead air: leave gaps between layout decisions — those gaps are automatically cut
- Don't overdo effects — subtle is better

Be creative but purposeful. Every edit should serve viewer engagement.`

// ── Types ────────────────────────────────────────────────────────────────────

interface PlannedEdit {
  type: 'layout' | 'transition' | 'effect'
  tool: string
  start_time: number
  end_time?: number
  params?: Record<string, unknown>
}

interface CaptureFrameArgs {
  timestamp: number
}

interface GetTranscriptArgs {
  start?: number
  end?: number
}

// ── JSON Schemas ─────────────────────────────────────────────────────────────

const PLAN_EDITS_SCHEMA = {
  type: 'object',
  properties: {
    edits: {
      type: 'array',
      description: 'Array of planned edits',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['layout', 'transition', 'effect'],
            description: 'Type of edit',
          },
          tool: {
            type: 'string',
            description: 'Tool name: only_webcam, only_screen, split_layout, zoom_webcam, zoom_screen, fade, swipe, zoom_transition, cut, text_overlay, highlight_region, slow_motion, fade_to_black',
          },
          start_time: {
            type: 'number',
            description: 'Start time in seconds',
          },
          end_time: {
            type: 'number',
            description: 'End time in seconds (required for layouts and effects)',
          },
          params: {
            type: 'object',
            description: 'Tool-specific parameters',
          },
        },
        required: ['type', 'tool', 'start_time'],
      },
    },
  },
  required: ['edits'],
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
}

// ── ProducerAgent ────────────────────────────────────────────────────────────

/** Map aspect ratio to output dimensions */
function outputDimsForAspectRatio(ar: AspectRatio): { width: number; height: number } {
  switch (ar) {
    case '16:9': return { width: 1920, height: 1080 }
    case '9:16': return { width: 1080, height: 1920 }
    case '1:1':  return { width: 1080, height: 1080 }
    case '4:5':  return { width: 1080, height: 1350 }
  }
}

export class ProducerAgent extends BaseAgent {
  private readonly video: VideoAsset
  private readonly aspectRatio: AspectRatio
  private readonly accumulator: EdlAccumulator
  private outputPath: string = ''
  private videoDuration: number = 0
  private plannedEdits: PlannedEdit[] = []

  constructor(video: VideoAsset, aspectRatio: AspectRatio = '16:9', model?: string) {
    super('ProducerAgent', SYSTEM_PROMPT, undefined, model)
    this.video = video
    this.aspectRatio = aspectRatio
    this.accumulator = new EdlAccumulator()
  }

  protected getTools(): ToolWithHandler[] {
    return [
      // ─── Context Tools ───────────────────────────────────────────────
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
        name: 'get_chapters',
        description: 'Get the chapter structure with timestamps and titles.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.handleToolCall('get_chapters', {}),
      },
      {
        name: 'get_editorial_direction',
        description:
          'Get AI-generated editorial guidance from Gemini video analysis. ' +
          'Returns timestamped cut points, pacing notes, transition recommendations, ' +
          'b-roll suggestions, hook analysis, music cues, and overall structure.',
        parameters: { type: 'object', properties: {} },
        handler: async () => this.handleToolCall('get_editorial_direction', {}),
      },
      {
        name: 'capture_frame',
        description: 'Capture a frame at a specific timestamp for visual inspection.',
        parameters: {
          type: 'object',
          properties: {
            timestamp: { type: 'number', description: 'Timestamp in seconds to capture' },
          },
          required: ['timestamp'],
        },
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('capture_frame', rawArgs as Record<string, unknown>),
      },
      {
        name: 'analyze_frame',
        description:
          'Capture a frame and use Gemini vision to detect UI elements with bounding boxes. ' +
          'Returns pixel coordinates for each detected element, which you can convert to ' +
          'normalized 0-1 coordinates for zoom_screen regions or highlight_region effects. ' +
          'To convert: normalizedX = x / imageWidth, normalizedY = y / imageHeight, etc.',
        parameters: {
          type: 'object',
          properties: {
            timestamp: { type: 'number', description: 'Timestamp in seconds to capture and analyze' },
            query: { type: 'string', description: 'Optional: specific elements to look for (e.g., "terminal output", "code editor")' },
          },
          required: ['timestamp'],
        },
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('analyze_frame', rawArgs as Record<string, unknown>),
      },

      // ─── Planning Tool (single tool like ShortsAgent) ────────────────
      {
        name: 'plan_edits',
        description:
          'Submit your complete edit plan as a structured JSON array. Call this ONCE with ALL planned edits.',
        parameters: PLAN_EDITS_SCHEMA,
        handler: async (rawArgs: unknown) =>
          this.handleToolCall('plan_edits', rawArgs as Record<string, unknown>),
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
          fps: 30, // Default, could be extracted from ffprobe
        } as VideoInfo
      }

      case 'get_transcript': {
        const { start, end } = args as GetTranscriptArgs
        logger.info(`[ProducerAgent] Reading transcript${start !== undefined ? ` (${start}s-${end}s)` : ''}`)
        
        const transcript = await this.video.getTranscript()
        
        // Filter by time range if specified
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

      case 'get_chapters': {
        logger.info(`[ProducerAgent] Getting chapters`)
        
        const chapters = await this.video.getChapters()
        
        return {
          chapters: chapters.map(c => ({
            title: c.title,
            timestamp: c.timestamp,
            description: c.description,
          })),
        }
      }

      case 'get_editorial_direction': {
        logger.info(`[ProducerAgent] Getting editorial direction from Gemini`)
        
        const direction = await this.video.getEditorialDirection()
        
        if (!direction) {
          return {
            available: false,
            message: 'Editorial direction not available (GEMINI_API_KEY not configured). Plan edits based on transcript and chapters.',
          }
        }
        
        return {
          available: true,
          editorialDirection: direction,
        }
      }

      case 'capture_frame': {
        const { timestamp } = args as unknown as CaptureFrameArgs
        logger.info(`[ProducerAgent] Capturing frame at ${timestamp}s`)
        const result = await captureFrame(this.video.videoPath, timestamp)
        return { imagePath: result.imagePath }
      }

      case 'analyze_frame': {
        const { timestamp, query } = args as { timestamp: number; query?: string }
        logger.info(`[ProducerAgent] Analyzing frame at ${timestamp}s${query ? ` (query: ${query})` : ''}`)
        const frame = await captureFrame(this.video.videoPath, timestamp)
        try {
          const elements = await analyzeImageElements(frame.imagePath, query)
          // Get image dimensions from video metadata for normalization reference
          const meta = await this.video.getMetadata()
          return {
            elements,
            imageWidth: meta.width,
            imageHeight: meta.height,
            tip: 'To convert to normalized coords for zoom_screen/highlight_region: x_norm = x / imageWidth, y_norm = y / imageHeight, w_norm = width / imageWidth, h_norm = height / imageHeight',
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn(`[ProducerAgent] analyze_frame failed: ${msg}`)
          return {
            error: msg,
            fallback: 'Frame analysis unavailable. Use capture_frame with visual inspection instead.',
            imagePath: frame.imagePath,
          }
        }
      }

      case 'plan_edits': {
        const { edits } = args as { edits: PlannedEdit[] }
        logger.info(`[ProducerAgent] Received plan with ${edits.length} edits`)
        this.plannedEdits = edits
        
        // Convert planned edits to EDL accumulator
        for (const edit of edits) {
          this.accumulator.add({
            type: edit.type,
            tool: edit.tool,
            startTime: edit.start_time,
            endTime: edit.end_time,
            params: edit.params ?? {},
          })
        }
        
        return `Plan received with ${edits.length} edits. Video will be rendered automatically.`
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Compile the accumulated EDL to FFmpeg commands and execute.
   */
  private async compileAndRender(): Promise<{
    success: boolean
    outputPath?: string
    error?: string
    decisions: number
  }> {
    logger.info(`[ProducerAgent] Starting compileAndRender...`)

    // Get webcam region from video asset layout
    const layout = await this.video.getLayout()
    const webcamRegion = layout.webcam ?? undefined

    // Build the EDL
    const edl = this.accumulator.toEdl(this.video.videoPath, this.outputPath, webcamRegion)

    // Add metadata with target aspect ratio
    const dims = outputDimsForAspectRatio(this.aspectRatio)
    const videoMeta = await this.video.getMetadata()
    edl.metadata = {
      description: 'ProducerAgent generated EDL',
      createdBy: 'ProducerAgent',
      sourceDuration: this.videoDuration,
      sourceWidth: videoMeta.width,
      sourceHeight: videoMeta.height,
      outputWidth: dims.width,
      outputHeight: dims.height,
      targetAspectRatio: this.aspectRatio,
      fontPath: join(fontsDir(), 'Montserrat-Bold.ttf'),
    }

    logger.info(`[ProducerAgent] Compiling EDL with ${edl.decisions.length} decisions`)

    // Compile to FFmpeg
    const compiled = compileEdl(edl)

    logger.info(`[ProducerAgent] Filter complex generated (${compiled.filterComplex.length} chars)`)
    logger.debug(`[ProducerAgent] Filter complex:\n${compiled.filterComplex}`)

    // Build FFmpeg args — write filter_complex to a temp file to avoid
    // two-level escaping issues with -filter_complex (filtergraph + option levels)
    const scriptPath = pathJoin(tmpdir(), `vidpipe-fc-${Date.now()}.txt`)
    await writeFile(scriptPath, compiled.filterComplex, 'utf8')
    logger.debug(`[ProducerAgent] Filter script written to: ${scriptPath}`)

    const ffmpegArgs = [
      '-i',
      this.video.videoPath,
      ...compiled.inputArgs,
      '-filter_complex_script',
      scriptPath,
      ...compiled.outputArgs,
      '-y',
      this.outputPath,
    ]

    logger.info(`[ProducerAgent] Executing FFmpeg render...`)

    // Execute FFmpeg
    let result: FfmpegResult
    try {
      result = await runFfmpeg(ffmpegArgs)
    } finally {
      if (result!.success) {
        await unlink(scriptPath).catch(() => {})
      } else {
        logger.warn(`[ProducerAgent] Filter script preserved for debugging: ${scriptPath}`)
      }
    }

    if (result.success) {
      logger.info(`[ProducerAgent] Render complete: ${this.outputPath}`)
      return {
        success: true,
        outputPath: this.outputPath,
        decisions: edl.decisions.length,
      }
    } else {
      logger.error(`[ProducerAgent] Render failed: ${result.error}`)
      return {
        success: false,
        error: result.error,
        decisions: edl.decisions.length,
      }
    }
  }

  /**
   * Run the producer agent to enhance the video with production effects.
   * 
   * @param outputPath - Path for the output video
   */
  async produce(outputPath: string): Promise<ProduceResult> {
    this.outputPath = outputPath

    // Reset state for this production run
    this.accumulator.clear()
    this.plannedEdits = []

    // Get webcam info from video asset
    const layout = await this.video.getLayout()
    const webcamRegion = layout.webcam
    const webcamInfo = webcamRegion
      ? `\n**Webcam detected at:** x=${webcamRegion.x}, y=${webcamRegion.y}, ${webcamRegion.width}x${webcamRegion.height} (confidence: ${webcamRegion.confidence})`
      : '\n**Webcam:** Not detected - layouts requiring webcam will use full frame'

    const prompt = `Analyze this video and create a production edit plan.

**Video:** ${this.video.videoPath}
**Output:** ${outputPath}${webcamInfo}

## Instructions

1. Call get_video_info to know the video duration.
2. Call get_chapters to see the chapter structure.
3. Call get_editorial_direction to get AI-powered editorial guidance (cut points, pacing, transitions, b-roll suggestions, hook analysis).
4. Call get_transcript to understand what's being said.
5. Plan your edits: layouts, transitions, and effects — incorporating the editorial direction's recommendations where applicable.
6. Call **plan_edits** with your complete edit plan.

## Layout Notes
- Webcam region is pre-detected - layout tools will automatically crop to the right areas
- For zoom_screen, ALWAYS capture a frame first and specify a region parameter targeting where the action is
  (code being edited, cursor position, terminal output, UI element being clicked)
- For zoom_webcam, just specify scale (default 1.2) - it will zoom on the detected webcam

## Editorial Direction Notes
- Use cut points to decide where transitions should go
- Use pacing notes to identify sections that need different layouts (e.g., zoom in during slow parts)
- Use b-roll suggestions to decide where text overlays or zoom effects would help
- Use hook analysis to plan a strong opening layout

Be creative but purposeful — every edit should improve viewer engagement.`

    try {
      const response = await this.run(prompt)
      logger.info(`[ProducerAgent] Agent planning complete for ${this.video.videoPath}`)

      // Check if we got any planned edits
      if (this.plannedEdits.length === 0) {
        logger.warn(`[ProducerAgent] No edits were planned`)
        return {
          summary: response,
          success: false,
          error: 'No edits were planned',
          editCount: 0,
        }
      }

      logger.info(`[ProducerAgent] Agent planned ${this.plannedEdits.length} edits, compiling...`)

      // Compile and render
      const renderResult = await this.compileAndRender()

      return {
        summary: response,
        outputPath: renderResult.success ? outputPath : undefined,
        success: renderResult.success,
        error: renderResult.error,
        editCount: this.plannedEdits.length,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[ProducerAgent] Production failed: ${message}`)
      return {
        summary: `Production failed: ${message}`,
        success: false,
        error: message,
      }
    } finally {
      await this.destroy()
    }
  }
}

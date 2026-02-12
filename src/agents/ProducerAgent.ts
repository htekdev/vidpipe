import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import {
  captureFrame,
  getVideoInfo,
  readTranscript,
  getChapters,
  runFfmpeg,
  generateImage,
  type VideoInfo,
  type TranscriptResult,
  type ChaptersResult,
  type FfmpegResult,
} from '../tools/agentTools.js'
import logger from '../config/logger.js'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional video producer. Your job is to enhance videos with production effects.

Tools available:
- capture_frame(video_path, timestamp): See what's happening at a specific moment
- get_video_info(video_path): Get video dimensions and duration
- read_transcript(transcript_path, start?, end?): Read what's being said in a time range
- get_chapters(chapters_path): Get chapter structure
- run_ffmpeg(args): Execute FFmpeg commands
- generate_image(prompt, style, size): Generate illustrations (not yet implemented)

WORKFLOW:
1. Get video info and chapter structure to understand the content
2. Capture frames at key moments (chapter starts, important timestamps)
3. Read transcript sections to understand what's being discussed
4. Decide what production enhancements would improve engagement:
   - Zoom in when speaker emphasizes something important
   - Add transition effects at chapter boundaries
   - Consider where illustrations could help explain concepts
5. Construct FFmpeg commands for each effect

Example FFmpeg filters you can use:
- Zoom: zoompan=z='1.5':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080
- Crossfade: xfade=transition=fade:duration=0.5:offset=30
- Speed: setpts=0.5*PTS (2x speed), setpts=2*PTS (0.5x speed)
- Overlay: overlay=x=100:y=100:enable='between(t,10,20)'

Build a production plan, then execute it with FFmpeg.`

// ── Tool argument shapes ─────────────────────────────────────────────────────

interface CaptureFrameArgs {
  video_path: string
  timestamp: number
}

interface GetVideoInfoArgs {
  video_path: string
}

interface ReadTranscriptArgs {
  transcript_path: string
  start?: number
  end?: number
}

interface GetChaptersArgs {
  chapters_path: string
}

interface RunFfmpegArgs {
  args: string[]
}

interface GenerateImageArgs {
  prompt: string
  style: string
  size: '1024x1024' | '1792x1024' | '1024x1792'
}

// ── ProducerAgent ────────────────────────────────────────────────────────────

export class ProducerAgent extends BaseAgent {
  constructor(model?: string) {
    super('ProducerAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'capture_frame',
        description:
          'Capture a frame from the video at a specific timestamp. Returns the image path for visual inspection.',
        parameters: {
          type: 'object',
          properties: {
            video_path: { type: 'string', description: 'Path to the video file' },
            timestamp: { type: 'number', description: 'Timestamp in seconds to capture' },
          },
          required: ['video_path', 'timestamp'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('capture_frame', rawArgs as Record<string, unknown>)
        },
      },
      {
        name: 'get_video_info',
        description:
          'Get video metadata including dimensions, duration, and frame rate.',
        parameters: {
          type: 'object',
          properties: {
            video_path: { type: 'string', description: 'Path to the video file' },
          },
          required: ['video_path'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('get_video_info', rawArgs as Record<string, unknown>)
        },
      },
      {
        name: 'read_transcript',
        description:
          'Read the transcript with optional time range filtering. Returns text and word-level timestamps.',
        parameters: {
          type: 'object',
          properties: {
            transcript_path: { type: 'string', description: 'Path to the transcript JSON file' },
            start: { type: 'number', description: 'Optional start time in seconds to filter' },
            end: { type: 'number', description: 'Optional end time in seconds to filter' },
          },
          required: ['transcript_path'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('read_transcript', rawArgs as Record<string, unknown>)
        },
      },
      {
        name: 'get_chapters',
        description:
          'Get the chapter structure of the video with timestamps and titles.',
        parameters: {
          type: 'object',
          properties: {
            chapters_path: { type: 'string', description: 'Path to the chapters JSON file' },
          },
          required: ['chapters_path'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('get_chapters', rawArgs as Record<string, unknown>)
        },
      },
      {
        name: 'run_ffmpeg',
        description:
          'Execute an FFmpeg command with the provided arguments. Use for applying effects, filters, and transformations.',
        parameters: {
          type: 'object',
          properties: {
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Array of FFmpeg command arguments (excluding the ffmpeg binary itself)',
            },
          },
          required: ['args'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('run_ffmpeg', rawArgs as Record<string, unknown>)
        },
      },
      {
        name: 'generate_image',
        description:
          'Generate an illustration using DALL-E (not yet implemented). Returns the image path.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Text description of the image to generate' },
            style: { type: 'string', description: 'Style modifier (e.g., "vivid", "natural")' },
            size: {
              type: 'string',
              enum: ['1024x1024', '1792x1024', '1024x1792'],
              description: 'Output image dimensions',
            },
          },
          required: ['prompt', 'style', 'size'],
        },
        handler: async (rawArgs: unknown) => {
          return this.handleToolCall('generate_image', rawArgs as Record<string, unknown>)
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'capture_frame': {
        const { video_path, timestamp } = args as unknown as CaptureFrameArgs
        logger.info(`[ProducerAgent] Capturing frame at ${timestamp}s from ${video_path}`)
        const result = await captureFrame(video_path, timestamp)
        // Return imagePath for vision capability
        return { imagePath: result.imagePath }
      }

      case 'get_video_info': {
        const { video_path } = args as unknown as GetVideoInfoArgs
        logger.info(`[ProducerAgent] Getting video info for ${video_path}`)
        const info: VideoInfo = await getVideoInfo(video_path)
        return info
      }

      case 'read_transcript': {
        const { transcript_path, start, end } = args as unknown as ReadTranscriptArgs
        logger.info(`[ProducerAgent] Reading transcript from ${transcript_path}${start !== undefined ? ` (${start}s-${end}s)` : ''}`)
        const result: TranscriptResult = await readTranscript(transcript_path, start, end)
        return result
      }

      case 'get_chapters': {
        const { chapters_path } = args as unknown as GetChaptersArgs
        logger.info(`[ProducerAgent] Getting chapters from ${chapters_path}`)
        const result: ChaptersResult = await getChapters(chapters_path)
        return result
      }

      case 'run_ffmpeg': {
        const { args: ffmpegArgs } = args as unknown as RunFfmpegArgs
        logger.info(`[ProducerAgent] Running FFmpeg with ${ffmpegArgs.length} args`)
        const result: FfmpegResult = await runFfmpeg(ffmpegArgs)
        return result
      }

      case 'generate_image': {
        const { prompt, style, size } = args as unknown as GenerateImageArgs
        logger.info(`[ProducerAgent] Generating image: ${prompt.slice(0, 50)}...`)
        const result = await generateImage(prompt, style, size)
        // Return imagePath for vision capability
        return { imagePath: result.imagePath }
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Run the producer agent to enhance a video with production effects.
   *
   * @param videoPath - Path to the source video file
   * @param transcriptPath - Path to the transcript JSON file
   * @param chaptersPath - Path to the chapters JSON file
   * @param outputPath - Path where the enhanced video should be saved
   * @returns The agent's response describing what was done
   */
  async produce(
    videoPath: string,
    transcriptPath: string,
    chaptersPath: string,
    outputPath: string,
  ): Promise<string> {
    const prompt = `Enhance this video with production effects.

Video: ${videoPath}
Transcript: ${transcriptPath}
Chapters: ${chaptersPath}
Output: ${outputPath}

Start by getting the video info and chapter structure, then capture frames at key moments to understand the visual content. Use the transcript to identify moments worth emphasizing. Finally, apply appropriate production effects using FFmpeg.`

    try {
      const response = await this.run(prompt)
      logger.info(`[ProducerAgent] Production complete for ${videoPath}`)
      return response
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`[ProducerAgent] Production failed: ${message}`)
      throw err
    }
  }
}

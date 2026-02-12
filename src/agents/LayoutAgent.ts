import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import { captureFrame, getVideoInfo, runFfmpeg } from '../tools/agentTools.js'
import logger from '../config/logger.js'

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a video layout expert. Given a video path, create high-quality portrait (9:16) variants.

Tools available:
- capture_frame(video_path, timestamp): Capture a frame to see the video content. Returns { imagePath }.
- get_video_info(video_path): Get video dimensions and duration. Returns { width, height, duration, fps }.
- run_ffmpeg(args): Execute an FFmpeg command. Returns { success, outputPath, error }.

WORKFLOW:
1. Get video info to know dimensions
2. Capture a frame from the middle to see the layout
3. Identify: webcam position (if any), screen content, any overlays
4. Construct an FFmpeg filter_complex command for the portrait layout
5. Run FFmpeg to create the portrait video
6. Capture a frame from the output and CAREFULLY verify:
   - Does the webcam look stretched or squished? (faces should be round, not oval)
   - Does the screen content look stretched? (text should not be distorted)
   - Are there any black bars or gray artifacts?
7. If ANYTHING looks wrong (stretched, distorted, artifacts), adjust and re-encode

CRITICAL: PRESERVE ASPECT RATIOS - Never stretch content!
- When scaling, ALWAYS maintain the original aspect ratio
- Use scale with force_original_aspect_ratio and pad to fill:
  scale=WIDTH:HEIGHT:force_original_aspect_ratio=decrease,pad=WIDTH:HEIGHT:(ow-iw)/2:(oh-ih)/2:black
- Or calculate the correct height/width to maintain aspect ratio

SPLIT-SCREEN LAYOUT (when webcam detected):
- Top panel: Screen content (terminal, code, slides) - approximately 65% of height
- Bottom panel: Webcam feed - approximately 35% of height
- Both panels should be 1080 pixels wide
- Total height must be 1920 pixels (9:16 portrait)

Example filter_complex that PRESERVES aspect ratios:
[0:v]crop=SCREEN_W:SCREEN_H:X:Y,scale=1080:-2,pad=1080:1248:(ow-iw)/2:(oh-ih)/2:black[top];
[0:v]crop=CAM_W:CAM_H:X:Y,scale=1080:-2,pad=1080:672:(ow-iw)/2:(oh-ih)/2:black[bottom];
[top][bottom]vstack[out]

The -2 in scale maintains aspect ratio. The pad centers content if needed.

Output dimensions: 1080x1920 (9:16 portrait)`

// ── JSON Schemas for tools ──────────────────────────────────────────────────

const CAPTURE_FRAME_SCHEMA = {
  type: 'object',
  properties: {
    video_path: {
      type: 'string',
      description: 'Path to the video file',
    },
    timestamp: {
      type: 'number',
      description: 'Time in seconds to capture the frame',
    },
  },
  required: ['video_path', 'timestamp'],
}

const GET_VIDEO_INFO_SCHEMA = {
  type: 'object',
  properties: {
    video_path: {
      type: 'string',
      description: 'Path to the video file',
    },
  },
  required: ['video_path'],
}

const RUN_FFMPEG_SCHEMA = {
  type: 'object',
  properties: {
    args: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of arguments to pass to FFmpeg',
    },
  },
  required: ['args'],
}

// ── Agent ────────────────────────────────────────────────────────────────────

export class LayoutAgent extends BaseAgent {
  constructor(model?: string) {
    super('LayoutAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'capture_frame',
        description:
          'Capture a frame from the video at a specific timestamp. Returns { imagePath } which will be displayed for vision analysis.',
        parameters: CAPTURE_FRAME_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('capture_frame', args as Record<string, unknown>)
        },
      },
      {
        name: 'get_video_info',
        description:
          'Get video dimensions and duration. Returns { width, height, duration, fps }.',
        parameters: GET_VIDEO_INFO_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('get_video_info', args as Record<string, unknown>)
        },
      },
      {
        name: 'run_ffmpeg',
        description:
          'Execute an arbitrary FFmpeg command. Returns { success, outputPath, error }.',
        parameters: RUN_FFMPEG_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('run_ffmpeg', args as Record<string, unknown>)
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
        const videoPath = args.video_path as string
        const timestamp = args.timestamp as number
        logger.info(`[LayoutAgent] Capturing frame at ${timestamp}s from ${videoPath}`)
        const result = await captureFrame(videoPath, timestamp)
        // Return with imagePath so vision system picks up the image
        return { imagePath: result.imagePath }
      }

      case 'get_video_info': {
        const videoPath = args.video_path as string
        logger.info(`[LayoutAgent] Getting video info for ${videoPath}`)
        return await getVideoInfo(videoPath)
      }

      case 'run_ffmpeg': {
        const ffmpegArgs = args.args as string[]
        logger.info(`[LayoutAgent] Running FFmpeg with ${ffmpegArgs.length} args`)
        return await runFfmpeg(ffmpegArgs)
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  /**
   * Analyze the video layout and create a portrait variant.
   *
   * @param videoPath - Path to the source video
   * @param outputPath - Path where the portrait video should be saved
   * @returns The final response from the agent
   */
  async createPortraitVariant(videoPath: string, outputPath: string): Promise<string> {
    const prompt = [
      `Create a portrait (9:16) variant of this video.`,
      ``,
      `Input video: ${videoPath}`,
      `Output path: ${outputPath}`,
      ``,
      `Analyze the video layout, identify any webcam/screen regions, and create an optimized portrait version.`,
      `The output must be exactly 1080x1920 pixels.`,
    ].join('\n')

    return this.run(prompt)
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a portrait variant of the given video using vision-based layout analysis.
 *
 * @param videoPath - Path to the source video
 * @param outputPath - Path where the portrait video should be saved
 * @param model - Optional model override
 * @returns The agent's final response describing what was done
 */
export async function createPortraitVariant(
  videoPath: string,
  outputPath: string,
  model?: string,
): Promise<string> {
  const agent = new LayoutAgent(model)

  try {
    return await agent.createPortraitVariant(videoPath, outputPath)
  } finally {
    await agent.destroy()
  }
}

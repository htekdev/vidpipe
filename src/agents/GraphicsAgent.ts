import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import type { EnhancementOpportunity, GeneratedOverlay, OverlayRegion } from '../types/index.js'
import { generateImage } from '../tools/imageGeneration.js'
import { slugify } from '../core/text.js'
import { join } from '../core/paths.js'
import { ensureDirectory } from '../core/fileSystem.js'
import logger from '../config/logger.js'
import sharp from 'sharp'

const SYSTEM_PROMPT = `You are a visual content designer and editorial director for educational video content. You are given an editorial report from a video analyst describing moments in a video where AI-generated image overlays could enhance viewer comprehension.

Your job is to make the FINAL editorial decision for each opportunity:
1. Decide whether to generate an image or skip the opportunity
2. Determine the exact timing — when the image should appear and disappear
3. Choose the optimal screen placement to avoid blocking important content
4. Write a refined, high-quality image generation prompt

Guidelines for editorial decisions:
- Only generate images that genuinely add value — quality over quantity
- Timing should match the speaker's explanation: appear when the topic starts, disappear when they move on
- Keep display duration between 5-12 seconds — long enough to register, short enough to not overstay
- Ensure at least 10 seconds gap between consecutive overlays to avoid visual clutter
- Choose placement regions that avoid the webcam, main content area, and any important UI elements
- Size should be 15-30% of video width — large enough to see, small enough to not dominate

Guidelines for image prompts:
- Create clean, professional diagrams and illustrations
- Use flat design / modern infographic style
- Include labels and annotations when helpful
- Avoid photorealistic imagery — prefer stylized educational graphics
- Keep the image simple and immediately understandable at a glance
- The image will be shown as a small overlay, so avoid tiny details
- Use high contrast colors for visibility when overlaid on video
- No text-heavy images — a few key labels at most
- Let the image content dictate its natural aspect ratio — don't force square if the content is better as landscape or portrait

Process the report and call generate_enhancement for each image worth creating, or call skip_opportunity for those not worth generating.`

const GENERATE_ENHANCEMENT_SCHEMA = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: 'A refined, high-quality image generation prompt describing the visual to create',
    },
    timestampStart: {
      type: 'number',
      description: 'When to start showing the image (seconds from video start)',
    },
    timestampEnd: {
      type: 'number',
      description: 'When to stop showing the image (seconds from video start). Should be 5-12 seconds after timestampStart.',
    },
    region: {
      type: 'string',
      enum: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center-right', 'center-left'],
      description: 'Screen region for placement, chosen to avoid blocking important content',
    },
    sizePercent: {
      type: 'number',
      description: 'Image width as percentage of video width (15-30)',
    },
    topic: {
      type: 'string',
      description: 'Brief label for what this image illustrates',
    },
    reason: {
      type: 'string',
      description: 'Why this visual enhancement helps the viewer',
    },
  },
  required: ['prompt', 'timestampStart', 'timestampEnd', 'region', 'sizePercent', 'topic', 'reason'],
} as const

const SKIP_OPPORTUNITY_SCHEMA = {
  type: 'object',
  properties: {
    topic: {
      type: 'string',
      description: 'The topic from the report that is being skipped',
    },
    reason: {
      type: 'string',
      description: 'Why this opportunity should be skipped',
    },
  },
  required: ['topic', 'reason'],
} as const

class GraphicsAgent extends BaseAgent {
  private overlays: GeneratedOverlay[] = []
  private enhancementsDir = ''
  private imageIndex = 0

  constructor(model?: string) {
    super('GraphicsAgent', SYSTEM_PROMPT, undefined, model)
  }

  setContext(enhancementsDir: string): void {
    this.enhancementsDir = enhancementsDir
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'generate_enhancement',
        description:
          'Generate an AI image overlay for a specific moment in the video. You decide the timing, placement, and prompt.',
        parameters: GENERATE_ENHANCEMENT_SCHEMA,
        handler: async (args: unknown) =>
          this.handleToolCall('generate_enhancement', args as Record<string, unknown>),
      },
      {
        name: 'skip_opportunity',
        description:
          'Skip an enhancement opportunity from the report that is not worth generating.',
        parameters: SKIP_OPPORTUNITY_SCHEMA,
        handler: async (args: unknown) =>
          this.handleToolCall('skip_opportunity', args as Record<string, unknown>),
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (toolName === 'generate_enhancement') {
      const prompt = args.prompt as string
      const timestampStart = args.timestampStart as number
      const timestampEnd = args.timestampEnd as number
      const region = args.region as OverlayRegion
      const sizePercent = Math.min(30, Math.max(15, args.sizePercent as number))
      const topic = args.topic as string
      const reason = args.reason as string

      const slug = slugify(topic, { lower: true, strict: true })
      const filename = `${this.imageIndex}-${slug}.png`
      const outputPath = join(this.enhancementsDir, filename)

      try {
        // Let GPT decide the aspect ratio by using size: 'auto'
        await generateImage(prompt, outputPath, { size: 'auto' })

        // Read actual image dimensions from the generated file
        const metadata = await sharp(outputPath).metadata()
        const width = metadata.width ?? 1024
        const height = metadata.height ?? 1024

        const opportunity: EnhancementOpportunity = {
          timestampStart,
          timestampEnd,
          topic,
          imagePrompt: prompt,
          reason,
          placement: { region, avoidAreas: [], sizePercent },
          confidence: 1.0,
        }

        const overlay: GeneratedOverlay = {
          opportunity,
          imagePath: outputPath,
          width,
          height,
        }
        this.overlays.push(overlay)
        this.imageIndex++
        logger.info(`Generated enhancement image: ${filename} (${width}x${height})`)
        return { success: true, imagePath: outputPath, dimensions: `${width}x${height}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to generate image for "${topic}": ${message}`)
        return { error: message }
      }
    }

    if (toolName === 'skip_opportunity') {
      const topic = args.topic as string
      const reason = args.reason as string
      logger.info(`Skipped enhancement opportunity "${topic}": ${reason}`)
      return { success: true, skipped: true }
    }

    throw new Error(`Unknown tool: ${toolName}`)
  }

  getOverlays(): GeneratedOverlay[] {
    return this.overlays
  }
}

/**
 * Generate enhancement images based on Gemini's editorial report.
 * The GraphicsAgent makes all editorial decisions: timing, placement, and image content.
 *
 * @param enhancementReport - Raw editorial report from Gemini analysis
 * @param enhancementsDir - Directory to save generated images
 * @param videoDuration - Video duration in seconds (for context)
 * @param model - LLM model for the agent
 * @returns Generated overlays ready for FFmpeg compositing
 */
export async function generateEnhancementImages(
  enhancementReport: string,
  enhancementsDir: string,
  videoDuration: number,
  model?: string,
): Promise<GeneratedOverlay[]> {
  await ensureDirectory(enhancementsDir)

  const agent = new GraphicsAgent(model)
  agent.setContext(enhancementsDir)

  try {
    const userMessage = `Here is the editorial report from our video analyst. The video is ${videoDuration.toFixed(1)} seconds long.

Review each opportunity and make your editorial decision — generate an image or skip it.

---

${enhancementReport}`

    await agent.run(userMessage)
    return agent.getOverlays()
  } finally {
    await agent.destroy()
  }
}

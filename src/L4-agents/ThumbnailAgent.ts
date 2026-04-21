import type { ToolWithHandler } from '../L3-services/llm/providerFactory.js'
import { join } from '../L1-infra/paths/paths.js'
import { ensureDirectory, fileExists } from '../L1-infra/fileSystem/fileSystem.js'
import { BaseAgent } from './BaseAgent.js'
import logger from '../L1-infra/logger/configLogger.js'
import { getBrandConfig, getThumbnailConfig } from '../L1-infra/config/brand.js'
import { generateThumbnail } from '../L3-services/imageGeneration/thumbnailGeneration.js'
import { captureFrame } from '../L3-services/videoOperations/videoOperations.js'
import type {
  ThumbnailResult,
  ThumbnailContentType,
} from '../L0-pure/types/index.js'

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const brand = getBrandConfig()
  const thumbConfig = getThumbnailConfig()

  return `You are a thumbnail designer for ${brand.name} (${brand.handle}). You create compelling, click-worthy thumbnails for video content across social media platforms.

## Brand Context
- **Voice:** ${brand.voice.tone}
- **Topics:** ${brand.advocacy.interests.join(', ')}
- **Style:** ${thumbConfig.style ?? 'Bold, professional, tech-focused'}

## Thumbnail Best Practices
- **YouTube:** Large readable text (3-5 words max), high contrast colors, expressive face/reaction, clean background
- **TikTok:** Vertical format, bold colors, emoji-friendly, curiosity gap
- **Instagram:** Clean aesthetic, vibrant colors, minimal text, square format
- **LinkedIn:** Professional, informative, branded, landscape format
- **X/Twitter:** Eye-catching, contrast-heavy, works at small sizes

## Your Task
Given video context (title, description, hook, key topics), plan a thumbnail by:
1. Identifying the most visually compelling concept
2. Crafting a detailed image generation prompt
3. Calling the generate_thumbnail tool to create it

## Rules
- The thumbnail should make someone STOP scrolling
- Use the video's hook or most surprising element as the visual concept
- Include text overlay descriptions in the prompt (the model renders text well)
- Keep text to 3-5 impactful words maximum
- Describe colors, composition, lighting, and mood explicitly
- If a reference image style is configured, the generation will automatically use it for style transfer`
}

// ── Agent ─────────────────────────────────────────────────────────────────────

interface ThumbnailContext {
  title: string
  description: string
  hook?: string
  topics?: string[]
  videoPath: string
  outputDir: string
  contentType: ThumbnailContentType
  platform?: string
}

export class ThumbnailAgent extends BaseAgent {
  private generatedThumbnails: ThumbnailResult[] = []
  private context: ThumbnailContext | null = null

  constructor(provider?: import('../L3-services/llm/providerFactory.js').LLMProvider) {
    super('ThumbnailAgent', buildSystemPrompt(), provider)
  }

  protected override resetForRetry(): void {
    this.generatedThumbnails = []
  }

  protected override getTools(): ToolWithHandler[] {
    return [
      {
        name: 'generate_thumbnail',
        description: 'Generate a thumbnail image from a detailed prompt. The system will automatically apply brand style and reference image if configured.',
        parameters: {
          type: 'object' as const,
          properties: {
            prompt: {
              type: 'string',
              description: 'Detailed description of the thumbnail to generate. Include: visual concept, text overlay (3-5 words), colors, composition, lighting, mood. Be specific and vivid.',
            },
            filename: {
              type: 'string',
              description: 'Filename for the thumbnail (without extension). E.g. "thumbnail" or "thumbnail-youtube"',
            },
          },
          required: ['prompt', 'filename'],
        },
        handler: async (args) => this.handleToolCall('generate_thumbnail', args as Record<string, unknown>),
      },
      {
        name: 'capture_best_frame',
        description: 'Capture a frame from the video at a specific timestamp to use as inspiration for the thumbnail concept.',
        parameters: {
          type: 'object' as const,
          properties: {
            timestamp: {
              type: 'number',
              description: 'Timestamp in seconds to capture the frame at',
            },
          },
          required: ['timestamp'],
        },
        handler: async (args) => this.handleToolCall('capture_best_frame', args as Record<string, unknown>),
      },
    ]
  }

  protected override async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'generate_thumbnail':
        return this.handleGenerateThumbnail(args)
      case 'capture_best_frame':
        return this.handleCaptureBestFrame(args)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async handleGenerateThumbnail(args: Record<string, unknown>): Promise<string> {
    const prompt = String(args.prompt ?? '')
    const filename = String(args.filename ?? 'thumbnail')

    if (!this.context) {
      throw new Error('No context set — call generateForClip() first')
    }

    const outputPath = join(this.context.outputDir, `${filename}.png`)
    await ensureDirectory(this.context.outputDir)

    const result = await generateThumbnail(
      prompt,
      outputPath,
      this.context.platform,
      this.context.contentType,
    )

    if (result) {
      const thumbnailResult: ThumbnailResult = {
        prompt,
        outputPath: result,
        referenceUsed: getThumbnailConfig().referenceImage !== undefined,
        platform: this.context.platform,
      }
      this.generatedThumbnails.push(thumbnailResult)
      logger.info(`[ThumbnailAgent] Generated thumbnail: ${result}`)
      return `Thumbnail generated successfully at ${result}`
    }

    return 'Thumbnail generation is disabled for this configuration'
  }

  private async handleCaptureBestFrame(args: Record<string, unknown>): Promise<string> {
    const timestamp = Number(args.timestamp ?? 0)

    if (!this.context) {
      throw new Error('No context set — call generateForClip() first')
    }

    const framePath = join(this.context.outputDir, `frame-${Math.round(timestamp)}s.png`)
    await ensureDirectory(this.context.outputDir)

    try {
      await captureFrame(this.context.videoPath, timestamp, framePath)
      return `Frame captured at ${timestamp}s → ${framePath}`
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[ThumbnailAgent] Failed to capture frame at ${timestamp}s: ${msg}`)
      return `Failed to capture frame: ${msg}`
    }
  }

  /**
   * Generate a thumbnail for a video clip or main video.
   *
   * The agent analyzes the provided context and plans a compelling thumbnail,
   * then calls the generate_thumbnail tool to create it.
   *
   * @returns Array of generated thumbnails (usually 1, but could be more if platform-specific)
   */
  async generateForClip(context: ThumbnailContext): Promise<ThumbnailResult[]> {
    this.context = context
    this.generatedThumbnails = []

    const thumbConfig = getThumbnailConfig()
    if (!thumbConfig.enabled) {
      logger.info('[ThumbnailAgent] Thumbnail generation is disabled')
      return []
    }

    // If there's a promptOverride, skip the agent planning and generate directly
    if (thumbConfig.promptOverride) {
      logger.info('[ThumbnailAgent] Using prompt override from brand config')
      const outputPath = join(context.outputDir, 'thumbnail.png')
      await ensureDirectory(context.outputDir)

      const result = await generateThumbnail(
        thumbConfig.promptOverride,
        outputPath,
        context.platform,
        context.contentType,
      )

      if (result) {
        const thumbnailResult: ThumbnailResult = {
          prompt: thumbConfig.promptOverride,
          outputPath: result,
          referenceUsed: thumbConfig.referenceImage !== undefined,
          platform: context.platform,
        }
        return [thumbnailResult]
      }
      return []
    }

    // Build the user message with clip context for the agent to plan
    const topicsStr = context.topics?.length ? `\n- **Key Topics:** ${context.topics.join(', ')}` : ''
    const hookStr = context.hook ? `\n- **Hook:** ${context.hook}` : ''
    const platformStr = context.platform ? `\n- **Target Platform:** ${context.platform}` : ''

    const userMessage = `Generate a thumbnail for this ${context.contentType} content:

- **Title:** ${context.title}
- **Description:** ${context.description}${hookStr}${topicsStr}${platformStr}

Call the generate_thumbnail tool with a detailed, vivid prompt that will create a click-worthy thumbnail. Remember to include text overlay in your prompt (3-5 words max).`

    await this.run(userMessage)

    return this.generatedThumbnails
  }

  /** Clean up the LLM session. */
  async destroy(): Promise<void> {
    await super.destroy()
  }
}

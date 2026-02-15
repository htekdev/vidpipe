import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent.js'
import type { EnhancementOpportunity, GeneratedOverlay } from '../types/index.js'
import { generateImage } from '../tools/imageGeneration.js'
import { slugify } from '../core/text.js'
import { join } from '../core/paths.js'
import { ensureDirectory } from '../core/fileSystem.js'
import logger from '../config/logger.js'

const SYSTEM_PROMPT = `You are a visual content designer for educational video content. You are given a list of moments in a video where an AI-generated image could help viewers understand the topic being discussed.

For each opportunity, you must either:
1. Call generate_image with a refined, high-quality prompt that will produce a clear, educational illustration
2. Call skip_opportunity if the image isn't worth generating

Guidelines for image prompts:
- Create clean, professional diagrams and illustrations
- Use flat design / modern infographic style
- Include labels and annotations when helpful
- Avoid photorealistic imagery — prefer stylized educational graphics
- Keep the image simple and immediately understandable at a glance
- The image will be shown as a small overlay (15-30% of screen), so avoid tiny details
- Use high contrast colors for visibility when overlaid on video
- No text-heavy images — a few key labels at most

Process ALL opportunities — do not leave any unaddressed.`

const GENERATE_IMAGE_SCHEMA = {
  type: 'object',
  properties: {
    index: {
      type: 'number',
      description: 'The index of the enhancement opportunity to generate an image for',
    },
    prompt: {
      type: 'string',
      description: 'A refined, high-quality image generation prompt',
    },
    style: {
      type: 'string',
      description: 'Optional style modifier for the image generation',
    },
  },
  required: ['index', 'prompt'],
} as const

const SKIP_OPPORTUNITY_SCHEMA = {
  type: 'object',
  properties: {
    index: {
      type: 'number',
      description: 'The index of the enhancement opportunity to skip',
    },
    reason: {
      type: 'string',
      description: 'Why this opportunity should be skipped',
    },
  },
  required: ['index', 'reason'],
} as const

class GraphicsAgent extends BaseAgent {
  private overlays: GeneratedOverlay[] = []
  private skippedIndices: Set<number> = new Set()
  private opportunities: EnhancementOpportunity[] = []
  private enhancementsDir = ''

  constructor(model?: string) {
    super('GraphicsAgent', SYSTEM_PROMPT, undefined, model)
  }

  setContext(opportunities: EnhancementOpportunity[], enhancementsDir: string): void {
    this.opportunities = opportunities
    this.enhancementsDir = enhancementsDir
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'generate_image',
        description:
          'Generate an AI image for an enhancement opportunity. Provide the opportunity index and a refined prompt.',
        parameters: GENERATE_IMAGE_SCHEMA,
        handler: async (args: unknown) =>
          this.handleToolCall('generate_image', args as Record<string, unknown>),
      },
      {
        name: 'skip_opportunity',
        description:
          'Skip an enhancement opportunity that is not worth generating an image for.',
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
    if (toolName === 'generate_image') {
      const index = args.index as number
      const prompt = args.prompt as string
      const style = args.style as string | undefined

      if (index < 0 || index >= this.opportunities.length) {
        return { error: `Invalid index ${index}. Must be 0-${this.opportunities.length - 1}.` }
      }

      const opportunity = this.opportunities[index]
      const slug = slugify(opportunity.topic, { lower: true, strict: true })
      const filename = `${index}-${slug}.png`
      const outputPath = join(this.enhancementsDir, filename)

      try {
        await generateImage(prompt, outputPath, { style })
        const overlay: GeneratedOverlay = {
          opportunity,
          imagePath: outputPath,
          width: 1024,
          height: 1024,
        }
        this.overlays.push(overlay)
        logger.info(`Generated enhancement image: ${filename}`)
        return { success: true, imagePath: outputPath }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Failed to generate image for opportunity ${index}: ${message}`)
        return { error: message }
      }
    }

    if (toolName === 'skip_opportunity') {
      const index = args.index as number
      const reason = args.reason as string
      this.skippedIndices.add(index)
      logger.info(`Skipped enhancement opportunity ${index}: ${reason}`)
      return { success: true, skipped: true }
    }

    throw new Error(`Unknown tool: ${toolName}`)
  }

  getOverlays(): GeneratedOverlay[] {
    return this.overlays
  }
}

export async function generateEnhancementImages(
  opportunities: EnhancementOpportunity[],
  enhancementsDir: string,
  model?: string,
): Promise<GeneratedOverlay[]> {
  await ensureDirectory(enhancementsDir)

  const agent = new GraphicsAgent(model)
  agent.setContext(opportunities, enhancementsDir)

  try {
    const lines = opportunities.map((opp, i) =>
      [
        `## Opportunity ${i}`,
        `- **Topic:** ${opp.topic}`,
        `- **Timestamp:** ${opp.timestampStart.toFixed(1)}s – ${opp.timestampEnd.toFixed(1)}s`,
        `- **Reason:** ${opp.reason}`,
        `- **Suggested prompt:** ${opp.imagePrompt}`,
      ].join('\n'),
    )

    const userMessage = `Here are ${opportunities.length} enhancement opportunities to process:\n\n${lines.join('\n\n')}`

    await agent.run(userMessage)
    return agent.getOverlays()
  } finally {
    await agent.destroy()
  }
}

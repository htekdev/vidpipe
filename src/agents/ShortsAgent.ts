import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, ShortClip, ShortSegment, ShortClipVariant } from '../types'
import { extractClip, extractCompositeClip } from '../tools/ffmpeg/clipExtraction'
import { generateStyledASSForSegment, generateStyledASSForComposite, generatePortraitASSWithHook, generatePortraitASSWithHookComposite } from '../tools/captions/captionGenerator'
import { burnCaptions } from '../tools/ffmpeg/captionBurning'
import { generatePlatformVariants, type Platform } from '../tools/ffmpeg/aspectRatio'
import { v4 as uuidv4 } from 'uuid'
import slugify from 'slugify'
import { promises as fs } from 'fs'
import path from 'path'
import logger from '../config/logger'

// ── Types for the LLM's plan_shorts tool call ──────────────────────────────

interface PlannedSegment {
  start: number
  end: number
  description: string
}

interface PlannedShort {
  title: string
  description: string
  tags: string[]
  segments: PlannedSegment[]
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a short-form video content strategist. Your job is to analyze a video transcript with word-level timestamps and identify the most compelling moments to extract as shorts (15–60 seconds each).

## What to look for
- **Key insights** — concise, quotable takeaways
- **Funny moments** — humor, wit, unexpected punchlines
- **Controversial takes** — bold opinions that spark discussion
- **Educational nuggets** — clear explanations of complex topics
- **Emotional peaks** — passion, vulnerability, excitement
- **Topic compilations** — multiple brief mentions of one theme that can be stitched together

## Short types
- **Single segment** — one contiguous section of the video
- **Composite** — multiple non-contiguous segments combined into one short (great for topic compilations or building a narrative arc)

## Rules
1. Each short must be 15–60 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence boundaries for clean cuts.
4. Aim for 3–8 shorts per video, depending on length and richness.
5. Every short needs a catchy, descriptive title (5–10 words).
6. Tags should be lowercase, no hashes, 3–6 per short.
7. A 1-second buffer is automatically added before and after each segment boundary during extraction, so plan segments based on content timestamps without worrying about clipping words at the edges.

When you have identified the shorts, call the **plan_shorts** tool with your complete plan.`

// ── JSON Schema for the plan_shorts tool ────────────────────────────────────

const PLAN_SHORTS_SCHEMA = {
  type: 'object',
  properties: {
    shorts: {
      type: 'array',
      description: 'Array of planned short clips',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Catchy short title (5–10 words)' },
          description: { type: 'string', description: 'Brief description of the short content' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lowercase tags without hashes, 3–6 per short',
          },
          segments: {
            type: 'array',
            description: 'One or more time segments that compose this short',
            items: {
              type: 'object',
              properties: {
                start: { type: 'number', description: 'Start time in seconds' },
                end: { type: 'number', description: 'End time in seconds' },
                description: { type: 'string', description: 'What happens in this segment' },
              },
              required: ['start', 'end', 'description'],
            },
          },
        },
        required: ['title', 'description', 'tags', 'segments'],
      },
    },
  },
  required: ['shorts'],
}

// ── Agent ────────────────────────────────────────────────────────────────────

class ShortsAgent extends BaseAgent {
  private plannedShorts: PlannedShort[] = []

  constructor() {
    super('ShortsAgent', SYSTEM_PROMPT)
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'plan_shorts',
        description:
          'Submit the planned shorts as a structured JSON array. Call this once with all planned shorts.',
        parameters: PLAN_SHORTS_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('plan_shorts', args as Record<string, unknown>)
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (toolName === 'plan_shorts') {
      this.plannedShorts = args.shorts as PlannedShort[]
      logger.info(`[ShortsAgent] Planned ${this.plannedShorts.length} shorts`)
      return { success: true, count: this.plannedShorts.length }
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }

  getPlannedShorts(): PlannedShort[] {
    return this.plannedShorts
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateShorts(
  video: VideoFile,
  transcript: Transcript,
): Promise<ShortClip[]> {
  const agent = new ShortsAgent()

  // Build prompt with full transcript including word-level timestamps
  const transcriptLines = transcript.segments.map((seg) => {
    const words = seg.words
      .map((w) => `[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`)
      .join(' ')
    return `[${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s] ${seg.text}\nWords: ${words}`
  })

  const prompt = [
    `Analyze the following transcript (${transcript.duration.toFixed(0)}s total) and plan shorts.\n`,
    `Video: ${video.filename}`,
    `Duration: ${transcript.duration.toFixed(1)}s\n`,
    '--- TRANSCRIPT ---\n',
    transcriptLines.join('\n\n'),
    '\n--- END TRANSCRIPT ---',
  ].join('\n')

  try {
    await agent.run(prompt)
    const planned = agent.getPlannedShorts()

    if (planned.length === 0) {
      logger.warn('[ShortsAgent] No shorts were planned')
      return []
    }

    const shortsDir = path.join(path.dirname(video.repoPath), 'shorts')
    await fs.mkdir(shortsDir, { recursive: true })

    const shorts: ShortClip[] = []

    for (const plan of planned) {
      const id = uuidv4()
      const shortSlug = slugify(plan.title, { lower: true, strict: true })
      const totalDuration = plan.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
      const outputPath = path.join(shortsDir, `${shortSlug}.mp4`)

      const segments: ShortSegment[] = plan.segments.map((s) => ({
        start: s.start,
        end: s.end,
        description: s.description,
      }))

      // Extract the clip (single or composite)
      if (segments.length === 1) {
        await extractClip(video.repoPath, segments[0].start, segments[0].end, outputPath)
      } else {
        await extractCompositeClip(video.repoPath, segments, outputPath)
      }

      // Generate platform-specific aspect ratio variants from UNCAPTIONED video
      // so portrait/square crops are clean before captions are burned per-variant
      let variants: ShortClipVariant[] | undefined
      try {
        const defaultPlatforms: Platform[] = ['tiktok', 'youtube-shorts', 'instagram-reels', 'instagram-feed', 'linkedin']
        const results = await generatePlatformVariants(outputPath, shortsDir, shortSlug, defaultPlatforms)
        if (results.length > 0) {
          variants = results.map((v) => ({
            path: v.path,
            aspectRatio: v.aspectRatio,
            platform: v.platform as ShortClipVariant['platform'],
            width: v.width,
            height: v.height,
          }))
          logger.info(`[ShortsAgent] Generated ${variants.length} platform variants for: ${plan.title}`)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[ShortsAgent] Platform variant generation failed for ${plan.title}: ${message}`)
      }

      // Generate ASS captions for the landscape short and burn them in
      let captionedPath: string | undefined
      try {
        const assContent = segments.length === 1
          ? generateStyledASSForSegment(transcript, segments[0].start, segments[0].end)
          : generateStyledASSForComposite(transcript, segments)

        const assPath = path.join(shortsDir, `${shortSlug}.ass`)
        await fs.writeFile(assPath, assContent)

        captionedPath = path.join(shortsDir, `${shortSlug}-captioned.mp4`)
        await burnCaptions(outputPath, assPath, captionedPath)
        logger.info(`[ShortsAgent] Burned captions for short: ${plan.title}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[ShortsAgent] Caption burning failed for ${plan.title}: ${message}`)
        captionedPath = undefined
      }

      // Burn portrait-style captions (green highlight, centered, hook overlay) onto portrait variant
      if (variants) {
        const portraitVariant = variants.find(v => v.aspectRatio === '9:16')
        if (portraitVariant) {
          try {
            const portraitAssContent = segments.length === 1
              ? generatePortraitASSWithHook(transcript, plan.title, segments[0].start, segments[0].end)
              : generatePortraitASSWithHookComposite(transcript, segments, plan.title)
            const portraitAssPath = path.join(shortsDir, `${shortSlug}-portrait.ass`)
            await fs.writeFile(portraitAssPath, portraitAssContent)
            const portraitCaptionedPath = portraitVariant.path.replace('.mp4', '-captioned.mp4')
            await burnCaptions(portraitVariant.path, portraitAssPath, portraitCaptionedPath)
            // Update the variant path to point to the captioned version
            portraitVariant.path = portraitCaptionedPath
            logger.info(`[ShortsAgent] Burned portrait captions with hook for: ${plan.title}`)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`[ShortsAgent] Portrait caption burning failed for ${plan.title}: ${message}`)
          }
        }
      }

      // Generate description markdown
      const mdPath = path.join(shortsDir, `${shortSlug}.md`)
      const mdContent = [
        `# ${plan.title}\n`,
        plan.description,
        '',
        '## Segments\n',
        ...plan.segments.map(
          (s, i) => `${i + 1}. **${s.start.toFixed(2)}s – ${s.end.toFixed(2)}s** — ${s.description}`,
        ),
        '',
        '## Tags\n',
        plan.tags.map((t) => `- ${t}`).join('\n'),
        '',
      ].join('\n')
      await fs.writeFile(mdPath, mdContent)

      shorts.push({
        id,
        title: plan.title,
        slug: shortSlug,
        segments,
        totalDuration,
        outputPath,
        captionedPath,
        description: plan.description,
        tags: plan.tags,
        variants,
      })

      logger.info(`[ShortsAgent] Created short: ${plan.title} (${totalDuration.toFixed(1)}s)`)
    }

    logger.info(`[ShortsAgent] Generated ${shorts.length} shorts`)
    return shorts
  } finally {
    await agent.destroy()
  }
}

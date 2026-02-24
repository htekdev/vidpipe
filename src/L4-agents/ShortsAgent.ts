import type { ToolWithHandler } from '../L3-services/llm/providerFactory.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, ShortClip, ShortSegment, ShortClipVariant, WebcamRegion } from '../L0-pure/types/index'
import { extractClip, extractCompositeClip, burnCaptions, generatePlatformVariants, type Platform } from '../L3-services/videoOperations/videoOperations.js'
import { generateStyledASSForSegment, generateStyledASSForComposite, generatePortraitASSWithHook, generatePortraitASSWithHookComposite } from '../L0-pure/captions/captionGenerator'

import { generateId } from '../L0-pure/text/text.js'
import { slugify } from '../L0-pure/text/text.js'
import { writeTextFile, writeJsonFile, ensureDirectory } from '../L1-infra/fileSystem/fileSystem.js'
import { join, dirname } from '../L1-infra/paths/paths.js'
import logger from '../L1-infra/logger/configLogger'

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
  hook?: string
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a short-form video content strategist. Your job is to **exhaustively** analyze a video transcript with word-level timestamps and extract every compelling moment as a short (15–60 seconds each).

## Your workflow
1. Read the transcript and note the total duration.
2. Work through the transcript **section by section** (roughly 3–5 minute chunks). For each chunk, identify every possible short.
3. Call **add_shorts** for each batch of shorts you find. You can call it as many times as needed.
4. After your first pass, call **review_shorts** to see everything you've planned so far.
5. Review for gaps: are there sections of the transcript with no shorts? Could any moments be combined into composites? Did you miss any humor, insights, or quotable moments?
6. Add any additional shorts you find.
7. When you are confident you've exhausted all opportunities, call **finalize_shorts**.

## Target quantity
Scale your output by video duration:
- **~1 short per 2–3 minutes** of video content.
- A 10-minute video → 4–6 shorts. A 30-minute video → 12–18 shorts. A 60-minute video → 20–30 shorts.
- These are guidelines, not hard caps — if the content is rich, find more. If it's sparse, find fewer.
- **Never stop at 3–8 shorts for a long video.** Your job is to be thorough.

## What to look for
- **Key insights** — concise, quotable takeaways
- **Funny moments** — humor, wit, unexpected punchlines
- **Controversial takes** — bold opinions that spark discussion
- **Educational nuggets** — clear explanations of complex topics
- **Emotional peaks** — passion, vulnerability, excitement
- **Audience hooks** — moments that would make someone stop scrolling
- **Before/after reveals** — showing a transformation or result
- **Mistakes & corrections** — relatable "oops" moments that humanize the speaker

## Short types
- **Single segment** — one contiguous section of the video
- **Composite** — multiple non-contiguous segments combined into one short (great for topic compilations, building narrative arcs, or "every time X happens" montages). **Actively look for composite opportunities** — they often make the best shorts.

## Rules
1. Each short must be 15–60 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence boundaries for clean cuts.
4. Every short needs a catchy, descriptive title (5–10 words).
5. Tags should be lowercase, no hashes, 3–6 per short.
6. A 1-second buffer is automatically added before and after each segment boundary during extraction, so plan segments based on content timestamps without worrying about clipping words at the edges.
7. Avoid significant timestamp overlap between shorts — each short should bring unique content. Small overlaps (a few seconds of shared context) are OK.

## Using Clip Direction
You may receive AI-generated clip direction with suggested shorts. Use these as a starting point but make your own decisions:
- The suggestions are based on visual + audio analysis and may identify moments you'd miss from transcript alone
- Feel free to adjust timestamps, combine suggestions, or ignore ones that don't work
- You may also find good shorts NOT in the suggestions — always analyze the full transcript

## Hook-First Ordering (CRITICAL for viewer retention)
Shorts are for people with short attention spans — if you don't grab them in the first 5 seconds, you lost them.

**The pattern:** If a short's content flows like [A, B, C, D, ..., Y, Z], the final short should play as [Z, A, B, C, ..., Y] — the most exciting moment (Z) is moved to the front, then the rest plays from the beginning up to that point. The hook does NOT repeat — the content is reordered, not duplicated.

**How to implement it:**
1. Plan the short's content as normal (the full story: A→Z)
2. Identify the single most exciting 2–5 second moment — the part that would make a scroller STOP and watch. This is usually near the end (the payoff), not the beginning (the setup).
3. Add that moment as the FIRST segment in the segments array
4. Then add the remaining content — from the beginning up to where the hook starts
5. Example: content is [120s–150s], best moment is [145s–150s] → segments: [{start: 145, end: 150}, {start: 120, end: 145}]
6. Provide a \`hook\` text (≤60 chars) — the attention-grabbing phrase shown as text overlay during the hook segment

**What makes a good hook moment:**
- A bold claim or controversial statement ("You need to STOP doing this")
- An emotional reaction or exclamation
- A surprising result or reveal
- A punchy one-liner that makes no sense without context (creates curiosity)

If the short truly has no standout moment (rare), keep segments chronological and just provide hook text.`

// ── JSON Schema for the add_shorts tool ──────────────────────────────────────

const ADD_SHORTS_SCHEMA = {
  type: 'object',
  properties: {
    shorts: {
      type: 'array',
      description: 'Array of short clips to add to the plan',
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
          hook: { type: 'string', description: 'Short attention-grabbing text (≤60 chars) for visual overlay. Falls back to title if not provided.' },
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
  private isFinalized = false

  constructor(model?: string) {
    super('ShortsAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected resetForRetry(): void {
    this.plannedShorts = []
    this.isFinalized = false
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'add_shorts',
        description:
          'Add one or more shorts to your plan. ' +
          'You can call this multiple times to build your list incrementally as you analyze each section of the transcript.',
        parameters: ADD_SHORTS_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('add_shorts', args as Record<string, unknown>)
        },
      },
      {
        name: 'review_shorts',
        description:
          'Review all shorts planned so far. Returns a summary of every short in your current plan. ' +
          'Use this to check for gaps, overlaps, or missed opportunities before finalizing.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          return this.handleToolCall('review_shorts', {})
        },
      },
      {
        name: 'finalize_shorts',
        description:
          'Finalize your short clip plan and trigger extraction. ' +
          'Call this ONCE after you have added all shorts and reviewed them for completeness.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          return this.handleToolCall('finalize_shorts', {})
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'add_shorts': {
        const newShorts = args.shorts as PlannedShort[]
        this.plannedShorts.push(...newShorts)
        logger.info(`[ShortsAgent] Added ${newShorts.length} shorts (total: ${this.plannedShorts.length})`)
        return `Added ${newShorts.length} shorts. Total planned: ${this.plannedShorts.length}. Call add_shorts for more, review_shorts to check your plan, or finalize_shorts when done.`
      }

      case 'review_shorts': {
        if (this.plannedShorts.length === 0) {
          return 'No shorts planned yet. Analyze the transcript and call add_shorts to start planning.'
        }
        const summary = this.plannedShorts.map((s, i) => {
          const totalDur = s.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
          const timeRanges = s.segments.map(seg => `${seg.start.toFixed(1)}s–${seg.end.toFixed(1)}s`).join(', ')
          const type = s.segments.length > 1 ? 'composite' : 'single'
          return `${i + 1}. "${s.title}" (${totalDur.toFixed(1)}s, ${type}) [${timeRanges}] — ${s.description}`
        }).join('\n')
        return `## Planned shorts (${this.plannedShorts.length} total)\n\n${summary}\n\nLook for gaps in transcript coverage, missed composite opportunities, and any additional compelling moments.`
      }

      case 'finalize_shorts': {
        this.isFinalized = true
        logger.info(`[ShortsAgent] Finalized ${this.plannedShorts.length} shorts`)
        return `Finalized ${this.plannedShorts.length} shorts. Extraction will begin.`
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  getPlannedShorts(): PlannedShort[] {
    return this.plannedShorts
  }

  getIsFinalized(): boolean {
    return this.isFinalized
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateShorts(
  video: VideoFile,
  transcript: Transcript,
  model?: string,
  clipDirection?: string,
  webcamOverride?: WebcamRegion | null,
): Promise<ShortClip[]> {
  const agent = new ShortsAgent(model)

  // Build prompt with full transcript including word-level timestamps
  const transcriptLines = transcript.segments.map((seg) => {
    const words = seg.words
      .map((w) => `[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`)
      .join(' ')
    return `[${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s] ${seg.text}\nWords: ${words}`
  })

  const promptParts = [
    `Analyze the following transcript (${transcript.duration.toFixed(0)}s total) and plan shorts.\n`,
    `Video: ${video.filename}`,
    `Duration: ${transcript.duration.toFixed(1)}s`,
    `Target: ~${Math.max(3, Math.round(transcript.duration / 150))}–${Math.max(5, Math.round(transcript.duration / 120))} shorts (scale by content richness)\n`,
    '--- TRANSCRIPT ---\n',
    transcriptLines.join('\n\n'),
    '\n--- END TRANSCRIPT ---',
  ]

  if (clipDirection) {
    promptParts.push(
      '\n--- CLIP DIRECTION (AI-generated suggestions — use as reference, make your own decisions) ---\n',
      clipDirection,
      '\n--- END CLIP DIRECTION ---',
    )
  }

  const prompt = promptParts.join('\n')

  try {
    let runError: Error | undefined
    
    // The Copilot SDK has a known bug where it throws "missing finish_reason"
    // even after tools completed successfully. We catch that specific error
    // and check if shorts were planned before re-throwing.
    try {
      await agent.run(prompt)
    } catch (err) {
      runError = err instanceof Error ? err : new Error(String(err))
      
      // Check if shorts were planned despite the error
      const partialPlanned = agent.getPlannedShorts()
      if (partialPlanned.length > 0 && runError.message.includes('missing finish_reason')) {
        logger.warn(`[ShortsAgent] SDK error after ${partialPlanned.length} shorts planned - proceeding with partial result`)
      } else {
        throw runError
      }
    }
    
    const planned = agent.getPlannedShorts()

    if (planned.length === 0) {
      // Re-throw original error if we have one but no shorts
      if (runError) throw runError
      logger.warn('[ShortsAgent] No shorts were planned')
      return []
    }

    await writeJsonFile(join(video.videoDir, 'shorts-plan.json'), planned)

    const shortsDir = join(dirname(video.repoPath), 'shorts')
    await ensureDirectory(shortsDir)

    const shorts: ShortClip[] = []

    for (const plan of planned) {
      const id = generateId()
      const shortSlug = slugify(plan.title)
      const totalDuration = plan.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
      const outputPath = join(shortsDir, `${shortSlug}.mp4`)

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
        const results = await generatePlatformVariants(outputPath, shortsDir, shortSlug, defaultPlatforms, { webcamOverride })
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

        const assPath = join(shortsDir, `${shortSlug}.ass`)
        await writeTextFile(assPath, assContent)

        captionedPath = join(shortsDir, `${shortSlug}-captioned.mp4`)
        await burnCaptions(outputPath, assPath, captionedPath)
        logger.info(`[ShortsAgent] Burned captions for short: ${plan.title}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[ShortsAgent] Caption burning failed for ${plan.title}: ${message}`)
        captionedPath = undefined
      }

      // Burn portrait-style captions (green highlight, centered, hook overlay) onto portrait variant
      if (variants) {
        // Burn captions for 9:16 portrait variants (tiktok, youtube-shorts, instagram-reels)
        const portraitVariants = variants.filter(v => v.aspectRatio === '9:16')
        if (portraitVariants.length > 0) {
          try {
            const hookText = plan.hook ?? plan.title
            const portraitAssContent = segments.length === 1
              ? generatePortraitASSWithHook(transcript, hookText, segments[0].start, segments[0].end)
              : generatePortraitASSWithHookComposite(transcript, segments, hookText)
            const portraitAssPath = join(shortsDir, `${shortSlug}-portrait.ass`)
            await writeTextFile(portraitAssPath, portraitAssContent)
            // All 9:16 variants share the same source file — burn once, update all paths
            const portraitCaptionedPath = portraitVariants[0].path.replace('.mp4', '-captioned.mp4')
            await burnCaptions(portraitVariants[0].path, portraitAssPath, portraitCaptionedPath)
            for (const v of portraitVariants) {
              v.path = portraitCaptionedPath
            }
            logger.info(`[ShortsAgent] Burned portrait captions with hook for: ${plan.title}`)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`[ShortsAgent] Portrait caption burning failed for ${plan.title}: ${message}`)
          }
        }

        // Burn captions for non-portrait variants (4:5 feed, 1:1 square)
        const nonPortraitVariants = variants.filter(v => v.aspectRatio !== '9:16')
        for (const variant of nonPortraitVariants) {
          try {
            const variantAssContent = segments.length === 1
              ? generateStyledASSForSegment(transcript, segments[0].start, segments[0].end)
              : generateStyledASSForComposite(transcript, segments)
            const suffix = variant.aspectRatio === '4:5' ? 'feed' : 'square'
            const variantAssPath = join(shortsDir, `${shortSlug}-${suffix}.ass`)
            await writeTextFile(variantAssPath, variantAssContent)
            const variantCaptionedPath = variant.path.replace('.mp4', '-captioned.mp4')
            await burnCaptions(variant.path, variantAssPath, variantCaptionedPath)
            variant.path = variantCaptionedPath
            logger.info(`[ShortsAgent] Burned ${suffix} captions for: ${plan.title}`)
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            logger.warn(`[ShortsAgent] ${variant.aspectRatio} caption burning failed for ${plan.title}: ${message}`)
          }
        }
      }

      // Generate description markdown
      const mdPath = join(shortsDir, `${shortSlug}.md`)
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
      await writeTextFile(mdPath, mdContent)

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
        hook: plan.hook,
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

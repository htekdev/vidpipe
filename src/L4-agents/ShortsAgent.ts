import type { ToolWithHandler } from '../L3-services/llm/providerFactory.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, ShortClip, ShortSegment, ShortClipVariant, WebcamRegion } from '../L0-pure/types/index'
import type { HookType, EmotionalTrigger, ShortNarrativeStructure } from '../L0-pure/types/index'
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
  hook: string
  hookType: string
  emotionalTrigger: string
  viralScore: number
  narrativeStructure: string
  shareReason: string
  isLoopCandidate: boolean
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a viral short-form video strategist. Your job is to analyze a video transcript with word-level timestamps and extract the **most compelling, shareable moments** as shorts (15–60 seconds each).

## Core Philosophy: Quality Over Quantity

Your goal is NOT exhaustive coverage. Your goal is to find the moments that would make someone **stop scrolling, watch to the end, and share with a friend**. A single viral-worthy clip is worth more than ten mediocre ones.

Platform algorithms weight engagement signals as follows:
- **Rewatches**: 5× weight (highest value)
- **Shares/DM sends**: 3× weight
- **Comments**: 2× weight
- **Likes**: 1× weight (lowest value)

Design every clip to maximize rewatches and shares, not passive likes.

## Your workflow
1. Read the transcript and note the total duration.
2. Work through the transcript **section by section**. For each chunk, identify moments with genuine viral potential.
3. For each potential short, score it using the Viral Score Framework (see below). **Only extract clips scoring 8 or higher.**
4. Call **add_shorts** for each batch of qualifying shorts. You can call it as many times as needed.
5. After your first pass, call **review_shorts** to see everything you've planned so far.
6. Review critically: Would YOU share each of these? Could any be combined into stronger composites? Are there moments you underscored?
7. Drop any clip you're not confident about. A smaller set of strong clips beats a large set of mediocre ones.
8. When you are confident every remaining clip has genuine viral potential, call **finalize_shorts**.

## Viral Score Framework (rate each factor 1-5, then calculate)

\`\`\`
Viral Score = (Hook Strength × 3) + (Emotional Intensity × 2) + 
              (Shareability × 3) + (Completion Likelihood × 2) + 
              (Replay Potential × 2)

Maximum score: 60  →  Normalized to 1-20 scale (divide by 3)
Minimum to extract: 8/20
\`\`\`

| Factor | 1 (Weak) | 3 (Moderate) | 5 (Strong) |
|--------|----------|--------------|------------|
| **Hook Strength** | Generic statement, no tension | Interesting but expected | Bold claim, contradiction, or jaw-drop reveal |
| **Emotional Intensity** | Neutral, purely informational | Mildly amusing or interesting | Triggers awe, laughter, surprise, outrage, or empathy |
| **Shareability** | Niche interest only | "That's cool" but wouldn't send it | "I NEED to send this to someone" |
| **Completion Likelihood** | Single flat idea, no arc | Has a point but pacing is uneven | Clear narrative with payoff — viewer must see the end |
| **Replay Potential** | One-time value only | Worth a second look | Contains detail worth rewatching, natural loop, or surprising twist |

## What makes a clip viral (prioritized)

1. **Surprising contradictions** — "Everyone thinks X, but actually Y" — subverts expectations
2. **Emotional peaks** — moments of genuine passion, vulnerability, frustration, or excitement
3. **Quotable one-liners** — bold, memorable statements that stand alone as wisdom or hot takes
4. **Visual reveals / transformations** — before/after, "watch what happens next"
5. **Relatable struggles** — "I've been there" moments that create empathy and sharing impulse
6. **Educational "aha!" moments** — the instant a complex concept clicks into clarity
7. **Humor** — genuine wit, unexpected punchlines, or absurd juxtapositions
8. **Controversy / debate fuel** — strong opinions that people will argue about in comments

## Hook architecture (CRITICAL — the first 3 seconds decide everything)

87% of viewers decide within 3 seconds whether to keep watching. Videos with 70-85% retention at the 3-second mark get **2.2× more total views**. Every short MUST have a deliberate hook strategy.

### Hook types (classify every short)

| Hook Type | Pattern | Best For |
|-----------|---------|----------|
| **cold-open** | Drop into the most compelling moment, then rewind | Stories, reveals, transformations |
| **curiosity-gap** | "The one thing nobody tells you about..." | Tips, lessons, insider knowledge |
| **contradiction** | "Everyone says X, but actually Y" | Hot takes, myth-busting |
| **result-first** | Show the outcome immediately, then explain how | Tutorials, before/after |
| **bold-claim** | Make a specific, surprising statement of fact | Data-driven, authority content |
| **question** | "Want to know why X?" — engage curiosity directly | Engagement-focused, relatable |

### Hook-First Video Ordering

If a short's natural content flows A→B→C→D, the final short should play as D→A→B→C — the **payoff moment (D) is moved to the front as the hook**, then the content plays from the beginning up to that point. The hook does NOT repeat.

**How to implement:**
1. Plan the content as normal (full story A→D)
2. Identify the single most arresting 2-5 second moment — usually the payoff, punchline, or emotional peak
3. That moment becomes the FIRST segment in the segments array
4. The remaining content plays chronologically from start to just before the hook
5. Example: content [120s–150s], best moment [145s–150s] → segments: [{start: 145, end: 150}, {start: 120, end: 145}]

**Hook quality rules (NEVER violate):**
- The hook segment MUST start and end on a **complete sentence or clause boundary**
- The hook MUST be a **self-contained, complete thought** — understandable without prior context
- If no moment qualifies as a clean hook, **keep segments chronological** and use hook text only

## Narrative structures (classify every short)

| Structure | Pattern | When to use |
|-----------|---------|-------------|
| **result-method-proof** | Show outcome → explain method → prove it works | Tutorials, demonstrations |
| **doing-x-wrong** | Identify common mistake → show correct approach | Education, authority building |
| **expectation-vs-reality** | What people think → what's actually true | Myth-busting, hot takes |
| **mini-list** | "3 things/tips/mistakes" — each is a micro-payoff | Tips, advice, knowledge |
| **tension-release** | Build to surprising/satisfying conclusion | Stories, reveals |
| **loop** | End connects seamlessly to beginning → replay multiplier | Any content that naturally circles back |

## Emotional triggers (classify every short)

Identify the PRIMARY emotion that will drive engagement:
- **awe** — mind-blowing revelation, impressive skill, or scale that amazes
- **humor** — genuine laughter, clever observation, relatable absurdity
- **surprise** — unexpected twist, counter-intuitive fact, subverted expectation
- **empathy** — shared struggle, vulnerability, "I've been there" connection
- **outrage** — exposing injustice, calling out bad practices, righteous anger
- **practical-value** — actionable tip, time-saving hack, "I need to save this"

## Duration optimization

Platform-specific sweet spots (aim for these):
- **TikTok**: 21-34 seconds (62% completion rate at this range)
- **YouTube Shorts**: 15-30 seconds (highest viral potential)
- **Instagram Reels**: 7-30 seconds (highest completion rates)

General guidance: Prefer 20-45 seconds. Under 15s lacks narrative depth. Over 50s requires exceptional retention quality.

## Loop detection

Flag shorts where the content **naturally circles back to the beginning**:
- Speaker returns to an opening question and answers it
- A transformation sequence that ends where it began
- A statement that sets up a natural replay ("and that's exactly why...")

Loop-engineered videos achieve 200-250% watch-through rates — a massive algorithmic boost.

## Composite opportunities

Composites (multi-segment shorts) often make the **best** shorts:
- "Every time X happens" montages — collect recurring moments
- Escalation arcs — build from mild to intense across the video
- Contradiction compilations — multiple perspectives on one topic
- Before/after pairs from different points in the video

## Rules

1. Each short must be 15-60 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence boundaries for clean cuts.
4. Every short needs a catchy, descriptive title (5-10 words).
5. Tags should be lowercase, no hashes, 3-6 per short.
6. A 1-second buffer is automatically added around each segment boundary.
7. Avoid significant timestamp overlap between shorts.
8. **Minimum viral score of 8/20 to extract.** Be ruthless about quality.
9. Every short MUST have a hook, hookType, emotionalTrigger, viralScore, narrativeStructure, and shareReason.

## Using Clip Direction
You may receive AI-generated clip direction with suggested shorts. Use these as a starting point but make your own decisions:
- The suggestions are based on visual + audio analysis and may identify moments you'd miss from transcript alone
- Feel free to adjust timestamps, combine suggestions, or ignore ones that don't work
- You may also find good shorts NOT in the suggestions — always analyze the full transcript

## The shareability test (ask for EVERY clip)

Before adding a short, ask yourself: **"Would I interrupt someone to show them this?"**
- If YES → strong clip, add it
- If "maybe, it's interesting" → score it honestly and only keep if ≥8
- If NO → drop it, no matter how "complete" the topic coverage feels`

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
          hook: { type: 'string', description: 'Short attention-grabbing text (≤60 chars) for visual overlay during the hook segment' },
          hookType: {
            type: 'string',
            enum: ['cold-open', 'curiosity-gap', 'contradiction', 'result-first', 'bold-claim', 'question'],
            description: 'Hook pattern classification — how the opening captures viewer attention',
          },
          emotionalTrigger: {
            type: 'string',
            enum: ['awe', 'humor', 'surprise', 'empathy', 'outrage', 'practical-value'],
            description: 'Primary emotional driver that makes this clip engaging and shareable',
          },
          viralScore: {
            type: 'number',
            description: 'Viral potential score (1-20) calculated from Hook Strength×3 + Emotional Intensity×2 + Shareability×3 + Completion Likelihood×2 + Replay Potential×2, then divided by 3',
          },
          narrativeStructure: {
            type: 'string',
            enum: ['result-method-proof', 'doing-x-wrong', 'expectation-vs-reality', 'mini-list', 'tension-release', 'loop'],
            description: 'Narrative arc pattern used in this clip',
          },
          shareReason: {
            type: 'string',
            description: 'Why would someone share this with a friend? Be specific.',
          },
          isLoopCandidate: {
            type: 'boolean',
            description: 'Whether the content naturally circles back to the beginning, enabling seamless replay',
          },
          segments: {
            type: 'array',
            description: 'One or more time segments that compose this short. For hook-first ordering, the hook segment comes first.',
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
        required: ['title', 'description', 'tags', 'segments', 'hook', 'hookType', 'emotionalTrigger', 'viralScore', 'narrativeStructure', 'shareReason', 'isLoopCandidate'],
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
          return `${i + 1}. "${s.title}" (${totalDur.toFixed(1)}s, ${type}, score: ${s.viralScore}/20) [${timeRanges}]\n   Hook: ${s.hook} (${s.hookType}) | Emotion: ${s.emotionalTrigger} | Structure: ${s.narrativeStructure}\n   Share reason: ${s.shareReason}\n   ${s.isLoopCandidate ? '🔄 Loop candidate' : ''}`
        }).join('\n')
        const avgScore = this.plannedShorts.reduce((sum, s) => sum + s.viralScore, 0) / this.plannedShorts.length
        return `## Planned shorts (${this.plannedShorts.length} total, avg viral score: ${avgScore.toFixed(1)}/20)\n\n${summary}\n\nReview critically:\n- Would YOU share each of these? Drop any clip scoring below 8.\n- Can any be combined into stronger composites?\n- Are there moments you underscored that deserve a second look?`
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
    `Analyze the following transcript (${transcript.duration.toFixed(0)}s total) and find the most viral-worthy moments for shorts.\n`,
    `Video: ${video.filename}`,
    `Duration: ${transcript.duration.toFixed(1)}s`,
    `Focus on quality over quantity — only extract clips scoring 8+ on the viral score framework. Every clip must have a hook, hookType, emotionalTrigger, viralScore, narrativeStructure, and shareReason.\n`,
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
        `**Viral Score:** ${plan.viralScore}/20`,
        `**Hook Type:** ${plan.hookType}`,
        `**Emotional Trigger:** ${plan.emotionalTrigger}`,
        `**Narrative Structure:** ${plan.narrativeStructure}`,
        `**Share Reason:** ${plan.shareReason}`,
        plan.isLoopCandidate ? `**Loop Candidate:** Yes 🔄` : '',
        '',
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
      ].filter(Boolean).join('\n')
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
        hookType: plan.hookType as HookType,
        emotionalTrigger: plan.emotionalTrigger as EmotionalTrigger,
        viralScore: plan.viralScore,
        narrativeStructure: plan.narrativeStructure as ShortNarrativeStructure,
        shareReason: plan.shareReason,
        isLoopCandidate: plan.isLoopCandidate,
      })

      logger.info(`[ShortsAgent] Created short: ${plan.title} (${totalDuration.toFixed(1)}s)`)
    }

    logger.info(`[ShortsAgent] Generated ${shorts.length} shorts`)
    return shorts
  } finally {
    await agent.destroy()
  }
}

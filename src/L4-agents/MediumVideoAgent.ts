import type { ToolWithHandler } from '../L3-services/llm/providerFactory.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, MediumClip, MediumSegment } from '../L0-pure/types/index'
import type { HookType, EmotionalTrigger, MediumNarrativeStructure, MediumClipType } from '../L0-pure/types/index'
import type { Idea, ClipConfig } from '../L0-pure/types/index.js'
import { buildIdeaContext } from '../L0-pure/ideaContext/ideaContext.js'
import { extractClip, extractCompositeClipWithTransitions, burnCaptions } from '../L3-services/videoOperations/videoOperations.js'
import { generateStyledASSForSegment, generateStyledASSForComposite } from '../L0-pure/captions/captionGenerator'

import { generateId } from '../L0-pure/text/text.js'
import { slugify } from '../L0-pure/text/text.js'
import { writeTextFile, writeJsonFile, ensureDirectory } from '../L1-infra/fileSystem/fileSystem.js'
import { join, dirname } from '../L1-infra/paths/paths.js'
import logger from '../L1-infra/logger/configLogger'

// ── Types for the LLM's plan_medium_clips tool call ─────────────────────────

interface PlannedSegment {
  start: number
  end: number
  description: string
}

interface PlannedMediumClip {
  title: string
  description: string
  tags: string[]
  segments: PlannedSegment[]
  totalDuration: number
  hook: string
  topic: string
  hookType: string
  emotionalTrigger: string
  viralScore: number
  narrativeStructure: string
  clipType: string
  saveReason: string
  microHooks: string[]
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildMediumSystemPrompt(clipConfig?: ClipConfig): string {
  const minDuration = clipConfig?.duration?.min ?? 60
  const maxDuration = clipConfig?.duration?.max ?? 180
  const minViralScore = clipConfig?.minViralScore ?? 10
  const maxClips = clipConfig?.maxClips ?? 5
  const minMinutes = Math.floor(minDuration / 60)
  const maxMinutes = Math.ceil(maxDuration / 60)
  const durationLabel = `${minMinutes}-${maxMinutes} minute`

  return `You are a medium-form video content strategist. Your job is to analyze a video transcript with word-level timestamps and extract the **most valuable, engaging ${minMinutes}-${maxMinutes} minute segments** as standalone medium-form clips.

## Core Philosophy: Value Density Over Coverage

Your goal is NOT to cover every minute of the video. Your goal is to find segments where the speaker delivers **concentrated value** — complete ideas, clear tutorials, compelling stories, or insightful analysis that viewers would **save to reference later** or **share because it changed their thinking**.

Platform algorithms heavily weight saves and shares over likes:
- **Saves** signal "I'll come back to this" — the highest-intent engagement action
- **Shares** signal "Someone I know needs to see this" — the strongest distribution trigger
- **Comments** signal "I have something to say about this" — drives conversation
- **Likes** are passive approval — lowest algorithmic value

Design every clip to maximize saves and shares.

## Your workflow
1. Read the transcript and note the total duration.
2. Work through the transcript **section by section** (roughly 5-8 minute chunks). For each chunk, identify segments with genuine standalone value.
3. For each potential clip, score it using the Viral Score Framework (see below). **Only extract clips scoring ${minViralScore} or higher.**
4. Call **add_medium_clips** for each batch of clips you find. You can call it as many times as needed.
5. After your first pass, call **review_medium_clips** to see everything you've planned so far.
6. Review critically: Does each clip deliver clear, standalone value? Would someone save it? Could segments be combined into something stronger?
7. Drop any clip you're not confident about. Fewer, stronger clips beat many mediocre ones.
8. When you are confident every remaining clip has genuine value, call **finalize_medium_clips**.

## Viral Score Framework (rate each factor 1-5, then calculate)

\`\`\`
Viral Score = (Hook Strength × 3) + (Emotional Intensity × 2) + 
              (Shareability × 3) + (Completion Likelihood × 2) + 
              (Replay Potential × 2)

Maximum score: 60  →  Normalized to 1-20 scale (divide by 3)
Minimum to extract: ${minViralScore}/20 (higher bar than shorts — medium clips cost more to produce)
\`\`\`

| Factor | 1 (Weak) | 3 (Moderate) | 5 (Strong) |
|--------|----------|--------------|------------|
| **Hook Strength** | Slow start, no clear value promise | Decent opening but predictable | Cold open with result/transformation, strong curiosity gap |
| **Emotional Intensity** | Neutral, lecture-like delivery | Engaged but flat pacing | Genuine passion, escalating energy, vulnerability, or humor |
| **Shareability** | Niche and theoretical | "Good info" but not shareable | "My coworker/friend NEEDS to see this" |
| **Completion Likelihood** | No narrative arc, viewer can leave anytime | Has a point but meanders | Clear open loop → structured payoff, viewer must reach the end |
| **Replay Potential** | One-time information dump | Worth bookmarking | Dense with detail worth rewatching, surprising insights throughout |

## Clip types (classify every clip)

| Type | Pattern | Best For |
|------|---------|----------|
| **deep-dive** | Single topic explored thoroughly with multiple angles | Complex explanations, analysis |
| **tutorial** | Step-by-step instruction with clear outcome | How-to content, demonstrations |
| **story-arc** | Setup → complication → climax → resolution | Anecdotes, case studies, experiences |
| **debate** | "X vs Y" with evidence and clear winner | Comparisons, opinionated takes |
| **problem-solution** | Problem defined → explored → solved | Troubleshooting, advice, recommendations |

## Hook architecture (first 3-5 seconds decide everything)

Medium clips have slightly more hook time than shorts (3-5 seconds vs 1-3 seconds), but the principle is the same: **front-load the value promise**.

### Hook types (classify every clip)

| Hook Type | Pattern | Best For |
|-----------|---------|----------|
| **cold-open** | Start with the result/conclusion, then explain how you got there | Tutorials, transformations, case studies |
| **curiosity-gap** | "The one thing that changed everything about how I..." | Deep dives, insights, lessons learned |
| **contradiction** | "Everyone says X, but here's what actually works" | Debate clips, myth-busting |
| **result-first** | Show the outcome immediately, then walk through the process | Before/after, demonstrations |
| **bold-claim** | "This is the single most important thing about X" | Authority content, strong opinions |
| **question** | "Have you ever wondered why...?" | Explorations, investigations |

### Cold Open Structure for Medium Clips

Unlike shorts (which reorder segments), medium clips should **start with a verbal hook** that front-loads the payoff promise, then play in chronological order:

1. Identify the most compelling conclusion, result, or insight in the clip
2. Craft a hook that teases this payoff in the first 3-5 seconds
3. Structure the remaining clip to build toward that payoff naturally
4. The hook is the \`hook\` text field — it appears as text overlay during the opening

## Narrative structures (classify every clip)

| Structure | Pattern | When to use |
|-----------|---------|-------------|
| **open-loop-steps-payoff** | Tease outcome → deliver step-by-step → prove it | Tutorials, how-to, demonstrations |
| **problem-deepdive-solution** | Define problem → explore thoroughly → resolve | Troubleshooting, advice, analysis |
| **story-arc** | Setup → rising tension → climax → resolution | Case studies, experiences, anecdotes |
| **debate-comparison** | Frame the question → present both sides → verdict | Opinions, tool comparisons, trade-offs |
| **tutorial-micropayoffs** | Step 1 (mini-payoff) → Step 2 (mini-payoff) → final result | Multi-step processes, recipes, workflows |

## Micro-hooks: Retention throughout the clip (CRITICAL for medium clips)

Medium clips are 1-3 minutes — viewers need fresh reasons to keep watching every 15-20 seconds. Plan **micro-hooks** at regular intervals:

- **Every 15-20 seconds**, there should be a new information beat, mini-reveal, or energy shift
- These are NOT just topic transitions — they are deliberate moments that re-engage attention
- Examples: surprising data point, contradiction of prior statement, humor, visual transition, "but here's the thing...", escalation of stakes

**Videos with pattern interrupts every 4 seconds average 58% retention vs 41% for static content.** For medium clips, plan at least 3-5 micro-hooks.

Provide a \`microHooks\` array describing each planned retention moment within the clip.

## Emotional triggers (classify every clip)

Identify the PRIMARY emotion driving engagement:
- **awe** — mind-blowing insight, impressive depth, revelation
- **humor** — genuine wit, self-deprecation, absurd examples
- **surprise** — counter-intuitive findings, unexpected conclusions
- **empathy** — shared struggles, vulnerability, "been there" moments
- **outrage** — calling out bad practices, exposing misconceptions
- **practical-value** — actionable steps, time-saving knowledge, "save this for later"

## Duration optimization

- **Sweet spot**: ${minDuration}-${Math.min(maxDuration, 120)} seconds (${minMinutes}-${Math.min(maxMinutes, 2)} minutes)
- **Maximum**: ${maxDuration} seconds — only if retention quality is exceptional
- **Under ${minDuration} seconds**: Too short for medium format — should be a short instead
- **Over ${Math.min(maxDuration, 120)} seconds**: Requires multiple micro-hooks and exceptional pacing

## Differences from shorts

- Shorts capture **moments**; medium clips capture **complete ideas**
- Shorts optimize for **shares** ("send this to someone"); medium clips optimize for **saves** ("I'll reference this later")
- Shorts use hook-first segment reordering; medium clips use cold-open hooks with **chronological content**
- Medium clips MUST maintain **strict chronological order** — NOT hook-first reordering
- Medium clips have room for depth and nuance — don't sacrifice completeness for brevity
- Medium clips MUST have micro-hooks planned to maintain retention through the full duration

## Compilation opportunities

Compilations (multi-segment clips) work well for medium clips when:
- Multiple brief discussions of the same theme appear across the video
- A clear narrative arc can be constructed from non-contiguous segments
- "Every perspective on X" — collecting viewpoints into a comprehensive take

For compilations, segments must be in chronological order.

## Rules

1. Each clip must be ${minDuration}-${maxDuration} seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence and paragraph boundaries for clean entry/exit points.
4. Each clip must be self-contained — a viewer with no other context should get value.
5. Every clip needs a descriptive title (5-12 words) and a topic label.
6. For compilations, specify segments in **chronological order**.
7. Tags should be lowercase, no hashes, 3-6 per clip.
8. A 1-second buffer is automatically added around each segment boundary.
9. **Minimum viral score of ${minViralScore}/20 to extract.** Medium clips cost more to produce — quality bar is higher.
10. Every clip MUST have hook, hookType, emotionalTrigger, viralScore, narrativeStructure, clipType, saveReason, and microHooks.
11. Avoid significant overlap with content that would work better as a short.

## The save test (ask for EVERY clip)

Before adding a clip, ask yourself: **"Would I bookmark this to come back to later?"**
- If YES → strong clip, add it
- If "it's informative but not reference-worthy" → score it honestly and only keep if ≥${minViralScore}
- If NO → drop it or consider if it works better as a short

## Using Clip Direction
You may receive AI-generated clip direction with suggested medium clips. Use these as a starting point but make your own decisions:
- The suggestions are based on visual + audio analysis and may identify narrative arcs you'd miss from transcript alone
- Feel free to adjust timestamps, combine suggestions, or ignore ones that don't work
- You may also find good clips NOT in the suggestions — always analyze the full transcript
- Pay special attention to suggested hooks and topic arcs — they come from multimodal analysis`
}

const SYSTEM_PROMPT = buildMediumSystemPrompt()

// ── JSON Schema for the add_medium_clips tool ───────────────────────────────

const ADD_MEDIUM_CLIPS_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      description: 'Array of medium-length clips to add to the plan',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Descriptive clip title (5–12 words)' },
          description: { type: 'string', description: 'Brief description of the clip content' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lowercase tags without hashes, 3–6 per clip',
          },
          segments: {
            type: 'array',
            description: 'One or more time segments that compose this clip (chronological order)',
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
          totalDuration: { type: 'number', description: 'Total clip duration in seconds (60–180)' },
          hook: { type: 'string', description: 'Compelling one-liner (≤60 chars) teasing the clip\'s core value — shown as text overlay during opening' },
          topic: { type: 'string', description: 'Main topic covered in the clip' },
          hookType: {
            type: 'string',
            enum: ['cold-open', 'curiosity-gap', 'contradiction', 'result-first', 'bold-claim', 'question'],
            description: 'Hook pattern classification — how the opening captures viewer attention',
          },
          emotionalTrigger: {
            type: 'string',
            enum: ['awe', 'humor', 'surprise', 'empathy', 'outrage', 'practical-value'],
            description: 'Primary emotional driver that makes this clip engaging',
          },
          viralScore: {
            type: 'number',
            description: 'Viral potential score (1-20) calculated from Hook Strength×3 + Emotional Intensity×2 + Shareability×3 + Completion Likelihood×2 + Replay Potential×2, then divided by 3',
          },
          narrativeStructure: {
            type: 'string',
            enum: ['open-loop-steps-payoff', 'problem-deepdive-solution', 'story-arc', 'debate-comparison', 'tutorial-micropayoffs'],
            description: 'Narrative arc pattern used in this clip',
          },
          clipType: {
            type: 'string',
            enum: ['deep-dive', 'tutorial', 'story-arc', 'debate', 'problem-solution'],
            description: 'Content type classification for this clip',
          },
          saveReason: {
            type: 'string',
            description: 'Why would someone save this to reference later? Be specific.',
          },
          microHooks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Planned retention hooks at ~15-20 second intervals within the clip. Each should describe a specific moment that re-engages viewer attention.',
          },
        },
        required: ['title', 'description', 'tags', 'segments', 'totalDuration', 'hook', 'topic', 'hookType', 'emotionalTrigger', 'viralScore', 'narrativeStructure', 'clipType', 'saveReason', 'microHooks'],
      },
    },
  },
  required: ['clips'],
}

// ── Agent ────────────────────────────────────────────────────────────────────

class MediumVideoAgent extends BaseAgent {
  private plannedClips: PlannedMediumClip[] = []
  private isFinalized = false

  constructor(systemPrompt: string = SYSTEM_PROMPT, model?: string) {
    super('MediumVideoAgent', systemPrompt, undefined, model)
  }

  protected resetForRetry(): void {
    this.plannedClips = []
    this.isFinalized = false
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'add_medium_clips',
        description:
          'Add one or more medium clips to your plan. ' +
          'You can call this multiple times to build your list incrementally as you analyze each section of the transcript.',
        parameters: ADD_MEDIUM_CLIPS_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('add_medium_clips', args as Record<string, unknown>)
        },
      },
      {
        name: 'review_medium_clips',
        description:
          'Review all medium clips planned so far. Returns a summary of every clip in your current plan. ' +
          'Use this to check for gaps, overlaps, or missed opportunities before finalizing.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          return this.handleToolCall('review_medium_clips', {})
        },
      },
      {
        name: 'finalize_medium_clips',
        description:
          'Finalize your medium clip plan and trigger extraction. ' +
          'Call this ONCE after you have added all clips and reviewed them for completeness.',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          return this.handleToolCall('finalize_medium_clips', {})
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'add_medium_clips': {
        const newClips = args.clips as PlannedMediumClip[]
        this.plannedClips.push(...newClips)
        logger.info(`[MediumVideoAgent] Added ${newClips.length} clips (total: ${this.plannedClips.length})`)
        return `Added ${newClips.length} clips. Total planned: ${this.plannedClips.length}. Call add_medium_clips for more, review_medium_clips to check your plan, or finalize_medium_clips when done.`
      }

      case 'review_medium_clips': {
        if (this.plannedClips.length === 0) {
          return 'No medium clips planned yet. Analyze the transcript and call add_medium_clips to start planning.'
        }
        const summary = this.plannedClips.map((c, i) => {
          const totalDur = c.segments.reduce((sum, seg) => sum + (seg.end - seg.start), 0)
          const timeRanges = c.segments.map(seg => `${seg.start.toFixed(1)}s–${seg.end.toFixed(1)}s`).join(', ')
          const type = c.segments.length > 1 ? 'compilation' : c.clipType
          return `${i + 1}. "${c.title}" (${totalDur.toFixed(1)}s, ${type}, score: ${c.viralScore}/20) [${timeRanges}]\n   Hook: ${c.hook} (${c.hookType}) | Emotion: ${c.emotionalTrigger} | Structure: ${c.narrativeStructure}\n   Topic: ${c.topic} | Save reason: ${c.saveReason}\n   Micro-hooks: ${c.microHooks.join(' → ')}`
        }).join('\n')
        const avgScore = this.plannedClips.reduce((sum, c) => sum + c.viralScore, 0) / this.plannedClips.length
        return `## Planned medium clips (${this.plannedClips.length} total, avg viral score: ${avgScore.toFixed(1)}/20)\n\n${summary}\n\nReview critically:\n- Would YOU save each of these to reference later? Drop any clip scoring below 10.\n- Are the micro-hooks strong enough to maintain retention through the full duration?\n- Could any segments be combined into something stronger?`
      }

      case 'finalize_medium_clips': {
        this.isFinalized = true
        logger.info(`[MediumVideoAgent] Finalized ${this.plannedClips.length} medium clips`)
        return `Finalized ${this.plannedClips.length} medium clips. Extraction will begin.`
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  getPlannedClips(): PlannedMediumClip[] {
    return this.plannedClips
  }

  getIsFinalized(): boolean {
    return this.isFinalized
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function generateMediumClips(
  video: VideoFile,
  transcript: Transcript,
  model?: string,
  clipDirection?: string,
  ideas?: Idea[],
  clipConfig?: ClipConfig,
): Promise<MediumClip[]> {
  const basePrompt = clipConfig ? buildMediumSystemPrompt(clipConfig) : SYSTEM_PROMPT
  const systemPrompt = basePrompt + (ideas?.length ? buildIdeaContext(ideas) : '')
  const agent = new MediumVideoAgent(systemPrompt, model)

  // Build prompt with full transcript including word-level timestamps
  const transcriptLines = transcript.segments.map((seg) => {
    const words = seg.words
      .map((w) => `[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`)
      .join(' ')
    return `[${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s] ${seg.text}\nWords: ${words}`
  })

  const minDuration = clipConfig?.duration?.min ?? 60
  const maxDuration = clipConfig?.duration?.max ?? 180
  const minViralScore = clipConfig?.minViralScore ?? 10
  const minMinutes = Math.floor(minDuration / 60)
  const maxMinutes = Math.ceil(maxDuration / 60)

  const promptParts = [
    `Analyze the following transcript (${transcript.duration.toFixed(0)}s total) and find the most valuable segments for medium-length clips (${minMinutes}-${maxMinutes} minutes each).\n`,
    `Video: ${video.filename}`,
    `Duration: ${transcript.duration.toFixed(1)}s`,
    `Focus on value density over coverage — only extract clips scoring ${minViralScore}+ on the viral score framework. Every clip must have hook, hookType, emotionalTrigger, viralScore, narrativeStructure, clipType, saveReason, and microHooks.\n`,
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
    // and check if clips were planned before re-throwing.
    try {
      await agent.run(prompt)
    } catch (err) {
      runError = err instanceof Error ? err : new Error(String(err))
      
      // Check if clips were planned despite the error
      const partialPlanned = agent.getPlannedClips()
      if (partialPlanned.length > 0 && runError.message.includes('missing finish_reason')) {
        logger.warn(`[MediumVideoAgent] SDK error after ${partialPlanned.length} clips planned - proceeding with partial result`)
      } else {
        throw runError
      }
    }
    
    const planned = agent.getPlannedClips()

    if (planned.length === 0) {
      // Re-throw original error if we have one but no clips
      if (runError) throw runError
      logger.warn('[MediumVideoAgent] No medium clips were planned')
      return []
    }

    await writeJsonFile(join(video.videoDir, 'medium-clips-plan.json'), planned)

    const clipsDir = join(dirname(video.repoPath), 'medium-clips')
    await ensureDirectory(clipsDir)

    const clips: MediumClip[] = []

    for (const plan of planned) {
      const id = generateId()
      const clipSlug = slugify(plan.title)
      const totalDuration = plan.segments.reduce((sum, s) => sum + (s.end - s.start), 0)
      const outputPath = join(clipsDir, `${clipSlug}.mp4`)

      const segments: MediumSegment[] = plan.segments.map((s) => ({
        start: s.start,
        end: s.end,
        description: s.description,
      }))

      // Extract the clip — single segment or composite with crossfade transitions
      if (segments.length === 1) {
        await extractClip(video.repoPath, segments[0].start, segments[0].end, outputPath)
      } else {
        await extractCompositeClipWithTransitions(video.repoPath, segments, outputPath)
      }

      // Generate ASS captions with medium style (chronological, no hook overlay)
      let captionedPath: string | undefined
      try {
        const assContent = segments.length === 1
          ? generateStyledASSForSegment(transcript, segments[0].start, segments[0].end, 1.0, 'medium')
          : generateStyledASSForComposite(transcript, segments, 1.0, 'medium')

        const assPath = join(clipsDir, `${clipSlug}.ass`)
        await writeTextFile(assPath, assContent)

        captionedPath = join(clipsDir, `${clipSlug}-captioned.mp4`)
        await burnCaptions(outputPath, assPath, captionedPath)
        logger.info(`[MediumVideoAgent] Burned captions for clip: ${plan.title}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn(`[MediumVideoAgent] Caption burning failed for ${plan.title}: ${message}`)
        captionedPath = undefined
      }

      // Generate description markdown
      const mdPath = join(clipsDir, `${clipSlug}.md`)
      const mdContent = [
        `# ${plan.title}\n`,
        `**Topic:** ${plan.topic}`,
        `**Viral Score:** ${plan.viralScore}/20`,
        `**Hook:** ${plan.hook} (${plan.hookType})`,
        `**Emotional Trigger:** ${plan.emotionalTrigger}`,
        `**Narrative Structure:** ${plan.narrativeStructure}`,
        `**Clip Type:** ${plan.clipType}`,
        `**Save Reason:** ${plan.saveReason}`,
        '',
        plan.description,
        '',
        '## Micro-Hooks\n',
        ...plan.microHooks.map((h, i) => `${i + 1}. ${h}`),
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

      clips.push({
        id,
        title: plan.title,
        slug: clipSlug,
        segments,
        totalDuration,
        outputPath,
        captionedPath,
        description: plan.description,
        tags: plan.tags,
        hook: plan.hook,
        topic: plan.topic,
        hookType: plan.hookType as HookType,
        emotionalTrigger: plan.emotionalTrigger as EmotionalTrigger,
        viralScore: plan.viralScore,
        narrativeStructure: plan.narrativeStructure as MediumNarrativeStructure,
        clipType: plan.clipType as MediumClipType,
        saveReason: plan.saveReason,
        microHooks: plan.microHooks,
      })

      logger.info(`[MediumVideoAgent] Created medium clip: ${plan.title} (${totalDuration.toFixed(1)}s)`)
    }

    logger.info(`[MediumVideoAgent] Generated ${clips.length} medium clips`)
    return clips
  } finally {
    await agent.destroy()
  }
}

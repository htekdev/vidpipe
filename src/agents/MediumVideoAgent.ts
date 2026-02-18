import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, MediumClip, MediumSegment } from '../types'
import { extractClip, extractCompositeClipWithTransitions } from '../tools/ffmpeg/clipExtraction'
import { generateStyledASSForSegment, generateStyledASSForComposite, generateMediumASSWithHook, generateMediumASSWithHookComposite } from '../tools/captions/captionGenerator'
import { burnCaptions } from '../tools/ffmpeg/captionBurning'
import { generateId } from '../core/text.js'
import { slugify } from '../core/text.js'
import { writeTextFile, writeJsonFile, ensureDirectory } from '../core/fileSystem.js'
import { join, dirname } from '../core/paths.js'
import logger from '../config/logger'

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
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a medium-form video content strategist. Your job is to **exhaustively** analyze a video transcript with word-level timestamps and extract every viable 1–3 minute segment as a standalone medium-form clip.

## Your workflow
1. Read the transcript and note the total duration.
2. Work through the transcript **section by section** (roughly 5–8 minute chunks). For each chunk, identify every complete topic or narrative arc.
3. Call **add_medium_clips** for each batch of clips you find. You can call it as many times as needed.
4. After your first pass, call **review_medium_clips** to see everything you've planned so far.
5. Review for gaps: are there complete topics you missed? Could non-contiguous mentions of the same theme be compiled? Is there a tutorial segment that stands alone?
6. Add any additional clips you find.
7. When you are confident you've exhausted all opportunities, call **finalize_medium_clips**.

## Target quantity
Scale your output by video duration:
- **~1 medium clip per 5–8 minutes** of video content.
- A 10-minute video → 1–2 clips. A 30-minute video → 4–6 clips. A 60-minute video → 8–12 clips.
- These are guidelines, not hard caps — if the content is rich, find more.
- **Never stop at 2–4 clips for a long video.** Your job is to be thorough.

## What to look for

- **Complete topics** — a subject is introduced, explored, and concluded
- **Narrative arcs** — problem → solution → result; question → exploration → insight
- **Educational deep dives** — clear, thorough explanations of complex topics
- **Compelling stories** — anecdotes with setup, tension, and resolution
- **Strong arguments** — claim → evidence → implication sequences
- **Topic compilations** — multiple brief mentions of one theme across the video that can be compiled into a cohesive 1–3 minute segment. **Actively look for these** — they often make excellent content.

## Clip types

- **Deep Dive** — a single contiguous section (1–3 min) covering one topic in depth
- **Compilation** — multiple non-contiguous segments stitched together around a single theme or narrative thread (1–3 min total)

## Rules

1. Each clip must be 60–180 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence and paragraph boundaries for clean entry/exit points.
4. Each clip must be self-contained — a viewer with no other context should understand and get value from the clip.
5. Every clip needs a descriptive title (5–12 words) and a topic label.
6. For compilations, specify segments in the order they should appear in the final clip (which may differ from chronological order).
7. Tags should be lowercase, no hashes, 3–6 per clip.
8. A 1-second buffer is automatically added around each segment boundary.
9. Each clip needs a hook — the opening line or concept that draws viewers in.
10. Avoid significant overlap with content that would work better as a short (punchy, viral, single-moment).

## Differences from shorts

- Shorts capture *moments*; medium clips capture *complete ideas*.
- Don't just find the most exciting 60 seconds — find where a topic starts and where it naturally concludes.
- It's OK if a medium clip has slower pacing — depth and coherence matter more than constant high energy.
- Look for segments that work as standalone mini-tutorials or explanations.

## Using Clip Direction
You may receive AI-generated clip direction with suggested medium clips. Use these as a starting point but make your own decisions:
- The suggestions are based on visual + audio analysis and may identify narrative arcs you'd miss from transcript alone
- Feel free to adjust timestamps, combine suggestions, or ignore ones that don't work
- You may also find good clips NOT in the suggestions — always analyze the full transcript
- Pay special attention to suggested hooks and topic arcs — they come from multimodal analysis

## Hook-First Ordering (CRITICAL for viewer retention)
Medium clips still compete for attention — grab viewers in the first 5 seconds or lose them.

**The pattern:** If a clip's content flows like [A, B, C, D, ..., Y, Z], the final clip should play as [Z, A, B, C, ..., Y, Z] where Z is the most exciting/compelling moment.

**How to implement it:**
1. Plan the clip's content as normal (the full story: A→Z)
2. Identify the single most exciting 2–5 second moment — the payoff, climax, or bold statement
3. Add that moment as the FIRST segment, then add the full content after it
4. Example: content is [300s–420s], best moment is [410s–415s] → segments: [{start: 410, end: 415}, {start: 300, end: 420}]
5. The hook plays TWICE — first as teaser, then in context. This is standard for short-form content.
6. Provide a \`hook\` text (≤60 chars) — burned as a visual text overlay during the hook segment

If the clip truly has no standout moment, keep segments chronological and just provide hook text.`

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
            description: 'One or more time segments that compose this clip',
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
          hook: { type: 'string', description: 'Opening hook for the clip' },
          topic: { type: 'string', description: 'Main topic covered in the clip' },
        },
        required: ['title', 'description', 'tags', 'segments', 'totalDuration', 'hook', 'topic'],
      },
    },
  },
  required: ['clips'],
}

// ── Agent ────────────────────────────────────────────────────────────────────

class MediumVideoAgent extends BaseAgent {
  private plannedClips: PlannedMediumClip[] = []
  private isFinalized = false

  constructor(model?: string) {
    super('MediumVideoAgent', SYSTEM_PROMPT, undefined, model)
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
          const type = c.segments.length > 1 ? 'compilation' : 'deep dive'
          return `${i + 1}. "${c.title}" (${totalDur.toFixed(1)}s, ${type}) [${timeRanges}]\n   Topic: ${c.topic} | Hook: ${c.hook}\n   ${c.description}`
        }).join('\n')
        return `## Planned medium clips (${this.plannedClips.length} total)\n\n${summary}\n\nLook for gaps in transcript coverage, missed compilation opportunities, and complete topic arcs you may have overlooked.`
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
): Promise<MediumClip[]> {
  const agent = new MediumVideoAgent(model)

  // Build prompt with full transcript including word-level timestamps
  const transcriptLines = transcript.segments.map((seg) => {
    const words = seg.words
      .map((w) => `[${w.start.toFixed(2)}-${w.end.toFixed(2)}] ${w.word}`)
      .join(' ')
    return `[${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s] ${seg.text}\nWords: ${words}`
  })

  const promptParts = [
    `Analyze the following transcript (${transcript.duration.toFixed(0)}s total) and plan medium-length clips (1–3 minutes each).\n`,
    `Video: ${video.filename}`,
    `Duration: ${transcript.duration.toFixed(1)}s`,
    `Target: ~${Math.max(1, Math.round(transcript.duration / 480))}–${Math.max(2, Math.round(transcript.duration / 300))} medium clips (scale by content richness)\n`,
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
    await agent.run(prompt)
    const planned = agent.getPlannedClips()

    if (planned.length === 0) {
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

      // Generate ASS captions with medium style (smaller font, bottom-positioned)
      let captionedPath: string | undefined
      try {
        const assContent = plan.hook
          ? (segments.length === 1
              ? generateMediumASSWithHook(transcript, plan.hook, segments[0].start, segments[0].end, 1.0)
              : generateMediumASSWithHookComposite(transcript, segments, plan.hook, 1.0))
          : (segments.length === 1
              ? generateStyledASSForSegment(transcript, segments[0].start, segments[0].end, 1.0, 'medium')
              : generateStyledASSForComposite(transcript, segments, 1.0, 'medium'))

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
        `**Topic:** ${plan.topic}\n`,
        `**Hook:** ${plan.hook}\n`,
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
      })

      logger.info(`[MediumVideoAgent] Created medium clip: ${plan.title} (${totalDuration.toFixed(1)}s)`)
    }

    logger.info(`[MediumVideoAgent] Generated ${clips.length} medium clips`)
    return clips
  } finally {
    await agent.destroy()
  }
}

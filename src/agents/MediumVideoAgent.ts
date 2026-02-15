import type { ToolWithHandler } from '../providers/types.js'
import { BaseAgent } from './BaseAgent'
import { VideoFile, Transcript, MediumClip, MediumSegment } from '../types'
import { extractClip, extractCompositeClipWithTransitions } from '../tools/ffmpeg/clipExtraction'
import { generateStyledASSForSegment, generateStyledASSForComposite } from '../tools/captions/captionGenerator'
import { burnCaptions } from '../tools/ffmpeg/captionBurning'
import { generateId } from '../core/text.js'
import { slugify } from '../core/text.js'
import { writeTextFile, ensureDirectory } from '../core/fileSystem.js'
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

const SYSTEM_PROMPT = `You are a medium-form video content strategist. Your job is to analyze a video transcript with word-level timestamps and identify the best 1–3 minute segments to extract as standalone medium-form clips.

## What to look for

- **Complete topics** — a subject is introduced, explored, and concluded
- **Narrative arcs** — problem → solution → result; question → exploration → insight
- **Educational deep dives** — clear, thorough explanations of complex topics
- **Compelling stories** — anecdotes with setup, tension, and resolution
- **Strong arguments** — claim → evidence → implication sequences
- **Topic compilations** — multiple brief mentions of one theme across the video that can be compiled into a cohesive 1–3 minute segment

## Clip types

- **Deep Dive** — a single contiguous section (1–3 min) covering one topic in depth
- **Compilation** — multiple non-contiguous segments stitched together around a single theme or narrative thread (1–3 min total)

## Rules

1. Each clip must be 60–180 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence and paragraph boundaries for clean entry/exit points.
4. Each clip must be self-contained — a viewer with no other context should understand and get value from the clip.
5. Aim for 2–4 medium clips per video, depending on length and richness.
6. Every clip needs a descriptive title (5–12 words) and a topic label.
7. For compilations, specify segments in the order they should appear in the final clip (which may differ from chronological order).
8. Tags should be lowercase, no hashes, 3–6 per clip.
9. A 1-second buffer is automatically added around each segment boundary.
10. Each clip needs a hook — the opening line or concept that draws viewers in.

## Differences from shorts

- Shorts capture *moments*; medium clips capture *complete ideas*.
- Don't just find the most exciting 60 seconds — find where a topic starts and where it naturally concludes.
- It's OK if a medium clip has slower pacing — depth and coherence matter more than constant high energy.
- Look for segments that work as standalone mini-tutorials or explanations.
- Avoid overlap with content that would work better as a short (punchy, viral, single-moment).

When you have identified the clips, call the **plan_medium_clips** tool with your complete plan.

## Using Clip Direction
You may receive AI-generated clip direction with suggested medium clips. Use these as a starting point but make your own decisions:
- The suggestions are based on visual + audio analysis and may identify narrative arcs you'd miss from transcript alone
- Feel free to adjust timestamps, combine suggestions, or ignore ones that don't work
- You may also find good clips NOT in the suggestions — always analyze the full transcript
- Pay special attention to suggested hooks and topic arcs — they come from multimodal analysis`

// ── JSON Schema for the plan_medium_clips tool ──────────────────────────────

const PLAN_MEDIUM_CLIPS_SCHEMA = {
  type: 'object',
  properties: {
    clips: {
      type: 'array',
      description: 'Array of planned medium-length clips',
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

  constructor(model?: string) {
    super('MediumVideoAgent', SYSTEM_PROMPT, undefined, model)
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'plan_medium_clips',
        description:
          'Submit the planned medium-length clips as a structured JSON array. Call this once with all planned clips.',
        parameters: PLAN_MEDIUM_CLIPS_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('plan_medium_clips', args as Record<string, unknown>)
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (toolName === 'plan_medium_clips') {
      this.plannedClips = args.clips as PlannedMediumClip[]
      logger.info(`[MediumVideoAgent] Planned ${this.plannedClips.length} medium clips`)
      return { success: true, count: this.plannedClips.length }
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }

  getPlannedClips(): PlannedMediumClip[] {
    return this.plannedClips
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
    `Duration: ${transcript.duration.toFixed(1)}s\n`,
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

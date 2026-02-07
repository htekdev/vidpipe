import ffmpeg from 'fluent-ffmpeg'
import { Tool } from '@github/copilot-sdk'
import path from 'path'
import { BaseAgent } from './BaseAgent'
import { detectSilence, SilenceRegion } from '../tools/ffmpeg/silenceDetection'
import { singlePassEdit } from '../tools/ffmpeg/singlePassEdit'
import type { VideoFile, Transcript, SilenceRemovalResult } from '../types'
import logger from '../config/logger'

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe'
ffmpeg.setFfmpegPath(ffmpegPath)
ffmpeg.setFfprobePath(ffprobePath)

// ── Types for the LLM's decide_removals tool call ──────────────────────────

interface RemovalDecision {
  start: number
  end: number
  reason: string
}

// ── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a video editor AI that decides which silent regions in a video should be removed.
You will receive a transcript with timestamps and a list of detected silence regions.

Be CONSERVATIVE. Only remove silence that is CLEARLY dead air — no speech, no demonstration, no purpose.
Aim to remove no more than 10-15% of total video duration.
When in doubt, KEEP the silence.

KEEP silences that are:
- Dramatic pauses after impactful statements
- Brief thinking pauses (< 2 seconds) in natural speech
- Pauses before important reveals or demonstrations
- Pauses where the speaker is clearly showing something on screen
- Silence during screen demonstrations or typing — the viewer is watching the screen

REMOVE silences that are:
- Dead air with no purpose (> 3 seconds of nothing)
- Gaps between topics where the speaker was gathering thoughts
- Silence at the very beginning or end of the video

Return a JSON array of silence regions to REMOVE (not keep).
When you have decided, call the **decide_removals** tool with your removal list.`

// ── JSON Schema for the decide_removals tool ────────────────────────────────

const DECIDE_REMOVALS_SCHEMA = {
  type: 'object',
  properties: {
    removals: {
      type: 'array',
      description: 'Array of silence regions to remove',
      items: {
        type: 'object',
        properties: {
          start: { type: 'number', description: 'Start time in seconds' },
          end: { type: 'number', description: 'End time in seconds' },
          reason: { type: 'string', description: 'Why this silence should be removed' },
        },
        required: ['start', 'end', 'reason'],
      },
    },
  },
  required: ['removals'],
}

// ── Agent ────────────────────────────────────────────────────────────────────

class SilenceRemovalAgent extends BaseAgent {
  private removals: RemovalDecision[] = []

  constructor() {
    super('SilenceRemovalAgent', SYSTEM_PROMPT)
  }

  protected getTools(): Tool<unknown>[] {
    return [
      {
        name: 'decide_removals',
        description:
          'Submit the list of silence regions to remove. Call this once with all removal decisions.',
        parameters: DECIDE_REMOVALS_SCHEMA,
        handler: async (args: unknown) => {
          return this.handleToolCall('decide_removals', args as Record<string, unknown>)
        },
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (toolName === 'decide_removals') {
      this.removals = args.removals as RemovalDecision[]
      logger.info(`[SilenceRemovalAgent] Decided to remove ${this.removals.length} silence regions`)
      return { success: true, count: this.removals.length }
    }
    throw new Error(`Unknown tool: ${toolName}`)
  }

  getRemovals(): RemovalDecision[] {
    return this.removals
  }
}

// ── FFmpeg helpers ───────────────────────────────────────────────────────────

function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`))
      resolve(metadata.format.duration ?? 0)
    })
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect silence, use the agent to decide context-aware removals, and produce
 * an edited video with dead silence removed.
 *
 * Returns the path to the edited video, or the original path if no edits were needed.
 */
export async function removeDeadSilence(
  video: VideoFile,
  transcript: Transcript,
): Promise<SilenceRemovalResult> {
  const noEdit: SilenceRemovalResult = { editedPath: video.repoPath, removals: [], keepSegments: [], wasEdited: false }

  // 1. Detect silence regions (FFmpeg already filters to >= 0.5s via d=0.5)
  const silenceRegions = await detectSilence(video.repoPath, 0.5)

  if (silenceRegions.length === 0) {
    logger.info('[SilenceRemoval] No silence regions detected — skipping')
    return noEdit
  }

  const totalSilence = silenceRegions.reduce((sum, r) => sum + r.duration, 0)
  logger.info(`[SilenceRemoval] ${silenceRegions.length} silence regions detected (${totalSilence.toFixed(1)}s total silence)`)

  // Only send silence regions >= 2s to the agent; short pauses are natural speech rhythm
  let regionsForAgent = silenceRegions.filter(r => r.duration >= 2)
  if (regionsForAgent.length === 0) {
    logger.info('[SilenceRemoval] No silence regions >= 2s — skipping')
    return noEdit
  }

  // Cap at 30 longest regions to fit in context window
  if (regionsForAgent.length > 30) {
    regionsForAgent = [...regionsForAgent].sort((a, b) => b.duration - a.duration).slice(0, 30)
    regionsForAgent.sort((a, b) => a.start - b.start) // restore chronological order
    logger.info(`[SilenceRemoval] Capped to top 30 longest regions for agent analysis`)
  }

  // 2. Run the agent to decide which silences to remove
  const agent = new SilenceRemovalAgent()

  const transcriptLines = transcript.segments.map(
    (seg) => `[${seg.start.toFixed(2)}s – ${seg.end.toFixed(2)}s] ${seg.text}`,
  )

  const silenceLines = regionsForAgent.map(
    (r, i) => `${i + 1}. ${r.start.toFixed(2)}s – ${r.end.toFixed(2)}s (${r.duration.toFixed(2)}s)`,
  )

  const prompt = [
    `Video: ${video.filename} (${transcript.duration.toFixed(1)}s total)\n`,
    '--- TRANSCRIPT ---\n',
    transcriptLines.join('\n'),
    '\n--- END TRANSCRIPT ---\n',
    '--- SILENCE REGIONS ---\n',
    silenceLines.join('\n'),
    '\n--- END SILENCE REGIONS ---\n',
    'Analyze the context around each silence region and decide which to remove.',
  ].join('\n')

  let removals: RemovalDecision[]
  try {
    await agent.run(prompt)
    removals = agent.getRemovals()
  } finally {
    await agent.destroy()
  }

  if (removals.length === 0) {
    logger.info('[SilenceRemoval] Agent decided to keep all silences — skipping edit')
    return noEdit
  }

  // Safety: cap removals at 20% of video duration
  const maxRemoval = transcript.duration * 0.20
  let totalRemoval = 0
  const cappedRemovals: RemovalDecision[] = []
  const byDuration = [...removals].sort((a, b) => (b.end - b.start) - (a.end - a.start))
  for (const r of byDuration) {
    const dur = r.end - r.start
    if (totalRemoval + dur <= maxRemoval) {
      cappedRemovals.push(r)
      totalRemoval += dur
    }
  }
  if (cappedRemovals.length < removals.length) {
    logger.warn(`[SilenceRemoval] Capped from ${removals.length} to ${cappedRemovals.length} regions (${totalRemoval.toFixed(1)}s) to stay under 20% threshold`)
  }
  removals = cappedRemovals

  if (removals.length === 0) {
    logger.info('[SilenceRemoval] All removals exceeded 20% cap — skipping edit')
    return noEdit
  }

  // 3. Build list of segments to KEEP (inverse of removal regions)
  const videoDuration = await getVideoDuration(video.repoPath)
  const sortedRemovals = [...removals].sort((a, b) => a.start - b.start)

  const keepSegments: { start: number; end: number }[] = []
  let cursor = 0

  for (const removal of sortedRemovals) {
    if (removal.start > cursor) {
      keepSegments.push({ start: cursor, end: removal.start })
    }
    cursor = Math.max(cursor, removal.end)
  }

  if (cursor < videoDuration) {
    keepSegments.push({ start: cursor, end: videoDuration })
  }

  if (keepSegments.length === 0) {
    logger.warn('[SilenceRemoval] No segments to keep — returning original')
    return noEdit
  }

  // 4. Single-pass re-encode with trim+setpts+concat for frame-accurate cuts
  const editedPath = path.join(video.videoDir, `${video.slug}-edited.mp4`)
  await singlePassEdit(video.repoPath, keepSegments, editedPath)

  // Compute effective removals (merged, non-overlapping) from keep-segments
  const effectiveRemovals: { start: number; end: number }[] = []
  let prevEnd = 0
  for (const seg of keepSegments) {
    if (seg.start > prevEnd) {
      effectiveRemovals.push({ start: prevEnd, end: seg.start })
    }
    prevEnd = seg.end
  }
  // Don't add trailing silence as a "removal" — it's just the end of the video

  const actualRemoved = effectiveRemovals.reduce((sum, r) => sum + (r.end - r.start), 0)
  logger.info(
    `[SilenceRemoval] Removed ${effectiveRemovals.length} silence regions (${actualRemoved.toFixed(1)}s). Output: ${editedPath}`,
  )

  return {
    editedPath,
    removals: effectiveRemovals,
    keepSegments,
    wasEdited: true,
  }
}

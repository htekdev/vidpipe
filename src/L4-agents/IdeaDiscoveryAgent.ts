import { getBrandConfig } from '../L1-infra/config/brand.js'
import { getConfig } from '../L1-infra/config/environment.js'
import logger from '../L1-infra/logger/configLogger.js'
import {
  createIdea,
  listIdeas,
} from '../L3-services/ideaService/ideaService.js'
import { getProvider } from '../L3-services/llm/providerFactory.js'
import { Platform } from '../L0-pure/types/index.js'
import type {
  CreateIdeaInput,
  Idea,
  ShortClip,
  MediumClip,
  Segment,
} from '../L0-pure/types/index.js'
import { BaseAgent } from './BaseAgent.js'
import type { ToolWithHandler } from './BaseAgent.js'
import type { MCPServerConfig } from '../L2-clients/llm/types.js'

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

const SYSTEM_PROMPT = `You are an Idea Discovery agent for a video content pipeline. Your job is to analyze video clips and match them to existing content ideas — or create new ideas when no match exists.

## Two-Phase Workflow

### Phase A — Match Existing Ideas
For each clip (short and medium), determine if it covers a topic that DIRECTLY matches an existing idea.
- A match requires the clip's core topic to be the SAME topic as the idea's topic and talking points.
- Loose thematic connections are NOT matches (e.g., both about "coding" is too vague).
- When in doubt, DO NOT match — create a new idea instead.

### Phase B — Create New Ideas
For unmatched clips, create a new idea derived from the video content:
- The topic, hook, key takeaway, and talking points come from what the creator ACTUALLY SAID in the transcript.
- Do NOT invent content the creator didn't discuss.
- Use web research (if available) to augment with trend context — why this topic matters right now, related articles, supporting data.
- Set the publishBy date to the configured deadline.

## Quality Rules
- Every clip MUST end up with an idea assignment (either matched or newly created).
- Each new idea must have a clear, specific hook (not generic like "Learn about AI").
- New idea talking points must come from the actual transcript content.
- Use get_clip_transcript to read what the creator said in each clip's time range before matching or creating.
- Call finalize_assignments exactly once when all clips are assigned.

## Platform Targeting
- Short-form clips (TikTok, YouTube Shorts, Instagram Reels): Hook-first, single concept
- Medium clips (YouTube, LinkedIn): Deep dives, tutorials, story arcs`

// ============================================================================
// TYPES
// ============================================================================

interface ClipInfo {
  id: string
  type: 'short' | 'medium-clip'
  title: string
  description: string
  tags: string[]
  topic?: string
  segments: Array<{ start: number; end: number; description: string }>
  totalDuration: number
}

interface ClipAssignment {
  clipId: string
  ideaIssueNumber: number
}

export interface IdeaDiscoveryResult {
  assignments: ClipAssignment[]
  newIdeas: Idea[]
  matchedCount: number
  createdCount: number
}

export interface DiscoverIdeasInput {
  shorts: readonly ShortClip[]
  mediumClips: readonly MediumClip[]
  transcript: readonly Segment[]
  summary: string
  existingIdeas?: readonly Idea[]
  providedIdeas?: readonly Idea[]
  publishBy: string
  defaultPlatforms: readonly Platform[]
}

// ============================================================================
// HELPERS
// ============================================================================

function computeDuration(segments: readonly { start: number; end: number }[]): number {
  return segments.reduce((sum, s) => sum + (s.end - s.start), 0)
}

function clipsToInfo(shorts: readonly ShortClip[], mediumClips: readonly MediumClip[]): ClipInfo[] {
  const clips: ClipInfo[] = []

  for (let i = 0; i < shorts.length; i++) {
    const short = shorts[i]
    const segments = (short.segments ?? []).map(s => ({ start: s.start, end: s.end, description: s.description ?? '' }))
    clips.push({
      id: short.id ?? `short-${i + 1}`,
      type: 'short',
      title: short.title ?? '',
      description: short.description ?? '',
      tags: short.tags ?? [],
      segments,
      totalDuration: short.totalDuration ?? computeDuration(segments),
    })
  }

  for (let i = 0; i < mediumClips.length; i++) {
    const medium = mediumClips[i]
    const segments = (medium.segments ?? []).map(s => ({ start: s.start, end: s.end, description: s.description ?? '' }))
    clips.push({
      id: medium.id ?? `medium-${i + 1}`,
      type: 'medium-clip',
      title: medium.title ?? '',
      description: medium.description ?? '',
      tags: medium.tags ?? [],
      topic: medium.topic,
      segments,
      totalDuration: medium.totalDuration ?? computeDuration(segments),
    })
  }

  return clips
}

function getTranscriptForTimeRange(
  transcript: readonly Segment[],
  start: number,
  end: number,
): string {
  return transcript
    .filter(seg => seg.end > start && seg.start < end)
    .map(seg => seg.text)
    .join(' ')
    .trim()
}

function summarizeIdeas(ideas: readonly Idea[]): string {
  if (ideas.length === 0) return 'No existing ideas found.'

  return ideas
    .map(idea => [
      `- #${idea.issueNumber}: "${idea.topic}"`,
      `  Hook: ${idea.hook}`,
      `  Tags: ${idea.tags.join(', ')}`,
      `  Talking points: ${idea.talkingPoints.join('; ')}`,
      `  Status: ${idea.status}`,
    ].join('\n'))
    .join('\n')
}

function summarizeClips(clips: readonly ClipInfo[]): string {
  return clips
    .map(clip => [
      `- ${clip.id} (${clip.type}, ${clip.totalDuration.toFixed(0)}s): "${clip.title}"`,
      `  Description: ${clip.description}`,
      `  Tags: ${clip.tags.join(', ')}`,
      clip.topic ? `  Topic: ${clip.topic}` : '',
      `  Segments: ${clip.segments.map(s => `${s.start.toFixed(1)}-${s.end.toFixed(1)}s`).join(', ')}`,
    ].filter(Boolean).join('\n'))
    .join('\n')
}

function buildUserMessage(
  clips: readonly ClipInfo[],
  ideas: readonly Idea[],
  summary: string,
  publishBy: string,
  hasMcpServers: boolean,
): string {
  const sections = [
    `## Video Summary\n${summary.substring(0, 2000)}`,
    `\n## Clips to Assign (${clips.length} total)\n${summarizeClips(clips)}`,
    `\n## Existing Ideas (${ideas.length} total)\n${summarizeIdeas(ideas)}`,
    `\n## Default publishBy for new ideas: ${publishBy}`,
  ]

  const steps = [
    '\n## Your Steps:',
    '1. For each clip, call get_clip_transcript to read what the creator said.',
    '2. Compare each clip\'s content against the existing ideas above.',
    '3. For strong matches, call assign_idea_to_clip with the existing idea\'s issue number.',
  ]

  if (hasMcpServers) {
    steps.push(
      '4. For unmatched clips, use web search tools to research trending context for the topic.',
      '5. Call create_idea_for_clip with the topic derived from transcript + trend context from research.',
    )
  } else {
    steps.push(
      '4. For unmatched clips, call create_idea_for_clip with the topic derived from the transcript.',
    )
  }

  steps.push(
    `${hasMcpServers ? '6' : '5'}. Once ALL clips have assignments, call finalize_assignments.`,
  )

  sections.push(steps.join('\n'))
  return sections.join('\n')
}

// ============================================================================
// AGENT
// ============================================================================

export class IdeaDiscoveryAgent extends BaseAgent {
  private assignments: ClipAssignment[] = []
  private newIdeas: Idea[] = []
  private finalized = false

  private readonly clips: ClipInfo[]
  private readonly transcript: readonly Segment[]
  private readonly publishBy: string
  private readonly defaultPlatforms: readonly Platform[]

  constructor(
    private readonly input: DiscoverIdeasInput,
  ) {
    super('IdeaDiscoveryAgent', SYSTEM_PROMPT)
    this.clips = clipsToInfo(input.shorts, input.mediumClips)
    this.transcript = input.transcript
    this.publishBy = input.publishBy
    this.defaultPlatforms = input.defaultPlatforms
  }

  protected getTimeoutMs(): number {
    return 0 // No timeout — discovery may process many clips with web research
  }

  async discover(): Promise<IdeaDiscoveryResult> {
    if (this.clips.length === 0) {
      return { assignments: [], newIdeas: [], matchedCount: 0, createdCount: 0 }
    }

    const allIdeas = await this.loadIdeas()
    const hasMcp = this.getMcpServers() !== undefined

    const userMessage = buildUserMessage(
      this.clips,
      allIdeas,
      this.input.summary,
      this.publishBy,
      hasMcp,
    )

    await this.run(userMessage)

    return {
      assignments: [...this.assignments],
      newIdeas: [...this.newIdeas],
      matchedCount: this.assignments.filter(a =>
        !this.newIdeas.some(idea => idea.issueNumber === a.ideaIssueNumber),
      ).length,
      createdCount: this.newIdeas.length,
    }
  }

  private async loadIdeas(): Promise<Idea[]> {
    if (this.input.providedIdeas && this.input.providedIdeas.length > 0) {
      return [...this.input.providedIdeas]
    }

    try {
      const readyIdeas = await listIdeas({ status: 'ready' })
      const draftIdeas = await listIdeas({ status: 'draft' })
      return [...readyIdeas, ...draftIdeas]
    } catch (err) {
      logger.warn(`[IdeaDiscoveryAgent] Failed to fetch ideas: ${err instanceof Error ? err.message : String(err)}`)
      return this.input.existingIdeas ? [...this.input.existingIdeas] : []
    }
  }

  protected resetForRetry(): void {
    this.assignments = []
    this.newIdeas = []
    this.finalized = false
  }

  protected getMcpServers(): Record<string, MCPServerConfig> | undefined {
    const config = getConfig()
    const servers: Record<string, MCPServerConfig> = {}

    if (config.EXA_API_KEY) {
      servers.exa = {
        type: 'http' as const,
        url: `${config.EXA_MCP_URL}?exaApiKey=${config.EXA_API_KEY}&tools=web_search_exa`,
        headers: {},
        tools: ['*'],
      }
    }

    if (config.PERPLEXITY_API_KEY) {
      servers.perplexity = {
        type: 'local' as const,
        command: 'npx',
        args: ['-y', 'perplexity-mcp'],
        env: { PERPLEXITY_API_KEY: config.PERPLEXITY_API_KEY },
        tools: ['*'],
      }
    }

    return Object.keys(servers).length > 0 ? servers : undefined
  }

  protected getTools(): ToolWithHandler[] {
    return [
      {
        name: 'get_clip_transcript',
        description: 'Get the transcript text for a specific clip by its ID. Returns the text spoken in that time range.',
        parameters: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'The clip ID (e.g., "short-1" or "medium-1")' },
          },
          required: ['clipId'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_clip_transcript', args),
      },
      {
        name: 'assign_idea_to_clip',
        description: 'Assign an existing idea to a clip. Only use when there is a STRONG topical match between the clip content and the idea.',
        parameters: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'The clip ID to assign' },
            ideaIssueNumber: { type: 'number', description: 'The GitHub Issue number of the matching idea' },
            reason: { type: 'string', description: 'Brief explanation of why this is a strong match' },
          },
          required: ['clipId', 'ideaIssueNumber', 'reason'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('assign_idea_to_clip', args),
      },
      {
        name: 'create_idea_for_clip',
        description: 'Create a new idea from the clip content and assign it. Use when no existing idea matches the clip topic.',
        parameters: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'The clip ID to create an idea for' },
            topic: { type: 'string', description: 'Main topic (derived from transcript content)' },
            hook: { type: 'string', description: 'Attention-grabbing angle (≤80 chars, from what the creator actually said)' },
            audience: { type: 'string', description: 'Target audience for this content' },
            keyTakeaway: { type: 'string', description: 'The one thing viewers should remember (from transcript)' },
            talkingPoints: {
              type: 'array',
              items: { type: 'string' },
              description: 'Key points covered (from actual transcript content)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Categorization tags (lowercase)',
            },
            trendContext: {
              type: 'string',
              description: 'Optional: why this topic is timely NOW (from web research if available)',
            },
          },
          required: ['clipId', 'topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'tags'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('create_idea_for_clip', args),
      },
      {
        name: 'finalize_assignments',
        description: 'Confirm all clip-to-idea assignments are complete. Call exactly once when every clip has been assigned.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Brief summary of assignments made' },
          },
          required: ['summary'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('finalize_assignments', args),
      },
    ]
  }

  protected async handleToolCall(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_clip_transcript':
        return this.handleGetClipTranscript(args)
      case 'assign_idea_to_clip':
        return this.handleAssignIdea(args)
      case 'create_idea_for_clip':
        return this.handleCreateIdeaForClip(args)
      case 'finalize_assignments':
        return this.handleFinalize(args)
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private handleGetClipTranscript(args: Record<string, unknown>): { clipId: string; transcript: string } {
    const clipId = String(args.clipId ?? '')
    const clip = this.clips.find(c => c.id === clipId)
    if (!clip) {
      throw new Error(`Clip not found: ${clipId}. Available: ${this.clips.map(c => c.id).join(', ')}`)
    }

    const texts: string[] = []
    for (const seg of clip.segments) {
      const text = getTranscriptForTimeRange(this.transcript, seg.start, seg.end)
      if (text) texts.push(text)
    }

    return { clipId, transcript: texts.join('\n\n') || '(No transcript found for this time range)' }
  }

  private handleAssignIdea(args: Record<string, unknown>): { clipId: string; ideaIssueNumber: number; status: string } {
    const clipId = String(args.clipId ?? '')
    const ideaIssueNumber = Number(args.ideaIssueNumber)
    const reason = String(args.reason ?? '')

    if (!clipId || !this.clips.find(c => c.id === clipId)) {
      throw new Error(`Invalid clipId: ${clipId}`)
    }
    if (!Number.isInteger(ideaIssueNumber) || ideaIssueNumber <= 0) {
      throw new Error(`Invalid ideaIssueNumber: ${ideaIssueNumber}`)
    }
    if (this.assignments.some(a => a.clipId === clipId)) {
      throw new Error(`Clip ${clipId} already has an assignment`)
    }

    this.assignments.push({ clipId, ideaIssueNumber })
    logger.info(`[IdeaDiscoveryAgent] Matched ${clipId} → idea #${ideaIssueNumber}: ${reason}`)

    return { clipId, ideaIssueNumber, status: 'assigned' }
  }

  private async handleCreateIdeaForClip(args: Record<string, unknown>): Promise<{ clipId: string; ideaIssueNumber: number; status: string }> {
    const clipId = String(args.clipId ?? '')
    if (!clipId || !this.clips.find(c => c.id === clipId)) {
      throw new Error(`Invalid clipId: ${clipId}`)
    }
    if (this.assignments.some(a => a.clipId === clipId)) {
      throw new Error(`Clip ${clipId} already has an assignment`)
    }

    const hook = String(args.hook ?? '').trim()
    if (hook.length > 80) {
      throw new Error(`Hook must be 80 characters or fewer: ${hook}`)
    }

    const talkingPoints = Array.isArray(args.talkingPoints)
      ? (args.talkingPoints as unknown[]).map(tp => String(tp).trim()).filter(tp => tp.length > 0)
      : []
    if (talkingPoints.length === 0) {
      throw new Error('talkingPoints must be a non-empty array of strings')
    }

    const tags = Array.isArray(args.tags)
      ? (args.tags as unknown[]).map(t => String(t).trim().toLowerCase()).filter(t => t.length > 0)
      : []

    const input: CreateIdeaInput = {
      topic: String(args.topic ?? '').trim(),
      hook,
      audience: String(args.audience ?? '').trim(),
      keyTakeaway: String(args.keyTakeaway ?? '').trim(),
      talkingPoints,
      platforms: [...this.defaultPlatforms],
      tags,
      publishBy: this.publishBy,
      trendContext: typeof args.trendContext === 'string' ? args.trendContext.trim() || undefined : undefined,
    }

    const idea = await createIdea(input)
    this.newIdeas.push(idea)
    this.assignments.push({ clipId, ideaIssueNumber: idea.issueNumber })

    logger.info(`[IdeaDiscoveryAgent] Created idea #${idea.issueNumber} ("${idea.topic}") for ${clipId}`)

    return { clipId, ideaIssueNumber: idea.issueNumber, status: 'created' }
  }

  private handleFinalize(args: Record<string, unknown>): { totalClips: number; assigned: number; matched: number; created: number; unassigned: string[] } {
    this.finalized = true
    const summary = String(args.summary ?? '')
    const assignedIds = new Set(this.assignments.map(a => a.clipId))
    const unassigned = this.clips.filter(c => !assignedIds.has(c.id)).map(c => c.id)
    const matchedCount = this.assignments.filter(a =>
      !this.newIdeas.some(idea => idea.issueNumber === a.ideaIssueNumber),
    ).length

    logger.info(`[IdeaDiscoveryAgent] Finalized: ${this.assignments.length}/${this.clips.length} clips assigned (${matchedCount} matched, ${this.newIdeas.length} created). ${summary}`)

    if (unassigned.length > 0) {
      logger.warn(`[IdeaDiscoveryAgent] ${unassigned.length} clips unassigned: ${unassigned.join(', ')}`)
    }

    return {
      totalClips: this.clips.length,
      assigned: this.assignments.length,
      matched: matchedCount,
      created: this.newIdeas.length,
      unassigned,
    }
  }

  async destroy(): Promise<void> {
    await super.destroy()
  }
}

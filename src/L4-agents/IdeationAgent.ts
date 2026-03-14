import { readJsonFile } from '../L1-infra/fileSystem/fileSystem.js'
import { getBrandConfig } from '../L1-infra/config/brand.js'
import { getConfig } from '../L1-infra/config/environment.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import logger from '../L1-infra/logger/configLogger.js'
import {
  createIdea,
  findRelatedIdeas,
  getIdea,
  listIdeas,
  searchIdeas,
  updateIdea,
} from '../L3-services/ideaService/ideaService.js'
import { getProvider } from '../L3-services/llm/providerFactory.js'
import { Platform } from '../L0-pure/types/index.js'
import type { CreateIdeaInput, Idea, IdeaFilters, IdeaStatus } from '../L0-pure/types/index.js'
import { BaseAgent } from './BaseAgent.js'
import type { ToolWithHandler } from './BaseAgent.js'
import type { MCPServerConfig } from '../L2-clients/llm/types.js'

const BASE_SYSTEM_PROMPT = `You are a content strategist for a tech content creator. Your role is to research trending topics, analyze what's working, and generate compelling video ideas grounded in real-world data.

## CRITICAL: Research Before Creating
You MUST research before creating ideas. Do NOT skip the research phase. Ideas generated without research will be generic and stale. The value you provide is grounding ideas in what's ACTUALLY trending right now.

## GitHub Issue Workflow
Ideas are stored as GitHub Issues in a dedicated repository. Treat the issue tracker as the source of truth:
- Use get_past_ideas to inspect the current issue backlog with optional filters.
- Use search_ideas for full-text lookups before creating something new.
- Use find_related_ideas to cluster overlapping ideas by tags and avoid duplicates.
- Use create_idea to create new draft issues.
- Use update_idea or organize_ideas when an existing issue should be refined instead of creating a duplicate.

## Your Research Process
1. Load the brand context (get_brand_context) to understand the creator's voice, expertise, and content pillars.
2. Check existing GitHub issue ideas (get_past_ideas and search_ideas) to avoid duplicates.
3. **RESEARCH PHASE** — This is the most important step. Use the available MCP tools:
   - **web_search_exa**: Search for trending topics, viral content, recent announcements, and hot takes in the creator's niche. Search for specific topics from the creator's content pillars.
   - **youtube_search_videos** or **youtube_search**: Find what videos are performing well right now. Look at view counts, recent uploads on trending topics, and gaps in existing content.
   - **perplexity-search**: Get current analysis on promising topics, recent developments, and emerging trends.
   - Do at LEAST 2-3 research queries across different tools. More is better.
4. Generate ideas that synthesize your research findings with the creator's brand and content pillars.

## Idea Quality Bar
Every idea must:
- Have a clear, specific hook (not generic like "Learn about AI")
- Target a defined audience
- Deliver one memorable takeaway
- Be timely — the trendContext field MUST reference specific findings from your research (e.g., "GitHub Copilot just released X feature this week" or "This topic has 2M views in the last 7 days on YouTube")
- Fit within the creator's established content pillars
- Set publishBy based on timeliness:
  * Breaking news / hot trend: 3-5 days from now
  * Timely topic (release, event, announcement): 1-2 weeks from now
  * Evergreen content (tutorials, fundamentals): 3-6 months from now

## Platform Targeting
- Short-form (TikTok, YouTube Shorts, Instagram Reels): Hook-first, single concept, ≤60s
- Long-form (YouTube): Deep dives, tutorials, analysis, 8-20 min
- Written (LinkedIn, X/Twitter): Thought leadership, hot takes, thread-worthy

Generate 3-5 high-quality ideas. Quality over quantity. Every idea must be backed by research.`

const SUPPORTED_PLATFORMS = [
  Platform.TikTok,
  Platform.YouTube,
  Platform.Instagram,
  Platform.LinkedIn,
  Platform.X,
] as const
const SUPPORTED_STATUSES = ['draft', 'ready', 'recorded', 'published'] as const
const SUPPORTED_PRIORITIES = ['hot-trend', 'timely', 'evergreen'] as const
const MIN_IDEA_COUNT = 3
const MAX_IDEA_COUNT = 5
const DEFAULT_EXISTING_IDEA_LIMIT = 50

type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number]
type SupportedStatus = (typeof SUPPORTED_STATUSES)[number]
type IdeaPriority = (typeof SUPPORTED_PRIORITIES)[number]
type BrandContext = ReturnType<typeof getBrandConfig> & Record<string, unknown>
type IdeaUpdates = Partial<CreateIdeaInput> & { status?: IdeaStatus }

interface ContentPillarSummary {
  pillar: string
  description?: string
  frequency?: string
  formats?: string[]
}

interface GenerateIdeasOptions {
  seedTopics?: string[]
  count?: number
  ideasDir?: string
  brandPath?: string
}

interface IdeationAgentContext {
  readonly brandContext: BrandContext
  readonly existingIdeas: Idea[]
  readonly ideaRepo: string
  readonly targetCount: number
}

interface OrganizeIdeaItem {
  issueNumber: number
  updates?: IdeaUpdates
  includeRelated?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function hasField(source: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, field)
}

function normalizeCount(count?: number): number {
  if (typeof count !== 'number' || Number.isNaN(count)) {
    return MIN_IDEA_COUNT
  }

  const rounded = Math.round(count)
  return Math.min(MAX_IDEA_COUNT, Math.max(MIN_IDEA_COUNT, rounded))
}

function normalizeSeedTopics(seedTopics?: string[]): string[] {
  return (seedTopics ?? [])
    .map((topic) => topic.trim())
    .filter((topic) => topic.length > 0)
}

function extractStringArrayField(source: Record<string, unknown>, field: string): string[] {
  const value = source[field]
  return isStringArray(value) ? value : []
}

function extractContentPillars(brand: BrandContext): ContentPillarSummary[] {
  const raw = brand.contentPillars
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.flatMap((entry) => {
    if (typeof entry === 'string') {
      const pillar = entry.trim()
      return pillar ? [{ pillar }] : []
    }

    if (!isRecord(entry)) {
      return []
    }

    const pillar = typeof entry.pillar === 'string' ? entry.pillar.trim() : ''
    if (!pillar) {
      return []
    }

    const description = typeof entry.description === 'string' ? entry.description.trim() : undefined
    const frequency = typeof entry.frequency === 'string' ? entry.frequency.trim() : undefined
    const formats = isStringArray(entry.formats)
      ? entry.formats.map((format) => format.trim()).filter((format) => format.length > 0)
      : undefined

    return [{ pillar, description, frequency, formats }]
  })
}

function summarizeExistingIdeas(ideas: readonly Idea[]): string {
  if (ideas.length === 0) {
    return 'No existing GitHub issue ideas found in the repository.'
  }

  return ideas
    .slice(0, 25)
    .map((idea) => `- #${idea.issueNumber}: ${idea.topic} [${idea.status}] (${idea.issueUrl})`)
    .join('\n')
}

function buildPlatformGuidance(): string {
  return [
    `Allowed platforms for create_idea: ${SUPPORTED_PLATFORMS.join(', ')}`,
    `Create between ${MIN_IDEA_COUNT} and ${MAX_IDEA_COUNT} ideas unless the user explicitly requests fewer within that range.`,
    'Call create_idea once per new idea issue, then call finalize_ideas exactly once when done.',
    'Prefer update_idea or organize_ideas when you discover that a GitHub issue already covers the concept.',
  ].join('\n')
}

function buildBrandPromptSection(brand: BrandContext): string {
  const contentPillars = extractContentPillars(brand)
  const expertise = extractStringArrayField(brand, 'expertise')
  const differentiators = extractStringArrayField(brand, 'differentiators')
  const positioning = typeof brand.positioning === 'string' ? brand.positioning.trim() : ''

  const lines = [
    '## Brand Context',
    `Creator: ${brand.name} (${brand.handle})`,
    `Tagline: ${brand.tagline}`,
    `Voice tone: ${brand.voice.tone}`,
    `Voice personality: ${brand.voice.personality}`,
    `Voice style: ${brand.voice.style}`,
    `Primary advocacy: ${brand.advocacy.primary.join(', ') || 'None specified'}`,
    `Interests: ${brand.advocacy.interests.join(', ') || 'None specified'}`,
    `Avoid: ${brand.advocacy.avoids.join(', ') || 'None specified'}`,
    `Social guidance: ${brand.contentGuidelines.socialFocus}`,
  ]

  if (positioning) {
    lines.push(`Positioning: ${positioning}`)
  }

  if (expertise.length > 0) {
    lines.push(`Expertise areas: ${expertise.join(', ')}`)
  }

  if (differentiators.length > 0) {
    lines.push('Differentiators:')
    lines.push(...differentiators.map((item) => `- ${item}`))
  }

  if (contentPillars.length > 0) {
    lines.push('Content pillars:')
    lines.push(
      ...contentPillars.map((pillar) => {
        const details = [
          pillar.description,
          pillar.frequency && `Frequency: ${pillar.frequency}`,
          pillar.formats?.length ? `Formats: ${pillar.formats.join(', ')}` : undefined,
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' | ')

        return details ? `- ${pillar.pillar}: ${details}` : `- ${pillar.pillar}`
      }),
    )
  }

  return lines.join('\n')
}

function buildIdeaRepoPromptSection(ideaRepo: string): string {
  return [
    '## GitHub Idea Repository',
    `Dedicated issue repo: ${ideaRepo}`,
    'Every idea is a GitHub Issue. The issue tracker is the source of truth for duplicates, lifecycle status, tags, and related concepts.',
  ].join('\n')
}

function buildSystemPrompt(
  brand: BrandContext,
  existingIdeas: readonly Idea[],
  seedTopics: readonly string[],
  count: number,
  ideaRepo: string,
): string {
  const promptSections = [
    BASE_SYSTEM_PROMPT,
    '',
    buildIdeaRepoPromptSection(ideaRepo),
    '',
    buildBrandPromptSection(brand),
    '',
    '## Existing Idea Issues',
    summarizeExistingIdeas(existingIdeas),
    '',
    '## Planning Constraints',
    `Target idea count: ${count}`,
    buildPlatformGuidance(),
  ]

  if (seedTopics.length > 0) {
    promptSections.push('', '## Seed Topics', ...seedTopics.map((topic) => `- ${topic}`))
  }

  return promptSections.join('\n')
}

function buildUserMessage(count: number, seedTopics: readonly string[], hasMcpServers: boolean): string {
  const focusText = seedTopics.length > 0
    ? `Focus areas: ${seedTopics.join(', ')}`
    : 'Focus areas: choose the strongest timely opportunities from the creator context and current trends.'

  const steps = [
    '1. Call get_brand_context to load the creator profile.',
    '2. Call get_past_ideas (and search_ideas if needed) to inspect existing GitHub issue ideas before proposing anything new.',
  ]

  if (hasMcpServers) {
    steps.push(
      '3. RESEARCH PHASE (REQUIRED): Before creating ANY ideas, use the available MCP tools to research current trends:',
      '   - Use web_search_exa to find trending topics, recent news, and viral content in the focus areas.',
      '   - Use youtube_search or youtube_search_videos to find what videos are performing well right now.',
      '   - Use perplexity-search to get current analysis on promising topics.',
      '   Do at least 2-3 research queries. Each idea you create MUST reference specific findings from this research in its trendContext field.',
      `4. Call create_idea for each of the ${count} ideas, grounding each in your research findings.`,
      '5. If you uncover overlap with existing issues, prefer update_idea or organize_ideas over creating duplicates.',
      '6. Call finalize_ideas when done.',
    )
  } else {
    steps.push(
      `3. Call create_idea for each of the ${count} ideas.`,
      '4. If you uncover overlap with existing issues, prefer update_idea or organize_ideas over creating duplicates.',
      '5. Call finalize_ideas when done.',
    )
  }

  return [
    `Generate ${count} new content ideas.`,
    focusText,
    '',
    'Follow this exact workflow:',
    ...steps,
  ].join('\n')
}

async function loadBrandContext(brandPath?: string): Promise<BrandContext> {
  if (!brandPath) {
    return await Promise.resolve(getBrandConfig()) as BrandContext
  }

  return readJsonFile<BrandContext>(brandPath)
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}: expected string`)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`Invalid ${field}: value cannot be empty`)
  }

  return normalized
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid ${field}: expected string`)
  }

  const normalized = value.trim()
  return normalized || undefined
}

function normalizeStringList(value: unknown, field: string): string[] {
  if (!isStringArray(value)) {
    throw new Error(`Invalid ${field}: expected string[]`)
  }

  return value
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function normalizeIssueNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid issueNumber: expected a positive integer')
  }

  return value
}

function normalizePublishBy(value: unknown, field = 'publishBy'): string {
  const publishBy = normalizeRequiredString(value, field)
  if (Number.isNaN(new Date(publishBy).getTime())) {
    throw new Error(`Invalid ${field} date: ${publishBy}`)
  }

  return publishBy
}

function normalizePlatforms(platforms: unknown): Platform[] {
  const values = normalizeStringList(platforms, 'platforms').map((platform) => platform.toLowerCase())
  const invalid = values.filter((platform) => !SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform))
  if (invalid.length > 0) {
    throw new Error(`Unsupported platforms: ${invalid.join(', ')}`)
  }

  return values as Platform[]
}

function normalizeStatus(value: unknown): IdeaStatus {
  const status = normalizeRequiredString(value, 'status').toLowerCase()
  if (!SUPPORTED_STATUSES.includes(status as SupportedStatus)) {
    throw new Error(`Unsupported status: ${status}`)
  }

  return status as IdeaStatus
}

function parseCreateIdeaInput(args: Record<string, unknown>): CreateIdeaInput {
  const hook = normalizeRequiredString(args.hook, 'hook')
  if (hook.length > 80) {
    throw new Error(`Idea hook must be 80 characters or fewer: ${hook}`)
  }

  return {
    topic: normalizeRequiredString(args.topic, 'topic'),
    hook,
    audience: normalizeRequiredString(args.audience, 'audience'),
    keyTakeaway: normalizeRequiredString(args.keyTakeaway, 'keyTakeaway'),
    talkingPoints: normalizeStringList(args.talkingPoints, 'talkingPoints'),
    platforms: normalizePlatforms(args.platforms),
    tags: normalizeStringList(args.tags, 'tags'),
    publishBy: normalizePublishBy(args.publishBy),
    trendContext: normalizeOptionalString(args.trendContext, 'trendContext'),
  }
}

function parseIdeaFilters(args: Record<string, unknown>): IdeaFilters {
  const filters: IdeaFilters = {}

  if (hasField(args, 'status') && args.status !== undefined) {
    filters.status = normalizeStatus(args.status)
  }

  if (hasField(args, 'platform') && args.platform !== undefined) {
    filters.platform = normalizePlatforms([args.platform].flat())[0]
  }

  if (hasField(args, 'tag') && args.tag !== undefined) {
    filters.tag = normalizeRequiredString(args.tag, 'tag')
  }

  if (hasField(args, 'priority') && args.priority !== undefined) {
    const priority = normalizeRequiredString(args.priority, 'priority').toLowerCase()
    if (!SUPPORTED_PRIORITIES.includes(priority as IdeaPriority)) {
      throw new Error(`Unsupported priority: ${priority}`)
    }
    filters.priority = priority as IdeaFilters['priority']
  }

  if (hasField(args, 'limit') && args.limit !== undefined) {
    if (typeof args.limit !== 'number' || !Number.isInteger(args.limit) || args.limit <= 0) {
      throw new Error('Invalid limit: expected a positive integer')
    }
    filters.limit = args.limit
  }

  return filters
}

function extractIdeaUpdates(source: Record<string, unknown>): IdeaUpdates {
  const updates: IdeaUpdates = {}

  if (hasField(source, 'topic')) {
    updates.topic = normalizeRequiredString(source.topic, 'updates.topic')
  }
  if (hasField(source, 'hook')) {
    const hook = normalizeRequiredString(source.hook, 'updates.hook')
    if (hook.length > 80) {
      throw new Error(`Idea hook must be 80 characters or fewer: ${hook}`)
    }
    updates.hook = hook
  }
  if (hasField(source, 'audience')) {
    updates.audience = normalizeRequiredString(source.audience, 'updates.audience')
  }
  if (hasField(source, 'keyTakeaway')) {
    updates.keyTakeaway = normalizeRequiredString(source.keyTakeaway, 'updates.keyTakeaway')
  }
  if (hasField(source, 'talkingPoints')) {
    updates.talkingPoints = normalizeStringList(source.talkingPoints, 'updates.talkingPoints')
  }
  if (hasField(source, 'platforms')) {
    updates.platforms = normalizePlatforms(source.platforms)
  }
  if (hasField(source, 'tags')) {
    updates.tags = normalizeStringList(source.tags, 'updates.tags')
  }
  if (hasField(source, 'publishBy')) {
    updates.publishBy = normalizePublishBy(source.publishBy, 'updates.publishBy')
  }
  if (hasField(source, 'trendContext')) {
    updates.trendContext = normalizeOptionalString(source.trendContext, 'updates.trendContext')
  }
  if (hasField(source, 'status')) {
    updates.status = normalizeStatus(source.status)
  }

  return updates
}

function parseUpdateIdeaArgs(args: Record<string, unknown>): { issueNumber: number; updates: IdeaUpdates } {
  if (!isRecord(args.updates)) {
    throw new Error('Invalid update_idea arguments: updates must be an object')
  }

  return {
    issueNumber: normalizeIssueNumber(args.issueNumber),
    updates: extractIdeaUpdates(args.updates),
  }
}

function parseOrganizeIdeasArgs(args: Record<string, unknown>): OrganizeIdeaItem[] {
  const { items } = args
  if (!Array.isArray(items)) {
    throw new Error('Invalid organize_ideas arguments: items must be an array')
  }

  return items.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Invalid organize_ideas item at index ${index}`)
    }

    if (item.updates !== undefined && !isRecord(item.updates)) {
      throw new Error(`Invalid organize_ideas item at index ${index}: updates must be an object`)
    }

    return {
      issueNumber: normalizeIssueNumber(item.issueNumber),
      updates: item.updates ? extractIdeaUpdates(item.updates) : undefined,
      includeRelated: item.includeRelated === undefined ? true : Boolean(item.includeRelated),
    }
  })
}

function summarizeLinkedIssues(ideas: readonly Idea[]): Array<Pick<Idea, 'issueNumber' | 'issueUrl' | 'topic' | 'tags'>> {
  return ideas.map((idea) => ({
    issueNumber: idea.issueNumber,
    issueUrl: idea.issueUrl,
    topic: idea.topic,
    tags: idea.tags,
  }))
}

class IdeationAgent extends BaseAgent {
  private readonly brandContext: BrandContext
  private readonly existingIdeas: Idea[]
  private readonly ideaRepo: string
  private readonly targetCount: number
  private generatedIdeas: Idea[] = []
  private finalized = false

  constructor(systemPrompt: string, context: IdeationAgentContext, model?: string) {
    super('IdeationAgent', systemPrompt, getProvider(), model ?? getModelForAgent('IdeationAgent'))
    this.brandContext = context.brandContext
    this.existingIdeas = [...context.existingIdeas]
    this.ideaRepo = context.ideaRepo
    this.targetCount = context.targetCount
  }

  protected resetForRetry(): void {
    this.generatedIdeas = []
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

    if (config.YOUTUBE_API_KEY) {
      servers.youtube = {
        type: 'local' as const,
        command: 'npx',
        args: ['-y', '@htekdev/youtube-mcp-server'],
        env: { YOUTUBE_API_KEY: config.YOUTUBE_API_KEY },
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
        name: 'get_brand_context',
        description: 'Return the creator brand context and content pillars.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_brand_context', args),
      },
      {
        name: 'get_past_ideas',
        description: 'List GitHub-backed ideas with optional status, platform, tag, priority, or limit filters.',
        parameters: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: [...SUPPORTED_STATUSES] },
            platform: { type: 'string', enum: [...SUPPORTED_PLATFORMS] },
            tag: { type: 'string' },
            priority: { type: 'string', enum: [...SUPPORTED_PRIORITIES] },
            limit: { type: 'integer', minimum: 1 },
          },
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_past_ideas', args),
      },
      {
        name: 'create_idea',
        description: `Create a new draft GitHub Issue in ${this.ideaRepo} using the full idea schema.`,
        parameters: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Main topic or title' },
            hook: { type: 'string', description: 'Attention-grabbing hook (80 chars max)' },
            audience: { type: 'string', description: 'Target audience' },
            keyTakeaway: { type: 'string', description: 'Single memorable takeaway' },
            talkingPoints: {
              type: 'array',
              items: { type: 'string' },
              description: 'Bullet points to cover in the recording',
            },
            platforms: {
              type: 'array',
              items: {
                type: 'string',
                enum: [...SUPPORTED_PLATFORMS],
              },
              description: 'Target publishing platforms',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Categorization tags',
            },
            publishBy: {
              type: 'string',
              description: 'ISO 8601 date for when this content should be published by. Hot trends: 3-5 days, timely events: 1-2 weeks, evergreen: 3-6 months.',
            },
            trendContext: {
              type: 'string',
              description: 'Why this idea is timely right now',
            },
          },
          required: ['topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'platforms', 'tags', 'publishBy'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('create_idea', args),
      },
      {
        name: 'search_ideas',
        description: 'Search GitHub-backed ideas with full-text search across issue content.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Full-text search query' },
          },
          required: ['query'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('search_ideas', args),
      },
      {
        name: 'find_related_ideas',
        description: 'Find related ideas for an issue by looking up the issue and matching similar tagged GitHub ideas.',
        parameters: {
          type: 'object',
          properties: {
            issueNumber: { type: 'integer', description: 'GitHub issue number for the idea' },
          },
          required: ['issueNumber'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('find_related_ideas', args),
      },
      {
        name: 'update_idea',
        description: 'Update an existing GitHub idea issue: refine copy, adjust labels, or change lifecycle status.',
        parameters: {
          type: 'object',
          properties: {
            issueNumber: { type: 'integer', description: 'GitHub issue number for the idea' },
            updates: {
              type: 'object',
              properties: {
                topic: { type: 'string' },
                hook: { type: 'string' },
                audience: { type: 'string' },
                keyTakeaway: { type: 'string' },
                talkingPoints: { type: 'array', items: { type: 'string' } },
                platforms: { type: 'array', items: { type: 'string', enum: [...SUPPORTED_PLATFORMS] } },
                tags: { type: 'array', items: { type: 'string' } },
                publishBy: { type: 'string' },
                trendContext: { type: 'string' },
                status: { type: 'string', enum: [...SUPPORTED_STATUSES] },
              },
            },
          },
          required: ['issueNumber', 'updates'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('update_idea', args),
      },
      {
        name: 'organize_ideas',
        description: 'Batch update GitHub idea issue labels/statuses and return related issue links for clustering.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  issueNumber: { type: 'integer' },
                  updates: {
                    type: 'object',
                    properties: {
                      topic: { type: 'string' },
                      hook: { type: 'string' },
                      audience: { type: 'string' },
                      keyTakeaway: { type: 'string' },
                      talkingPoints: { type: 'array', items: { type: 'string' } },
                      platforms: { type: 'array', items: { type: 'string', enum: [...SUPPORTED_PLATFORMS] } },
                      tags: { type: 'array', items: { type: 'string' } },
                      publishBy: { type: 'string' },
                      trendContext: { type: 'string' },
                      status: { type: 'string', enum: [...SUPPORTED_STATUSES] },
                    },
                  },
                  includeRelated: { type: 'boolean' },
                },
                required: ['issueNumber'],
              },
            },
          },
          required: ['items'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('organize_ideas', args),
      },
      {
        name: 'finalize_ideas',
        description: 'Signal that idea generation is complete.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('finalize_ideas', args),
      },
    ]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'get_brand_context':
        return this.brandContext ?? await Promise.resolve(getBrandConfig())
      case 'get_past_ideas':
        return await listIdeas(parseIdeaFilters(args))
      case 'create_idea':
        return await this.handleCreateIdea(args)
      case 'search_ideas':
        return await searchIdeas(normalizeRequiredString(args.query, 'query'))
      case 'find_related_ideas':
        return await this.handleFindRelatedIdeas(args)
      case 'update_idea':
        return await this.handleUpdateIdea(args)
      case 'organize_ideas':
        return await this.handleOrganizeIdeas(args)
      case 'finalize_ideas':
        this.finalized = true
        return { success: true, count: this.generatedIdeas.length }
      default:
        throw new Error(`Unknown tool: ${toolName}`)
    }
  }

  private async handleCreateIdea(args: Record<string, unknown>): Promise<{ success: true; idea: Idea }> {
    if (this.generatedIdeas.length >= this.targetCount) {
      throw new Error(`Target idea count already reached (${this.targetCount})`)
    }

    const input = parseCreateIdeaInput(args)
    const duplicateTopic = this.findDuplicateTopic(input.topic)
    if (duplicateTopic) {
      throw new Error(`Duplicate idea topic detected: ${duplicateTopic}`)
    }

    const idea = await createIdea(input)
    this.upsertIdea(this.existingIdeas, idea)
    this.upsertIdea(this.generatedIdeas, idea)
    logger.info(`[IdeationAgent] Created GitHub idea #${idea.issueNumber}: ${idea.topic}`)

    return { success: true, idea }
  }

  private async handleFindRelatedIdeas(args: Record<string, unknown>): Promise<Idea[]> {
    const issueNumber = normalizeIssueNumber(args.issueNumber)
    const idea = await getIdea(issueNumber)
    if (!idea) {
      throw new Error(`Idea #${issueNumber} was not found in ${this.ideaRepo}`)
    }

    return await findRelatedIdeas(idea)
  }

  private async handleUpdateIdea(args: Record<string, unknown>): Promise<{ success: true; idea: Idea }> {
    const { issueNumber, updates } = parseUpdateIdeaArgs(args)
    const idea = await updateIdea(issueNumber, updates)
    this.upsertIdea(this.existingIdeas, idea)
    this.syncGeneratedIdea(idea)
    logger.info(`[IdeationAgent] Updated GitHub idea #${idea.issueNumber}: ${idea.topic}`)

    return { success: true, idea }
  }

  private async handleOrganizeIdeas(args: Record<string, unknown>): Promise<{
    success: true
    items: Array<{
      issueNumber: number
      idea: Idea
      linkedIssues: Array<Pick<Idea, 'issueNumber' | 'issueUrl' | 'topic' | 'tags'>>
    }>
  }> {
    const items = parseOrganizeIdeasArgs(args)
    const organizedItems = await Promise.all(
      items.map(async (item) => {
        const currentIdea = await getIdea(item.issueNumber)
        if (!currentIdea) {
          throw new Error(`Idea #${item.issueNumber} was not found in ${this.ideaRepo}`)
        }

        const nextIdea = item.updates ? await updateIdea(item.issueNumber, item.updates) : currentIdea
        this.upsertIdea(this.existingIdeas, nextIdea)
        this.syncGeneratedIdea(nextIdea)

        const relatedIdeas = item.includeRelated ? await findRelatedIdeas(nextIdea) : []
        return {
          issueNumber: nextIdea.issueNumber,
          idea: nextIdea,
          linkedIssues: summarizeLinkedIssues(relatedIdeas),
        }
      }),
    )

    return {
      success: true,
      items: organizedItems,
    }
  }

  private upsertIdea(collection: Idea[], nextIdea: Idea): void {
    const existingIndex = collection.findIndex((idea) => idea.issueNumber === nextIdea.issueNumber)
    if (existingIndex === -1) {
      collection.push(nextIdea)
      return
    }

    collection.splice(existingIndex, 1, nextIdea)
  }

  private syncGeneratedIdea(nextIdea: Idea): void {
    const existingIndex = this.generatedIdeas.findIndex((idea) => idea.issueNumber === nextIdea.issueNumber)
    if (existingIndex !== -1) {
      this.generatedIdeas.splice(existingIndex, 1, nextIdea)
    }
  }

  private findDuplicateTopic(topic: string): string | undefined {
    const normalizedTopic = topic.trim().toLowerCase()
    const existing = [...this.existingIdeas, ...this.generatedIdeas]
      .find((idea) => idea.topic.trim().toLowerCase() === normalizedTopic)

    return existing?.topic
  }

  getGeneratedIdeas(): Idea[] {
    return [...this.generatedIdeas]
  }

  isFinalized(): boolean {
    return this.finalized
  }
}

export async function generateIdeas(options: GenerateIdeasOptions = {}): Promise<Idea[]> {
  const seedTopics = normalizeSeedTopics(options.seedTopics)
  const count = normalizeCount(options.count)
  const config = getConfig()
  const previousBrandPath = config.BRAND_PATH

  if (options.brandPath) {
    config.BRAND_PATH = options.brandPath
  }

  const brandContext = await loadBrandContext(options.brandPath)
  const existingIdeas = await listIdeas({ limit: DEFAULT_EXISTING_IDEA_LIMIT })
  const systemPrompt = buildSystemPrompt(brandContext, existingIdeas, seedTopics, count, config.IDEAS_REPO)
  const agent = new IdeationAgent(systemPrompt, {
    brandContext,
    existingIdeas,
    ideaRepo: config.IDEAS_REPO,
    targetCount: count,
  })

  try {
    const hasMcpServers = !!(config.EXA_API_KEY || config.YOUTUBE_API_KEY || config.PERPLEXITY_API_KEY)
    const userMessage = buildUserMessage(count, seedTopics, hasMcpServers)
    await agent.run(userMessage)

    const ideas = agent.getGeneratedIdeas()
    if (!agent.isFinalized()) {
      logger.warn('[IdeationAgent] finalize_ideas was not called before returning results')
    }

    return ideas
  } finally {
    config.BRAND_PATH = previousBrandPath
    await agent.destroy()
  }
}

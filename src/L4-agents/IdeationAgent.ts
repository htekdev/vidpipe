import { readJsonFile } from '../L1-infra/fileSystem/fileSystem.js'
import { getBrandConfig } from '../L1-infra/config/brand.js'
import { getConfig } from '../L1-infra/config/environment.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import { readIdeaBank, writeIdea } from '../L1-infra/ideaStore/ideaStore.js'
import logger from '../L1-infra/logger/configLogger.js'
import { getProvider } from '../L3-services/llm/providerFactory.js'
import { BaseAgent } from './BaseAgent.js'
import type { ToolWithHandler } from './BaseAgent.js'
import type { MCPServerConfig } from '../L2-clients/llm/types.js'
import type { Idea } from '../L0-pure/types/index.js'

const BASE_SYSTEM_PROMPT = `You are a content strategist for a tech content creator. Your role is to research trending topics, analyze what's working, and generate compelling video ideas grounded in real-world data.

## CRITICAL: Research Before Creating
You MUST research before creating ideas. Do NOT skip the research phase. Ideas generated without research will be generic and stale. The value you provide is grounding ideas in what's ACTUALLY trending right now.

## Your Research Process
1. Load the brand context (get_brand_context) to understand the creator's voice, expertise, and content pillars.
2. Check existing ideas (get_past_ideas) to avoid duplicates.
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

const SUPPORTED_PLATFORMS = ['tiktok', 'youtube', 'instagram', 'linkedin', 'x'] as const
const MIN_IDEA_COUNT = 3
const MAX_IDEA_COUNT = 5

type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number]
type BrandContext = ReturnType<typeof getBrandConfig> & Record<string, unknown>

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

interface CreateIdeaArgs {
  id: string
  topic: string
  hook: string
  audience: string
  keyTakeaway: string
  talkingPoints: string[]
  platforms: string[]
  tags: string[]
  publishBy: string
  trendContext?: string
}

interface IdeationAgentContext {
  readonly brandContext: BrandContext
  readonly existingIdeas: Idea[]
  readonly ideasDir?: string
  readonly targetCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
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
    return 'No existing ideas found in the bank.'
  }

  return ideas
    .slice(0, 25)
    .map((idea) => `- ${idea.id}: ${idea.topic} [${idea.status}]`)
    .join('\n')
}

function buildPlatformGuidance(): string {
  return [
    `Allowed platforms for create_idea: ${SUPPORTED_PLATFORMS.join(', ')}`,
    `Create between ${MIN_IDEA_COUNT} and ${MAX_IDEA_COUNT} ideas unless the user explicitly requests fewer within that range.`,
    'Call create_idea once per idea, then call finalize_ideas exactly once when done.',
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
        const details = [pillar.description, pillar.frequency && `Frequency: ${pillar.frequency}`, pillar.formats?.length ? `Formats: ${pillar.formats.join(', ')}` : undefined]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' | ')

        return details ? `- ${pillar.pillar}: ${details}` : `- ${pillar.pillar}`
      }),
    )
  }

  return lines.join('\n')
}

function buildSystemPrompt(
  brand: BrandContext,
  existingIdeas: readonly Idea[],
  seedTopics: readonly string[],
  count: number,
): string {
  const promptSections = [
    BASE_SYSTEM_PROMPT,
    '',
    buildBrandPromptSection(brand),
    '',
    '## Existing Idea Bank',
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
    '2. Call get_past_ideas to see what already exists.',
  ]

  if (hasMcpServers) {
    steps.push(
      '3. RESEARCH PHASE (REQUIRED): Before creating ANY ideas, use the available MCP tools to research current trends:',
      '   - Use web_search_exa to find trending topics, recent news, and viral content in the focus areas.',
      '   - Use youtube_search or youtube_search_videos to find what videos are performing well right now.',
      '   - Use perplexity-search to get current analysis on promising topics.',
      '   Do at least 2-3 research queries. Each idea you create MUST reference specific findings from this research in its trendContext field.',
      `4. Call create_idea for each of the ${count} ideas, grounding each in your research findings.`,
      '5. Call finalize_ideas when done.',
    )
  } else {
    steps.push(
      `3. Call create_idea for each of the ${count} ideas.`,
      '4. Call finalize_ideas when done.',
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

function normalizePlatforms(platforms: string[]): Idea['platforms'] {
  const normalized = platforms.map((platform) => platform.trim().toLowerCase())
  const invalid = normalized.filter((platform) => !SUPPORTED_PLATFORMS.includes(platform as SupportedPlatform))
  if (invalid.length > 0) {
    throw new Error(`Unsupported platforms: ${invalid.join(', ')}`)
  }

  return normalized as Idea['platforms']
}

function assertKebabCaseId(id: string): string {
  const normalized = id.trim()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`Idea ID must be kebab-case: ${id}`)
  }

  return normalized
}

function buildIdea(args: CreateIdeaArgs): Idea {
  const now = new Date().toISOString()
  const publishBy = args.publishBy.trim()

  if (args.hook.trim().length > 80) {
    throw new Error(`Idea hook must be 80 characters or fewer: ${args.id}`)
  }

  if (Number.isNaN(new Date(publishBy).getTime())) {
    throw new Error(`Invalid publishBy date: ${args.publishBy}`)
  }

  return {
    id: assertKebabCaseId(args.id),
    topic: args.topic.trim(),
    hook: args.hook.trim(),
    audience: args.audience.trim(),
    keyTakeaway: args.keyTakeaway.trim(),
    talkingPoints: args.talkingPoints.map((point) => point.trim()).filter((point) => point.length > 0),
    platforms: normalizePlatforms(args.platforms),
    status: 'draft',
    tags: args.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0),
    trendContext: args.trendContext?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    publishBy,
  }
}

class IdeationAgent extends BaseAgent {
  private readonly brandContext: BrandContext
  private readonly existingIdeas: Idea[]
  private readonly ideasDir?: string
  private readonly targetCount: number
  private generatedIdeas: Idea[] = []
  private finalized = false

  constructor(systemPrompt: string, context: IdeationAgentContext, model?: string) {
    super('IdeationAgent', systemPrompt, getProvider(), model ?? getModelForAgent('IdeationAgent'))
    this.brandContext = context.brandContext
    this.existingIdeas = [...context.existingIdeas]
    this.ideasDir = context.ideasDir
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
        description: 'Return the current idea bank to help avoid duplicate ideas.',
        parameters: {
          type: 'object',
          properties: {},
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('get_past_ideas', args),
      },
      {
        name: 'create_idea',
        description: 'Create a new draft content idea and persist it to the idea bank.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Kebab-case idea identifier' },
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
          required: ['id', 'topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'platforms', 'tags', 'publishBy'],
        },
        handler: async (args: Record<string, unknown>) => this.handleToolCall('create_idea', args),
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
      case 'get_past_ideas': {
        const ideas = await readIdeaBank(this.ideasDir)
        return ideas.map((idea) => ({
          id: idea.id,
          topic: idea.topic,
          status: idea.status,
        }))
      }
      case 'create_idea':
        return this.handleCreateIdea(args)
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

    const createArgs = this.parseCreateIdeaArgs(args)
    const idea = buildIdea(createArgs)
    const duplicateTopic = this.findDuplicateTopic(idea.topic)
    if (duplicateTopic) {
      throw new Error(`Duplicate idea topic detected: ${duplicateTopic}`)
    }

    const duplicateId = this.findDuplicateId(idea.id)
    if (duplicateId) {
      throw new Error(`Duplicate idea ID detected: ${duplicateId}`)
    }

    await writeIdea(idea, this.ideasDir)
    this.generatedIdeas.push(idea)
    logger.info(`[IdeationAgent] Created idea ${idea.id}: ${idea.topic}`)

    return { success: true, idea }
  }

  private parseCreateIdeaArgs(args: Record<string, unknown>): CreateIdeaArgs {
    const { id, topic, hook, audience, keyTakeaway, talkingPoints, platforms, tags, publishBy, trendContext } = args

    if (
      typeof id !== 'string'
      || typeof topic !== 'string'
      || typeof hook !== 'string'
      || typeof audience !== 'string'
      || typeof keyTakeaway !== 'string'
      || !isStringArray(talkingPoints)
      || !isStringArray(platforms)
      || !isStringArray(tags)
      || typeof publishBy !== 'string'
      || (trendContext !== undefined && typeof trendContext !== 'string')
    ) {
      throw new Error('Invalid create_idea arguments')
    }

    return {
      id,
      topic,
      hook,
      audience,
      keyTakeaway,
      talkingPoints,
      platforms,
      tags,
      publishBy,
      trendContext,
    }
  }

  private findDuplicateId(id: string): string | undefined {
    const normalizedId = id.trim().toLowerCase()
    const existing = [...this.existingIdeas, ...this.generatedIdeas]
      .find((idea) => idea.id.trim().toLowerCase() === normalizedId)

    return existing?.id
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
  const existingIdeas = await readIdeaBank(options.ideasDir)
  const systemPrompt = buildSystemPrompt(brandContext, existingIdeas, seedTopics, count)
  const agent = new IdeationAgent(systemPrompt, {
    brandContext,
    existingIdeas,
    ideasDir: options.ideasDir,
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

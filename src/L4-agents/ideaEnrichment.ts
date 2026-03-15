/**
 * Lightweight AI enrichment for manual idea creation.
 *
 * Unlike the full IdeationAgent (agentic loop with MCP + research),
 * this makes a single LLM call to fill in missing idea fields from a topic.
 */

import { getBrandConfig } from '../L1-infra/config/brand.js'
import { getModelForAgent } from '../L1-infra/config/modelConfig.js'
import logger from '../L1-infra/logger/configLogger.js'
import { getProvider } from '../L3-services/llm/providerFactory.js'
import { Platform } from '../L0-pure/types/index.js'
import type { CreateIdeaInput } from '../L0-pure/types/index.js'
import type { BrandConfig } from '../L1-infra/config/brand.js'

const VALID_PLATFORMS = new Set(Object.values(Platform))

const ENRICHMENT_SYSTEM_PROMPT = `You are a content strategist for a tech content creator. Given a topic, generate the missing fields for a content idea.

You MUST respond with a single JSON object matching this exact schema:
{
  "hook": "Attention-grabbing angle, max 80 characters",
  "audience": "Who this content is for",
  "keyTakeaway": "The one thing the viewer should remember",
  "talkingPoints": ["Point 1", "Point 2", "Point 3"],
  "platforms": ["youtube", "tiktok"],
  "tags": ["tag1", "tag2"],
  "publishBy": "YYYY-MM-DD",
  "trendContext": "Why this topic is timely right now"
}

Rules:
- hook MUST be 80 characters or fewer
- platforms must be from: tiktok, youtube, instagram, linkedin, x
- publishBy should be a realistic date: 1-2 weeks for timely topics, 1-3 months for evergreen
- talkingPoints should have 3-5 actionable bullet points
- tags should be 2-4 lowercase single-word or hyphenated tags
- Respond with ONLY the JSON object, no markdown fences, no explanation`

function buildEnrichmentPrompt(
  topic: string,
  prompt?: string,
  brandContext?: BrandConfig,
): string {
  const parts: string[] = [`Topic: "${topic}"`]

  if (prompt) {
    parts.push(`\nAdditional guidance: ${prompt}`)
  }

  if (brandContext) {
    parts.push(`\nBrand context:`)
    parts.push(`- Creator: ${brandContext.name} (${brandContext.handle})`)
    parts.push(`- Tagline: ${brandContext.tagline}`)
    parts.push(`- Voice: ${brandContext.voice.tone}, ${brandContext.voice.personality}`)
    parts.push(`- Focus areas: ${brandContext.advocacy.primary.join(', ')}`)
  }

  parts.push(`\nToday's date: ${new Date().toISOString().split('T')[0]}`)
  parts.push(`\nGenerate the idea fields as JSON.`)

  return parts.join('\n')
}

function parseEnrichmentResponse(content: string): Omit<CreateIdeaInput, 'topic'> {
  const cleaned = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim()

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    throw new Error(`Failed to parse AI enrichment response as JSON: ${cleaned.substring(0, 200)}`)
  }

  const hook = typeof parsed.hook === 'string' ? parsed.hook.substring(0, 80) : ''
  const audience = typeof parsed.audience === 'string' ? parsed.audience : 'developers'
  const keyTakeaway = typeof parsed.keyTakeaway === 'string' ? parsed.keyTakeaway : hook
  const trendContext = typeof parsed.trendContext === 'string' ? parsed.trendContext : undefined

  const talkingPoints = Array.isArray(parsed.talkingPoints)
    ? parsed.talkingPoints.filter((p): p is string => typeof p === 'string')
    : []

  const rawPlatforms = Array.isArray(parsed.platforms) ? parsed.platforms : ['youtube']
  const platforms = rawPlatforms
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.toLowerCase())
    .filter((p) => VALID_PLATFORMS.has(p as Platform))
    .map((p) => p as Platform)

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t): t is string => typeof t === 'string')
    : []

  const publishBy = typeof parsed.publishBy === 'string' ? parsed.publishBy : defaultPublishBy()

  return {
    hook,
    audience,
    keyTakeaway,
    talkingPoints,
    platforms: platforms.length > 0 ? platforms : [Platform.YouTube],
    tags,
    publishBy,
    trendContext,
  }
}

function defaultPublishBy(): string {
  const date = new Date()
  date.setDate(date.getDate() + 14)
  return date.toISOString().split('T')[0]
}

/**
 * Use AI to generate missing idea fields from a topic.
 * Makes a single LLM call — no agent loop, no tools, no MCP.
 */
export async function enrichIdeaInput(
  topic: string,
  prompt?: string,
  brandContext?: BrandConfig,
): Promise<CreateIdeaInput> {
  const provider = getProvider()
  const model = getModelForAgent('IdeaEnrichment')

  const session = await provider.createSession({
    systemPrompt: ENRICHMENT_SYSTEM_PROMPT,
    tools: [],
    model,
  })

  try {
    const brand = brandContext ?? safeGetBrandConfig()
    const userMessage = buildEnrichmentPrompt(topic, prompt, brand)

    logger.info(`[IdeaEnrichment] Enriching idea: "${topic}"`)
    const response = await session.sendAndWait(userMessage)

    const enriched = parseEnrichmentResponse(response.content)
    logger.info(`[IdeaEnrichment] Enrichment complete — hook: "${enriched.hook}"`)

    return {
      topic,
      ...enriched,
    }
  } finally {
    await session.close()
  }
}

function safeGetBrandConfig(): BrandConfig | undefined {
  try {
    return getBrandConfig()
  } catch {
    return undefined
  }
}

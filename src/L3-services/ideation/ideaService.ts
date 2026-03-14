import type { Idea, IdeaPublishRecord, Transcript } from '../../L0-pure/types/index.js'
import { getModelForAgent } from '../../L1-infra/config/modelConfig.js'
import logger from '../../L1-infra/logger/configLogger.js'
import {
  getIdea as getGitHubIdea,
  getReadyIdeas as getGitHubReadyIdeas,
  listIdeas as listGitHubIdeas,
  markPublished as markGitHubIdeaPublished,
  markRecorded as markGitHubIdeaRecorded,
} from '../ideaService/ideaService.js'
import { getProvider } from '../llm/providerFactory.js'

const IDEA_MATCH_AGENT_NAME = 'IdeaService'
const IDEA_MATCH_LIMIT = 3
const TRANSCRIPT_SUMMARY_LIMIT = 500
const MATCH_IDEAS_SYSTEM_PROMPT = 'You are a content matching assistant. Given a video transcript summary and a list of content ideas, identify which ideas (if any) the video covers. Return a JSON array of matching idea IDs, ordered by relevance. Return empty array if no ideas match. Only return ideas where the video clearly covers the topic.'

interface IdeaSummary {
  id: string
  topic: string
  hook: string
  keyTakeaway: string
}

function normalizeIdeaIdentifier(id: string): string {
  return id.trim()
}

function buildIdeaLookup(ideas: readonly Idea[]): Map<string, Idea> {
  const lookup = new Map<string, Idea>()
  for (const idea of ideas) {
    lookup.set(idea.id, idea)
    lookup.set(String(idea.issueNumber), idea)
  }
  return lookup
}

async function resolveIdeaByIdentifier(id: string, ideas?: readonly Idea[]): Promise<Idea | null> {
  const normalizedId = normalizeIdeaIdentifier(id)
  if (!normalizedId) {
    return null
  }

  const issueNumber = Number.parseInt(normalizedId, 10)
  if (Number.isInteger(issueNumber)) {
    const idea = await getGitHubIdea(issueNumber)
    if (idea) {
      return idea
    }
  }

  const availableIdeas = ideas ?? await listGitHubIdeas()
  return buildIdeaLookup(availableIdeas).get(normalizedId) ?? null
}

/**
 * Resolve idea IDs to full Idea objects.
 * Throws if any ID is not found.
 */
export async function getIdeasByIds(ids: string[], _dir?: string): Promise<Idea[]> {
  const ideas = await listGitHubIdeas()
  const lookup = buildIdeaLookup(ideas)

  return ids.map((id) => {
    const normalizedId = normalizeIdeaIdentifier(id)
    const idea = lookup.get(normalizedId)
    if (!idea) {
      throw new Error(`Idea not found: ${id}`)
    }
    return idea
  })
}

/**
 * Return all ideas with status 'ready'.
 */
export async function getReadyIdeas(_dir?: string): Promise<Idea[]> {
  return getGitHubReadyIdeas()
}

/**
 * Update idea status to 'recorded' and link to video slug.
 * Sets sourceVideoSlug and updates status.
 */
export async function markRecorded(id: string, videoSlug: string, _dir?: string): Promise<void> {
  const idea = await resolveIdeaByIdentifier(id)
  if (!idea) {
    throw new Error(`Idea not found: ${id}`)
  }

  await markGitHubIdeaRecorded(idea.issueNumber, videoSlug)
}

/**
 * Append a publish record to the idea and transition status to 'published'.
 * The idea transitions to 'published' on first publish record.
 */
export async function markPublished(id: string, record: IdeaPublishRecord, _dir?: string): Promise<void> {
  const idea = await resolveIdeaByIdentifier(id)
  if (!idea) {
    throw new Error(`Idea not found: ${id}`)
  }

  await markGitHubIdeaPublished(idea.issueNumber, record)
}

/**
 * Auto-match ideas to a transcript using LLM.
 * Sends transcript summary + idea bank to LLM, returns top 1-3 matching ideas.
 * Returns empty array if no ideas match or if matching fails.
 * Only considers ideas with status 'ready'.
 */
export async function matchIdeasToTranscript(
  transcript: Transcript,
  ideas?: Idea[],
  _dir?: string,
): Promise<Idea[]> {
  try {
    const readyIdeas = (ideas ?? await getGitHubReadyIdeas()).filter((idea) => idea.status === 'ready')
    if (readyIdeas.length === 0) {
      return []
    }

    const provider = getProvider()
    if (!provider.isAvailable()) {
      logger.warn('[IdeaService] LLM provider unavailable for idea matching')
      return []
    }

    const transcriptSummary = transcript.text.slice(0, TRANSCRIPT_SUMMARY_LIMIT).trim()
    const readyIdeaIds = new Set(readyIdeas.map((idea) => idea.id))
    const readyIdeasById = new Map(readyIdeas.map((idea) => [idea.id, idea]))
    const ideaSummaries = readyIdeas.map<IdeaSummary>((idea) => ({
      id: idea.id,
      topic: idea.topic,
      hook: idea.hook,
      keyTakeaway: idea.keyTakeaway,
    }))
    const knownIdeaIds = readyIdeaIds

    const session = await provider.createSession({
      systemPrompt: MATCH_IDEAS_SYSTEM_PROMPT,
      tools: [],
      streaming: false,
      model: getModelForAgent(IDEA_MATCH_AGENT_NAME),
    })

    try {
      const response = await session.sendAndWait(buildIdeaMatchPrompt(transcriptSummary, ideaSummaries))
      const matchedIds = parseMatchedIdeaIds(response.content, knownIdeaIds)
        .filter((id) => readyIdeaIds.has(id))
        .slice(0, IDEA_MATCH_LIMIT)

      if (matchedIds.length === 0) {
        return []
      }

      if (ideas) {
        return matchedIds.flatMap((id) => {
          const matchedIdea = readyIdeasById.get(id)
          return matchedIdea ? [matchedIdea] : []
        })
      }

      return await getIdeasByIds(matchedIds)
    } finally {
      await session.close().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`[IdeaService] Failed to close idea matching session: ${message}`)
      })
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`[IdeaService] Failed to match ideas to transcript: ${message}`)
    return []
  }
}

function buildIdeaMatchPrompt(transcriptSummary: string, ideas: IdeaSummary[]): string {
  return [
    'Transcript summary:',
    transcriptSummary || '(empty transcript)',
    '',
    'Ideas:',
    JSON.stringify(ideas, null, 2),
    '',
    `Return up to ${IDEA_MATCH_LIMIT} idea IDs as a JSON array.`,
  ].join('\n')
}

function parseMatchedIdeaIds(rawContent: string, knownIdeaIds: ReadonlySet<string>): string[] {
  const parsed = JSON.parse(rawContent) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Idea match response was not a JSON array')
  }

  const matchedIds = parsed.filter((value): value is string => typeof value === 'string')
  return Array.from(new Set(matchedIds.filter((id) => knownIdeaIds.has(id))))
}

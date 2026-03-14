import type { Idea, IdeaPublishRecord, Transcript } from '../../L0-pure/types/index.js'
import { getModelForAgent } from '../../L1-infra/config/modelConfig.js'
import { readIdeaBank, writeIdea, readIdea, listIdeaIds } from '../../L1-infra/ideaStore/ideaStore.js'
import logger from '../../L1-infra/logger/configLogger.js'
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

/**
 * Resolve idea IDs to full Idea objects.
 * Throws if any ID is not found.
 */
export async function getIdeasByIds(ids: string[], dir?: string): Promise<Idea[]> {
  return Promise.all(
    ids.map(async (id) => {
      const idea = await readIdea(id, dir)
      if (!idea) {
        throw new Error(`Idea not found: ${id}`)
      }
      return idea
    }),
  )
}

/**
 * Return all ideas with status 'ready'.
 */
export async function getReadyIdeas(dir?: string): Promise<Idea[]> {
  const ideas = await readIdeaBank(dir)
  return ideas.filter((idea) => idea.status === 'ready')
}

/**
 * Update idea status to 'recorded' and link to video slug.
 * Sets sourceVideoSlug and updates status.
 */
export async function markRecorded(id: string, videoSlug: string, dir?: string): Promise<void> {
  const idea = await readIdea(id, dir)
  if (!idea) {
    throw new Error(`Idea not found: ${id}`)
  }

  idea.status = 'recorded'
  idea.sourceVideoSlug = videoSlug
  await writeIdea(idea, dir)
}

/**
 * Append a publish record to the idea and transition status to 'published'.
 * The idea transitions to 'published' on first publish record.
 */
export async function markPublished(id: string, record: IdeaPublishRecord, dir?: string): Promise<void> {
  const idea = await readIdea(id, dir)
  if (!idea) {
    throw new Error(`Idea not found: ${id}`)
  }

  idea.publishedContent = [...(idea.publishedContent ?? []), record]
  idea.status = 'published'
  await writeIdea(idea, dir)
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
  dir?: string,
): Promise<Idea[]> {
  try {
    const readyIdeas = (ideas ?? await readIdeaBank(dir)).filter((idea) => idea.status === 'ready')
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
    const knownIdeaIds = new Set(
      ideas ? readyIdeaIds : await listIdeaIds(dir),
    )

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

      return await getIdeasByIds(matchedIds, dir)
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

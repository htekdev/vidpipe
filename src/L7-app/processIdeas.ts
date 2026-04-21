import logger from '../L1-infra/logger/configLogger.js'
import type { Idea } from '../L0-pure/types/index.js'

export interface IdeaServiceModule {
  getIdeasByIds(ids: string[]): Promise<Idea[]>
  markRecorded(issueNumber: number, slug: string): Promise<void>
}

type IdeaServiceLoader = () => Promise<IdeaServiceModule>

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|avi|mkv)$/i

export async function resolveIdeas(rawIdeaIds: string, loadIdeaServiceImpl: IdeaServiceLoader = loadIdeaService): Promise<Idea[]> {
  const { getIdeasByIds } = await loadIdeaServiceImpl()
  const ideaIds = rawIdeaIds.split(',').map((id) => id.trim()).filter(Boolean)
  const ideas = await getIdeasByIds(ideaIds)
  const ideaTitles = ideas.map((idea) => idea.topic).filter(Boolean).join(', ')

  logger.info(ideaTitles ? `Linked ${ideas.length} idea(s): ${ideaTitles}` : `Linked ${ideas.length} idea(s)`)
  return ideas
}

export async function markIdeasRecorded(
  ideas: readonly Idea[],
  videoPath: string,
  loadIdeaServiceImpl: IdeaServiceLoader = loadIdeaService,
): Promise<void> {
  if (ideas.length === 0) {
    return
  }

  const slug = videoPath.replace(/\\/g, '/').split('/').pop()?.replace(VIDEO_EXTENSION_PATTERN, '') ?? ''
  if (!slug) {
    throw new Error(`Could not derive video slug from path: ${videoPath}`)
  }

  const { markRecorded } = await loadIdeaServiceImpl()
  for (const idea of ideas) {
    await markRecorded(idea.issueNumber, slug)
  }

  logger.info(`Marked ${ideas.length} idea(s) as recorded`)
}

async function loadIdeaService(): Promise<IdeaServiceModule> {
  const [lookupModule, ideaServiceModule] = await Promise.all([
    import('../L3-services/ideation/ideaService.js'),
    import('../L3-services/ideaService/ideaService.js'),
  ])

  return {
    getIdeasByIds: lookupModule.getIdeasByIds,
    markRecorded: ideaServiceModule.markRecorded,
  }
}

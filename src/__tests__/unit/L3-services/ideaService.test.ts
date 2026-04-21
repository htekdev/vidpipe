import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Platform, type Idea } from '../../../L0-pure/types/index.js'

const mockListIdeas = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockMarkRecorded = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  getIdea: mockGetIdea,
  getReadyIdeas: vi.fn(),
  markRecorded: mockMarkRecorded,
  markPublished: vi.fn(),
}))

import { getIdeasByIds, markRecorded as markIdeaRecorded } from '../../../L3-services/ideation/ideaService.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  const issueNumber = overrides.issueNumber ?? 1
  return {
    issueNumber,
    issueUrl: overrides.issueUrl ?? `https://github.com/htekdev/content-management/issues/${issueNumber}`,
    repoFullName: overrides.repoFullName ?? 'htekdev/content-management',
    id: overrides.id ?? `idea-${issueNumber}`,
    topic: overrides.topic ?? 'First idea',
    hook: overrides.hook ?? 'Open with the useful outcome',
    audience: overrides.audience ?? 'Developers learning from build videos',
    keyTakeaway: overrides.keyTakeaway ?? 'Lead with value, then explain the process.',
    talkingPoints: overrides.talkingPoints ?? ['State the payoff', 'Walk through the implementation'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['education'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishBy: overrides.publishBy ?? '2026-04-01',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

describe('ideaService compatibility wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ideas in the requested order and supports numeric identifiers', async () => {
    const ideas: Idea[] = [
      createIdea({ issueNumber: 101, id: 'idea-101', topic: 'First idea', status: 'draft' }),
      createIdea({ issueNumber: 202, id: 'idea-202', topic: 'Second idea', status: 'ready' }),
    ]
    mockListIdeas.mockResolvedValue(ideas)

    await expect(getIdeasByIds(['202', 'idea-101'])).resolves.toEqual([ideas[1], ideas[0]])
  })

  it('throws when any requested idea id is missing', async () => {
    mockListIdeas.mockResolvedValue([createIdea({ issueNumber: 101, id: 'idea-101' })])

    await expect(getIdeasByIds(['idea-101', 'idea-999'])).rejects.toThrow('Idea not found: idea-999')
  })

  it('marks ideas as recorded using their GitHub issue number', async () => {
    const idea = createIdea({ issueNumber: 42, id: 'idea-legacy-42', topic: 'First idea', status: 'ready' })
    mockListIdeas.mockResolvedValue([idea])

    await markIdeaRecorded('idea-legacy-42', 'session-42')

    expect(mockMarkRecorded).toHaveBeenCalledWith(42, 'session-42')
  })

  it('supports direct numeric issue identifiers when marking recorded ideas', async () => {
    mockGetIdea.mockResolvedValue(createIdea({ issueNumber: 77, id: 'idea-77' }))

    await markIdeaRecorded('77', 'session-77')

    expect(mockGetIdea).toHaveBeenCalledWith(77)
    expect(mockMarkRecorded).toHaveBeenCalledWith(77, 'session-77')
  })
})

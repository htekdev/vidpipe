import { afterEach, describe, expect, it, vi } from 'vitest'
import { Platform, type Idea } from '../../../L0-pure/types/index.js'
import type { IdeaServiceModule } from '../../../L7-app/processIdeas.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: overrides.id ?? 'idea-1',
    topic: overrides.topic ?? 'Lead with the payoff',
    hook: overrides.hook ?? 'Start with the strongest result',
    audience: overrides.audience ?? 'Developers shipping product demos',
    keyTakeaway: overrides.keyTakeaway ?? 'Show the outcome before the implementation details.',
    talkingPoints: overrides.talkingPoints ?? ['Open with the payoff', 'Explain the implementation'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'ready',
    tags: overrides.tags ?? ['demo'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishBy: overrides.publishBy ?? '2026-04-01',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: mockLogger,
}))

const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockMarkRecorded = vi.hoisted(() => vi.fn())

import { markIdeasRecorded, resolveIdeas } from '../../../L7-app/processIdeas.js'

describe('resolveIdeas', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('trims comma-separated idea ids before resolving them', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-1', topic: 'Lead with the payoff' }),
      createIdea({ id: 'idea-2', topic: 'Teach through the build' }),
    ]
    mockGetIdeasByIds.mockResolvedValue(ideas)

    const loadIdeaService = async (): Promise<IdeaServiceModule> => ({
      getIdeasByIds: mockGetIdeasByIds,
      markRecorded: mockMarkRecorded,
    })

    await expect(resolveIdeas(' idea-1, idea-2 , ,', loadIdeaService)).resolves.toEqual(ideas)

    expect(mockGetIdeasByIds).toHaveBeenCalledWith(['idea-1', 'idea-2'])
    expect(mockLogger.info).toHaveBeenCalledWith('Linked 2 idea(s): Lead with the payoff, Teach through the build')
  })
})

describe('markIdeasRecorded', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks each idea recorded using the video slug derived from the file path', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-1', topic: 'Lead with the payoff' }),
      createIdea({ id: 'idea-2', topic: 'Teach through the build' }),
    ]

    const loadIdeaService = async (): Promise<IdeaServiceModule> => ({
      getIdeasByIds: mockGetIdeasByIds,
      markRecorded: mockMarkRecorded,
    })

    await markIdeasRecorded(ideas, 'C:\\videos\\session-42.mp4', loadIdeaService)

    expect(mockMarkRecorded).toHaveBeenNthCalledWith(1, 'idea-1', 'session-42')
    expect(mockMarkRecorded).toHaveBeenNthCalledWith(2, 'idea-2', 'session-42')
    expect(mockLogger.info).toHaveBeenCalledWith('Marked 2 idea(s) as recorded')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Platform, type Idea } from '../../../L0-pure/types/index.js'
import type { IdeaServiceModule } from '../../../L7-app/processIdeas.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: overrides.issueNumber ?? 1,
    issueUrl: overrides.issueUrl ?? 'https://github.com/htekdev/content-management/issues/1',
    repoFullName: overrides.repoFullName ?? 'htekdev/content-management',
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
const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockMarkRecorded = vi.hoisted(() => vi.fn())
const mockDynamicGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockDynamicMarkRecorded = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: mockLogger,
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockDynamicGetIdeasByIds,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  markRecorded: mockDynamicMarkRecorded,
}))

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

  it('loads the L3 lookup service when no override is provided', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-3', topic: 'Ship the workflow' }),
      createIdea({ id: 'idea-4', topic: 'Explain the handoff' }),
    ]
    mockDynamicGetIdeasByIds.mockResolvedValue(ideas)

    await expect(resolveIdeas(' idea-3, idea-4 ')).resolves.toEqual(ideas)

    expect(mockDynamicGetIdeasByIds).toHaveBeenCalledWith(['idea-3', 'idea-4'])
    expect(mockLogger.info).toHaveBeenCalledWith('Linked 2 idea(s): Ship the workflow, Explain the handoff')
  })
})

describe('markIdeasRecorded', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('marks each idea recorded using the video slug derived from the file path', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-1', issueNumber: 101, topic: 'Lead with the payoff' }),
      createIdea({ id: 'idea-2', issueNumber: 202, topic: 'Teach through the build' }),
    ]

    const loadIdeaService = async (): Promise<IdeaServiceModule> => ({
      getIdeasByIds: mockGetIdeasByIds,
      markRecorded: mockMarkRecorded,
    })

    await markIdeasRecorded(ideas, 'C:\\videos\\session-42.mp4', loadIdeaService)

    expect(mockMarkRecorded).toHaveBeenNthCalledWith(1, 101, 'session-42')
    expect(mockMarkRecorded).toHaveBeenNthCalledWith(2, 202, 'session-42')
    expect(mockLogger.info).toHaveBeenCalledWith('Marked 2 idea(s) as recorded')
  })

  it('loads the L3 recorder service when no override is provided', async () => {
    const ideas: Idea[] = [
      createIdea({ id: 'idea-5', issueNumber: 303, topic: 'Narrate the output' }),
      createIdea({ id: 'idea-6', issueNumber: 404, topic: 'Attach context to clips' }),
    ]

    await markIdeasRecorded(ideas, 'C:\\videos\\session-99.mp4')

    expect(mockDynamicMarkRecorded).toHaveBeenNthCalledWith(1, 303, 'session-99')
    expect(mockDynamicMarkRecorded).toHaveBeenNthCalledWith(2, 404, 'session-99')
    expect(mockLogger.info).toHaveBeenCalledWith('Marked 2 idea(s) as recorded')
  })
})

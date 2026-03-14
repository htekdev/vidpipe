import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Platform, type Idea, type IdeaPublishRecord, type Transcript } from '../../../L0-pure/types/index.js'

const mockSendAndWait = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCreateSession = vi.hoisted(() => vi.fn())
const mockIsAvailable = vi.hoisted(() => vi.fn())
const mockListIdeas = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockGetReadyIdeasFromGithub = vi.hoisted(() => vi.fn())
const mockMarkRecordedGithub = vi.hoisted(() => vi.fn())
const mockMarkPublishedGithub = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/llm/providerFactory.js', () => ({
  getProvider: () => ({
    name: 'copilot',
    createSession: mockCreateSession,
    isAvailable: mockIsAvailable,
    getDefaultModel: () => 'mock-model',
  }),
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  getIdea: mockGetIdea,
  getReadyIdeas: mockGetReadyIdeasFromGithub,
  markRecorded: mockMarkRecordedGithub,
  markPublished: mockMarkPublishedGithub,
}))

import {
  getIdeasByIds,
  getReadyIdeas,
  markPublished,
  markRecorded,
  matchIdeasToTranscript,
} from '../../../L3-services/ideation/ideaService.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  const issueNumber = overrides.issueNumber ?? 1
  return {
    issueNumber,
    issueUrl: overrides.issueUrl ?? `https://github.com/htekdev/content-management/issues/${issueNumber}`,
    repoFullName: overrides.repoFullName ?? 'htekdev/content-management',
    id: overrides.id ?? `idea-${issueNumber}`,
    topic: overrides.topic ?? 'Debugging GitHub Copilot workflows',
    hook: overrides.hook ?? 'The hidden reason your agent loop keeps failing',
    audience: overrides.audience ?? 'Developers using AI coding tools',
    keyTakeaway: overrides.keyTakeaway ?? 'Tight feedback loops make agent workflows reliable',
    talkingPoints: overrides.talkingPoints ?? ['Explain the failure mode', 'Show the fix'],
    platforms: overrides.platforms ?? [Platform.YouTube, Platform.LinkedIn],
    status: overrides.status ?? 'ready',
    tags: overrides.tags ?? ['copilot', 'debugging'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
    publishBy: overrides.publishBy ?? '2026-04-01',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

function createTranscript(text: string): Transcript {
  return {
    text,
    segments: [],
    words: [],
    language: 'en',
    duration: 120,
  }
}

describe('ideaService compatibility wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsAvailable.mockReturnValue(true)
    mockCreateSession.mockResolvedValue({
      sendAndWait: mockSendAndWait,
      on: vi.fn(),
      close: mockClose,
    })
    mockSendAndWait.mockResolvedValue({
      content: '[]',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
  })

  it('getIdeasByIds resolves ideas by legacy id and issue number', async () => {
    const first = createIdea({ issueNumber: 11, id: 'idea-first', topic: 'First idea' })
    const second = createIdea({ issueNumber: 22, id: 'idea-second', topic: 'Second idea' })
    mockListIdeas.mockResolvedValue([first, second])

    await expect(getIdeasByIds(['22', 'idea-first'])).resolves.toMatchObject([
      { id: 'idea-second', topic: 'Second idea' },
      { id: 'idea-first', topic: 'First idea' },
    ])
  })

  it('getReadyIdeas delegates to the GitHub-backed service', async () => {
    mockGetReadyIdeasFromGithub.mockResolvedValue([createIdea({ issueNumber: 9, id: 'idea-ready', status: 'ready' })])

    await expect(getReadyIdeas()).resolves.toMatchObject([{ id: 'idea-ready', status: 'ready' }])
  })

  it('markRecorded and markPublished resolve legacy identifiers to issue numbers', async () => {
    const idea = createIdea({ issueNumber: 33, id: 'idea-record-me', status: 'recorded' })
    const publishRecord: IdeaPublishRecord = {
      clipType: 'video',
      platform: Platform.YouTube,
      queueItemId: 'queue-1',
      publishedAt: '2026-02-10T10:00:00.000Z',
      latePostId: 'late-1',
      lateUrl: 'https://example.com/video-1',
    }
    mockListIdeas.mockResolvedValue([idea])

    await markRecorded('idea-record-me', 'video-debug-loop')
    await markPublished('idea-record-me', publishRecord)

    expect(mockMarkRecordedGithub).toHaveBeenCalledWith(33, 'video-debug-loop')
    expect(mockMarkPublishedGithub).toHaveBeenCalledWith(33, publishRecord)
  })

  it('matchIdeasToTranscript returns matched ready ideas from the LLM response', async () => {
    const readyIdea = createIdea({ issueNumber: 101, id: 'idea-agent-loop', topic: 'Fixing agent retry loops' })
    const secondReadyIdea = createIdea({ issueNumber: 102, id: 'idea-better-prompts', topic: 'Writing better prompts' })
    mockGetReadyIdeasFromGithub.mockResolvedValue([readyIdea, secondReadyIdea])
    mockListIdeas.mockResolvedValue([readyIdea, secondReadyIdea])
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify(['idea-better-prompts', 'idea-agent-loop', 'idea-better-prompts']),
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
    })

    const matches = await matchIdeasToTranscript(
      createTranscript('This video explains how structured prompts and diagnostics improve AI agent retries.'),
    )

    expect(matches).toMatchObject([
      { id: 'idea-better-prompts' },
      { id: 'idea-agent-loop' },
    ])
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({
      systemPrompt: expect.stringContaining('content matching assistant'),
      tools: [],
      streaming: false,
    }))
    expect(mockSendAndWait).toHaveBeenCalledWith(expect.stringContaining('Transcript summary:'))
  })

  it('matchIdeasToTranscript fails closed when there are no ready ideas, the provider is unavailable, or parsing fails', async () => {
    mockGetReadyIdeasFromGithub.mockResolvedValue([])
    await expect(matchIdeasToTranscript(createTranscript('No ideas yet'))).resolves.toEqual([])

    const readyIdea = createIdea({ issueNumber: 88, id: 'idea-provider-check' })
    mockGetReadyIdeasFromGithub.mockResolvedValue([readyIdea])
    mockListIdeas.mockResolvedValue([readyIdea])
    mockIsAvailable.mockReturnValue(false)
    await expect(matchIdeasToTranscript(createTranscript('Provider unavailable'))).resolves.toEqual([])

    mockIsAvailable.mockReturnValue(true)
    mockSendAndWait.mockResolvedValue({
      content: '{not-json',
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    await expect(matchIdeasToTranscript(createTranscript('Broken response'))).resolves.toEqual([])
  })
})

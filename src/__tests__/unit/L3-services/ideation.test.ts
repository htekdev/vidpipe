import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { writeIdea, readIdea } from '../../../L1-infra/ideaStore/ideaStore.js'
import { Platform, type Idea, type Transcript } from '../../../L0-pure/types/index.js'

const mockSendAndWait = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockCreateSession = vi.hoisted(() => vi.fn())
const mockIsAvailable = vi.hoisted(() => vi.fn())
const mockGetDefaultModel = vi.hoisted(() => vi.fn(() => 'mock-model'))

vi.mock('../../../L2-clients/llm/index.js', () => ({
  getProvider: vi.fn(() => ({
    name: 'copilot',
    createSession: mockCreateSession,
    isAvailable: mockIsAvailable,
    getDefaultModel: mockGetDefaultModel,
  })),
  resetProvider: vi.fn(),
  getProviderName: vi.fn(() => 'copilot'),
}))

import {
  getIdeasByIds,
  getReadyIdeas,
  markPublished,
  markRecorded,
  matchIdeasToTranscript,
} from '../../../L3-services/ideation/ideaService.js'

function createIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: overrides.id ?? 'idea-debugging-workflows',
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

async function makeIdeasDir(): Promise<string> {
  return mkdtemp(join(os.tmpdir(), 'vidpipe-idea-service-'))
}

describe('ideaService', () => {
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

  describe('REQ-001: getIdeasByIds resolves ideas by ID and throws when an idea is missing', () => {
    it('ideaService.REQ-001 - returns ideas in input order and throws for missing IDs', async () => {
      const dir = await makeIdeasDir()
      try {
        const first = createIdea({ id: 'idea-first', topic: 'First idea' })
        const second = createIdea({ id: 'idea-second', topic: 'Second idea' })
        await writeIdea(first, dir)
        await writeIdea(second, dir)

        await expect(getIdeasByIds(['idea-second', 'idea-first'], dir)).resolves.toMatchObject([
          { id: 'idea-second', topic: 'Second idea' },
          { id: 'idea-first', topic: 'First idea' },
        ])
        await expect(getIdeasByIds(['missing-idea'], dir)).rejects.toThrow('Idea not found: missing-idea')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('REQ-002: getReadyIdeas returns only ready ideas', () => {
    it('ideaService.REQ-002 - filters out non-ready ideas', async () => {
      const dir = await makeIdeasDir()
      try {
        await writeIdea(createIdea({ id: 'idea-ready', status: 'ready' }), dir)
        await writeIdea(createIdea({ id: 'idea-draft', status: 'draft' }), dir)
        await writeIdea(createIdea({ id: 'idea-recorded', status: 'recorded' }), dir)

        await expect(getReadyIdeas(dir)).resolves.toMatchObject([{ id: 'idea-ready', status: 'ready' }])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('REQ-003: markRecorded persists recorded status and sourceVideoSlug', () => {
    it('ideaService.REQ-003 - updates the idea lifecycle to recorded', async () => {
      const dir = await makeIdeasDir()
      try {
        await writeIdea(createIdea({ id: 'idea-record-me', status: 'ready' }), dir)

        await markRecorded('idea-record-me', 'video-debug-loop', dir)

        await expect(readIdea('idea-record-me', dir)).resolves.toMatchObject({
          id: 'idea-record-me',
          status: 'recorded',
          sourceVideoSlug: 'video-debug-loop',
        })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('REQ-004: markPublished appends publish history and publishes the idea', () => {
    it('ideaService.REQ-004 - initializes publishedContent and appends new records', async () => {
      const dir = await makeIdeasDir()
      try {
        await writeIdea(createIdea({ id: 'idea-publish-me', status: 'recorded' }), dir)

        await markPublished('idea-publish-me', {
          clipType: 'video',
          platform: Platform.YouTube,
          queueItemId: 'queue-1',
          publishedAt: '2026-02-10T10:00:00.000Z',
          publishedUrl: 'https://example.com/video-1',
        }, dir)
        await markPublished('idea-publish-me', {
          clipType: 'short',
          platform: Platform.TikTok,
          queueItemId: 'queue-2',
          publishedAt: '2026-02-11T10:00:00.000Z',
        }, dir)

        await expect(readIdea('idea-publish-me', dir)).resolves.toMatchObject({
          id: 'idea-publish-me',
          status: 'published',
          publishedContent: [
            { queueItemId: 'queue-1', platform: Platform.YouTube },
            { queueItemId: 'queue-2', platform: Platform.TikTok },
          ],
        })
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('REQ-005: matchIdeasToTranscript returns matched ready ideas from the LLM response', () => {
    it('ideaService.REQ-005 - loads ready ideas, calls the provider, and returns up to three persisted matches', async () => {
      const dir = await makeIdeasDir()
      try {
        const readyIdea = createIdea({
          id: 'idea-agent-loop',
          topic: 'Fixing agent retry loops',
          keyTakeaway: 'Reliable retries need structured diagnostics',
        })
        const secondReadyIdea = createIdea({
          id: 'idea-better-prompts',
          topic: 'Writing better prompts',
          keyTakeaway: 'Structured prompts produce more reliable outputs',
        })
        const draftIdea = createIdea({ id: 'idea-draft', status: 'draft' })
        await writeIdea(readyIdea, dir)
        await writeIdea(secondReadyIdea, dir)
        await writeIdea(draftIdea, dir)

        mockSendAndWait.mockResolvedValue({
          content: JSON.stringify(['idea-better-prompts', 'idea-draft', 'idea-agent-loop', 'idea-better-prompts']),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        })

        const matches = await matchIdeasToTranscript(
          createTranscript('This video explains how structured prompts and diagnostics improve AI agent retries.'),
          undefined,
          dir,
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
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  describe('REQ-006: matchIdeasToTranscript fails closed and returns an empty array', () => {
    it('ideaService.REQ-006 - returns an empty array when there are no ready ideas, the provider is unavailable, or parsing fails', async () => {
      const dir = await makeIdeasDir()
      try {
        await expect(matchIdeasToTranscript(createTranscript('No ideas yet'), [], dir)).resolves.toEqual([])

        await writeIdea(createIdea({ id: 'idea-provider-check' }), dir)
        mockIsAvailable.mockReturnValue(false)
        await expect(matchIdeasToTranscript(createTranscript('Provider unavailable'), undefined, dir)).resolves.toEqual([])

        mockIsAvailable.mockReturnValue(true)
        mockSendAndWait.mockResolvedValue({
          content: '{not-json',
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        })
        await expect(matchIdeasToTranscript(createTranscript('Broken response'), undefined, dir)).resolves.toEqual([])
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })
})

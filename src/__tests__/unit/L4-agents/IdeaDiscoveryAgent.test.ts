import { beforeEach, describe, expect, test, vi } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'
import type { Idea, ShortClip, MediumClip, Segment } from '../../../L0-pure/types/index.js'
import type { DiscoverIdeasInput } from '../../../L4-agents/IdeaDiscoveryAgent.js'

// --- Hoisted mock variables ---

const mockState = vi.hoisted(() => ({
  tools: [] as Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    handler: (args: Record<string, unknown>) => Promise<unknown>
  }>,
  systemPrompt: '',
}))

const mockListIdeas = vi.hoisted(() => vi.fn())
const mockCreateIdea = vi.hoisted(() => vi.fn())

// --- L3 mocks ---

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  createIdea: mockCreateIdea,
}))

vi.mock('../../../L3-services/llm/providerFactory.js', () => ({
  getProvider: () => ({
    name: 'copilot',
    isAvailable: () => true,
    getDefaultModel: () => 'mock-model',
    createSession: async (config: {
      systemPrompt: string
      tools: typeof mockState.tools
    }) => {
      mockState.systemPrompt = config.systemPrompt
      mockState.tools = config.tools
      return {
        on: vi.fn(),
        close: vi.fn(),
        sendAndWait: vi.fn().mockResolvedValue({
          content: 'Done.',
          usage: { promptTokens: 100, completionTokens: 50 },
          cost: { model: 'mock-model' },
        }),
      }
    },
  }),
}))

vi.mock('../../../L3-services/llm/index.js', () => ({
  getProvider: () => ({
    name: 'copilot',
    isAvailable: () => true,
    getDefaultModel: () => 'mock-model',
    createSession: async (config: {
      systemPrompt: string
      tools: typeof mockState.tools
    }) => {
      mockState.systemPrompt = config.systemPrompt
      mockState.tools = config.tools
      return {
        on: vi.fn(),
        close: vi.fn(),
        sendAndWait: vi.fn().mockResolvedValue({
          content: 'Done.',
          usage: { promptTokens: 100, completionTokens: 50 },
          cost: { model: 'mock-model' },
        }),
      }
    },
  }),
}))

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: {
    recordCall: vi.fn(),
    recordServiceUsage: vi.fn(),
    recordUsage: vi.fn(),
    setAgent: vi.fn(),
    clearAgent: vi.fn(),
  },
}))

import { IdeaDiscoveryAgent } from '../../../L4-agents/IdeaDiscoveryAgent.js'

const EXPECTED_TOOLS = [
  'get_clip_transcript',
  'assign_idea_to_clip',
  'create_idea_for_clip',
  'finalize_assignments',
]

// --- Fixtures ---

function makeShort(overrides: Partial<ShortClip> = {}): ShortClip {
  return {
    id: 'short-1',
    title: 'Test Short',
    slug: 'test-short',
    segments: [{ start: 0, end: 15, description: 'intro' }],
    totalDuration: 15,
    outputPath: '/out/short-1.mp4',
    description: 'A test short clip',
    tags: ['test', 'demo'],
    ...overrides,
  }
}

function makeMedium(overrides: Partial<MediumClip> = {}): MediumClip {
  return {
    id: 'medium-1',
    title: 'Test Medium',
    slug: 'test-medium',
    segments: [{ start: 30, end: 120, description: 'main content' }],
    totalDuration: 90,
    outputPath: '/out/medium-1.mp4',
    description: 'A test medium clip',
    tags: ['tutorial'],
    hook: 'Learn this trick',
    topic: 'TypeScript generics',
    ...overrides,
  }
}

function makeTranscript(): Segment[] {
  return [
    { id: 1, text: 'Hello and welcome.', start: 0, end: 5, words: [] },
    { id: 2, text: 'Today we talk about TypeScript.', start: 5, end: 12, words: [] },
    { id: 3, text: 'Generics are powerful.', start: 12, end: 18, words: [] },
    { id: 4, text: 'Some filler content here.', start: 20, end: 28, words: [] },
    { id: 5, text: 'Lets dive into generics.', start: 30, end: 40, words: [] },
    { id: 6, text: 'Use T for type parameters.', start: 40, end: 55, words: [] },
    { id: 7, text: 'Constraints make them safe.', start: 55, end: 70, words: [] },
    { id: 8, text: 'Mapped types are next level.', start: 80, end: 95, words: [] },
    { id: 9, text: 'Thanks for watching.', start: 110, end: 120, words: [] },
  ]
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: 42,
    issueUrl: 'https://github.com/test/repo/issues/42',
    repoFullName: 'test/repo',
    id: 'idea-42',
    topic: 'TypeScript Generics',
    hook: 'Master generics in 5 minutes',
    audience: 'intermediate developers',
    keyTakeaway: 'Generics enable reusable type-safe code',
    talkingPoints: ['Type parameters', 'Constraints', 'Mapped types'],
    platforms: [Platform.YouTube],
    status: 'ready',
    tags: ['typescript', 'generics'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    publishBy: '2026-03-01',
    ...overrides,
  }
}

function createMinimalInput(overrides: Partial<DiscoverIdeasInput> = {}): DiscoverIdeasInput {
  return {
    shorts: [],
    mediumClips: [],
    transcript: [],
    summary: 'Test summary',
    publishBy: '2026-03-01',
    defaultPlatforms: [Platform.YouTube],
    ...overrides,
  }
}

function createInputWithClips(overrides: Partial<DiscoverIdeasInput> = {}): DiscoverIdeasInput {
  return createMinimalInput({
    shorts: [makeShort()],
    mediumClips: [makeMedium()],
    transcript: makeTranscript(),
    ...overrides,
  })
}

type ToolEntry = {
  name: string
  description: string
  parameters: Record<string, unknown>
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

function getTool(agent: IdeaDiscoveryAgent, name: string): ToolEntry {
  const tools = (agent as any).getTools() as ToolEntry[]
  const tool = tools.find(t => t.name === name)
  if (!tool) throw new Error(`Tool ${name} not found`)
  return tool
}

describe('IdeaDiscoveryAgent', () => {
  let agent: IdeaDiscoveryAgent

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.tools = []
    mockState.systemPrompt = ''
    agent = new IdeaDiscoveryAgent(createMinimalInput())
  })

  describe('construction', () => {
    test('can be constructed with minimal input', () => {
      expect(agent).toBeInstanceOf(IdeaDiscoveryAgent)
    })

    test('system prompt contains Idea Discovery guidance', () => {
      expect((agent as any).systemPrompt).toContain('Idea Discovery')
    })
  })

  describe('tool registration', () => {
    test('registers all expected tools', () => {
      const tools = (agent as any).getTools() as Array<{ name: string }>
      const toolNames = tools.map(t => t.name)

      for (const expected of EXPECTED_TOOLS) {
        expect(toolNames).toContain(expected)
      }
    })

    test('registers exactly the expected number of tools', () => {
      const tools = (agent as any).getTools() as Array<{ name: string }>
      expect(tools).toHaveLength(EXPECTED_TOOLS.length)
    })

    test('get_clip_transcript requires clipId', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        parameters: { required: string[] }
      }>
      const tool = tools.find(t => t.name === 'get_clip_transcript')!
      expect(tool.parameters.required).toContain('clipId')
    })

    test('assign_idea_to_clip requires clipId, ideaIssueNumber, and reason', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        parameters: { required: string[] }
      }>
      const tool = tools.find(t => t.name === 'assign_idea_to_clip')!
      expect(tool.parameters.required).toContain('clipId')
      expect(tool.parameters.required).toContain('ideaIssueNumber')
      expect(tool.parameters.required).toContain('reason')
    })

    test('create_idea_for_clip requires clipId, topic, hook, audience, keyTakeaway, talkingPoints, tags', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        parameters: { required: string[] }
      }>
      const tool = tools.find(t => t.name === 'create_idea_for_clip')!
      expect(tool.parameters.required).toEqual(
        expect.arrayContaining(['clipId', 'topic', 'hook', 'audience', 'keyTakeaway', 'talkingPoints', 'tags']),
      )
    })

    test('finalize_assignments requires summary', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        parameters: { required: string[] }
      }>
      const tool = tools.find(t => t.name === 'finalize_assignments')!
      expect(tool.parameters.required).toContain('summary')
    })

    test('every tool has a handler function', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        handler: unknown
      }>
      for (const tool of tools) {
        expect(typeof tool.handler).toBe('function')
      }
    })
  })

  describe('getTimeoutMs', () => {
    test('returns 0 (no timeout)', () => {
      expect((agent as any).getTimeoutMs()).toBe(0)
    })
  })

  // ========================================================================
  // TOOL HANDLER TESTS
  // ========================================================================

  describe('handleToolCall dispatch', () => {
    test('throws for unknown tool name', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      await expect(
        (agentWithClips as any).handleToolCall('nonexistent_tool', {}),
      ).rejects.toThrow('Unknown tool: nonexistent_tool')
    })
  })

  describe('get_clip_transcript handler', () => {
    let agentWithClips: IdeaDiscoveryAgent

    beforeEach(() => {
      agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
    })

    test('returns transcript text for a valid short clip', async () => {
      const tool = getTool(agentWithClips, 'get_clip_transcript')
      const result = await tool.handler({ clipId: 'short-1' }) as { clipId: string; transcript: string }

      expect(result.clipId).toBe('short-1')
      expect(result.transcript).toContain('Hello and welcome.')
      expect(result.transcript).toContain('Today we talk about TypeScript.')
      expect(result.transcript).toContain('Generics are powerful.')
    })

    test('returns transcript text for a valid medium clip', async () => {
      const tool = getTool(agentWithClips, 'get_clip_transcript')
      const result = await tool.handler({ clipId: 'medium-1' }) as { clipId: string; transcript: string }

      expect(result.clipId).toBe('medium-1')
      expect(result.transcript).toContain('Lets dive into generics.')
      expect(result.transcript).toContain('Use T for type parameters.')
      expect(result.transcript).toContain('Thanks for watching.')
    })

    test('throws when clip ID is not found', async () => {
      const tool = getTool(agentWithClips, 'get_clip_transcript')
      await expect(
        tool.handler({ clipId: 'nonexistent-clip' }),
      ).rejects.toThrow('Clip not found: nonexistent-clip')
    })

    test('error message lists available clip IDs', async () => {
      const tool = getTool(agentWithClips, 'get_clip_transcript')
      await expect(
        tool.handler({ clipId: 'bad-id' }),
      ).rejects.toThrow(/Available:.*short-1.*medium-1/)
    })

    test('returns fallback message when no transcript matches time range', async () => {
      const agentNoTranscript = new IdeaDiscoveryAgent(createMinimalInput({
        shorts: [makeShort({ segments: [{ start: 500, end: 510, description: 'far away' }] })],
        transcript: makeTranscript(),
      }))
      const tool = getTool(agentNoTranscript, 'get_clip_transcript')
      const result = await tool.handler({ clipId: 'short-1' }) as { transcript: string }

      expect(result.transcript).toBe('(No transcript found for this time range)')
    })

    test('concatenates transcript from multiple segments', async () => {
      const agentMultiSeg = new IdeaDiscoveryAgent(createMinimalInput({
        shorts: [makeShort({
          segments: [
            { start: 0, end: 5, description: 'seg1' },
            { start: 30, end: 40, description: 'seg2' },
          ],
        })],
        transcript: makeTranscript(),
      }))
      const tool = getTool(agentMultiSeg, 'get_clip_transcript')
      const result = await tool.handler({ clipId: 'short-1' }) as { transcript: string }

      expect(result.transcript).toContain('Hello and welcome.')
      expect(result.transcript).toContain('Lets dive into generics.')
    })
  })

  describe('assign_idea_to_clip handler', () => {
    let agentWithClips: IdeaDiscoveryAgent

    beforeEach(() => {
      agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
    })

    test('assigns an existing idea to a clip', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      const result = await tool.handler({
        clipId: 'short-1',
        ideaIssueNumber: 42,
        reason: 'Direct topic match',
      }) as { clipId: string; ideaIssueNumber: number; status: string }

      expect(result.clipId).toBe('short-1')
      expect(result.ideaIssueNumber).toBe(42)
      expect(result.status).toBe('assigned')
    })

    test('throws for invalid clipId', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await expect(
        tool.handler({ clipId: 'bad-id', ideaIssueNumber: 42, reason: 'test' }),
      ).rejects.toThrow('Invalid clipId: bad-id')
    })

    test('throws for empty clipId', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await expect(
        tool.handler({ clipId: '', ideaIssueNumber: 42, reason: 'test' }),
      ).rejects.toThrow('Invalid clipId:')
    })

    test('throws for non-integer ideaIssueNumber', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await expect(
        tool.handler({ clipId: 'short-1', ideaIssueNumber: 1.5, reason: 'test' }),
      ).rejects.toThrow('Invalid ideaIssueNumber: 1.5')
    })

    test('throws for zero ideaIssueNumber', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await expect(
        tool.handler({ clipId: 'short-1', ideaIssueNumber: 0, reason: 'test' }),
      ).rejects.toThrow('Invalid ideaIssueNumber: 0')
    })

    test('throws for negative ideaIssueNumber', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await expect(
        tool.handler({ clipId: 'short-1', ideaIssueNumber: -5, reason: 'test' }),
      ).rejects.toThrow('Invalid ideaIssueNumber: -5')
    })

    test('throws when clip already has an assignment', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      await tool.handler({ clipId: 'short-1', ideaIssueNumber: 42, reason: 'first' })

      await expect(
        tool.handler({ clipId: 'short-1', ideaIssueNumber: 99, reason: 'second' }),
      ).rejects.toThrow('Clip short-1 already has an assignment')
    })

    test('allows assigning different clips independently', async () => {
      const tool = getTool(agentWithClips, 'assign_idea_to_clip')
      const r1 = await tool.handler({ clipId: 'short-1', ideaIssueNumber: 42, reason: 'match 1' })
      const r2 = await tool.handler({ clipId: 'medium-1', ideaIssueNumber: 99, reason: 'match 2' })

      expect((r1 as any).status).toBe('assigned')
      expect((r2 as any).status).toBe('assigned')
    })
  })

  describe('create_idea_for_clip handler', () => {
    let agentWithClips: IdeaDiscoveryAgent
    const validArgs = {
      clipId: 'short-1',
      topic: 'TypeScript Tricks',
      hook: 'One trick to rule them all',
      audience: 'developers',
      keyTakeaway: 'Use mapped types',
      talkingPoints: ['Point A', 'Point B'],
      tags: ['typescript', 'tricks'],
    }

    beforeEach(() => {
      agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      mockCreateIdea.mockResolvedValue(makeIdea({ issueNumber: 100, topic: 'TypeScript Tricks' }))
    })

    test('creates a new idea and assigns it to the clip', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      const result = await tool.handler(validArgs) as { clipId: string; ideaIssueNumber: number; status: string }

      expect(result.clipId).toBe('short-1')
      expect(result.ideaIssueNumber).toBe(100)
      expect(result.status).toBe('created')
    })

    test('calls createIdea with correct input shape', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler(validArgs)

      expect(mockCreateIdea).toHaveBeenCalledWith({
        topic: 'TypeScript Tricks',
        hook: 'One trick to rule them all',
        audience: 'developers',
        keyTakeaway: 'Use mapped types',
        talkingPoints: ['Point A', 'Point B'],
        platforms: [Platform.YouTube],
        tags: ['typescript', 'tricks'],
        publishBy: '2026-03-01',
        trendContext: undefined,
      })
    })

    test('passes trendContext when provided', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler({ ...validArgs, trendContext: 'Trending on HN right now' })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ trendContext: 'Trending on HN right now' }),
      )
    })

    test('ignores empty trendContext string', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler({ ...validArgs, trendContext: '   ' })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ trendContext: undefined }),
      )
    })

    test('throws for invalid clipId', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await expect(
        tool.handler({ ...validArgs, clipId: 'nonexistent' }),
      ).rejects.toThrow('Invalid clipId: nonexistent')
    })

    test('throws when clip already has an assignment', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler(validArgs) // first assignment

      mockCreateIdea.mockResolvedValue(makeIdea({ issueNumber: 200 }))
      await expect(
        tool.handler({ ...validArgs, clipId: 'short-1', topic: 'Another' }),
      ).rejects.toThrow('Clip short-1 already has an assignment')
    })

    test('throws when hook exceeds 80 characters', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      const longHook = 'A'.repeat(81)
      await expect(
        tool.handler({ ...validArgs, hook: longHook }),
      ).rejects.toThrow('Hook must be 80 characters or fewer')
    })

    test('accepts hook of exactly 80 characters', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      const hook80 = 'A'.repeat(80)
      const result = await tool.handler({ ...validArgs, hook: hook80 })
      expect((result as any).status).toBe('created')
    })

    test('throws when talkingPoints is empty', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await expect(
        tool.handler({ ...validArgs, talkingPoints: [] }),
      ).rejects.toThrow('talkingPoints must be a non-empty array of strings')
    })

    test('throws when talkingPoints is not an array', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await expect(
        tool.handler({ ...validArgs, talkingPoints: 'not an array' }),
      ).rejects.toThrow('talkingPoints must be a non-empty array of strings')
    })

    test('filters out empty strings from talkingPoints', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler({ ...validArgs, talkingPoints: ['Valid', '', '  ', 'Also valid'] })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ talkingPoints: ['Valid', 'Also valid'] }),
      )
    })

    test('lowercases and trims tags', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler({ ...validArgs, tags: ['TypeScript', '  Tricks  ', 'DEMO'] })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['typescript', 'tricks', 'demo'] }),
      )
    })

    test('handles tags that are not an array', async () => {
      const tool = getTool(agentWithClips, 'create_idea_for_clip')
      await tool.handler({ ...validArgs, tags: 'not-array' })

      expect(mockCreateIdea).toHaveBeenCalledWith(
        expect.objectContaining({ tags: [] }),
      )
    })
  })

  describe('finalize_assignments handler', () => {
    test('reports totals when all clips are assigned', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      const assignTool = getTool(agentWithClips, 'assign_idea_to_clip')
      await assignTool.handler({ clipId: 'short-1', ideaIssueNumber: 42, reason: 'match' })
      await assignTool.handler({ clipId: 'medium-1', ideaIssueNumber: 99, reason: 'match' })

      const finalizeTool = getTool(agentWithClips, 'finalize_assignments')
      const result = await finalizeTool.handler({ summary: 'All matched' }) as any

      expect(result.totalClips).toBe(2)
      expect(result.assigned).toBe(2)
      expect(result.matched).toBe(2)
      expect(result.created).toBe(0)
      expect(result.unassigned).toEqual([])
    })

    test('reports unassigned clips', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      const assignTool = getTool(agentWithClips, 'assign_idea_to_clip')
      await assignTool.handler({ clipId: 'short-1', ideaIssueNumber: 42, reason: 'match' })

      const finalizeTool = getTool(agentWithClips, 'finalize_assignments')
      const result = await finalizeTool.handler({ summary: 'Partial' }) as any

      expect(result.totalClips).toBe(2)
      expect(result.assigned).toBe(1)
      expect(result.unassigned).toEqual(['medium-1'])
    })

    test('distinguishes matched from created ideas', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      mockCreateIdea.mockResolvedValue(makeIdea({ issueNumber: 200 }))

      const assignTool = getTool(agentWithClips, 'assign_idea_to_clip')
      await assignTool.handler({ clipId: 'short-1', ideaIssueNumber: 42, reason: 'existing match' })

      const createTool = getTool(agentWithClips, 'create_idea_for_clip')
      await createTool.handler({
        clipId: 'medium-1',
        topic: 'New Topic',
        hook: 'New hook',
        audience: 'devs',
        keyTakeaway: 'New takeaway',
        talkingPoints: ['Point 1'],
        tags: ['new'],
      })

      const finalizeTool = getTool(agentWithClips, 'finalize_assignments')
      const result = await finalizeTool.handler({ summary: 'Mixed' }) as any

      expect(result.matched).toBe(1) // short-1 matched existing #42
      expect(result.created).toBe(1) // medium-1 created new #200
      expect(result.assigned).toBe(2)
      expect(result.unassigned).toEqual([])
    })

    test('reports zero when no clips exist', async () => {
      const emptyAgent = new IdeaDiscoveryAgent(createMinimalInput())
      const tool = getTool(emptyAgent, 'finalize_assignments')
      const result = await tool.handler({ summary: 'Nothing to do' }) as any

      expect(result.totalClips).toBe(0)
      expect(result.assigned).toBe(0)
      expect(result.unassigned).toEqual([])
    })
  })

  // ========================================================================
  // DISCOVER METHOD
  // ========================================================================

  describe('discover', () => {
    test('returns empty result when there are no clips', async () => {
      const result = await agent.discover()
      expect(result).toEqual({
        assignments: [],
        newIdeas: [],
        matchedCount: 0,
        createdCount: 0,
      })
    })

    test('calls run and returns result when clips exist', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips({
        providedIdeas: [makeIdea()],
      }))

      const result = await agentWithClips.discover()

      // LLM mock returns immediately without calling tools, so no assignments
      expect(result.assignments).toEqual([])
      expect(result.newIdeas).toEqual([])
      expect(result.matchedCount).toBe(0)
      expect(result.createdCount).toBe(0)
    })
  })

  // ========================================================================
  // LOAD IDEAS
  // ========================================================================

  describe('loadIdeas', () => {
    test('uses providedIdeas when available', async () => {
      const ideas = [makeIdea()]
      const agentWithProvided = new IdeaDiscoveryAgent(createInputWithClips({
        providedIdeas: ideas,
      }))
      const loaded = await (agentWithProvided as any).loadIdeas()

      expect(loaded).toEqual(ideas)
      expect(mockListIdeas).not.toHaveBeenCalled()
    })

    test('fetches ready and draft ideas from ideaService', async () => {
      const readyIdea = makeIdea({ issueNumber: 1, status: 'ready' })
      const draftIdea = makeIdea({ issueNumber: 2, status: 'draft' })
      mockListIdeas.mockResolvedValueOnce([readyIdea]).mockResolvedValueOnce([draftIdea])

      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      const loaded = await (agentWithClips as any).loadIdeas()

      expect(mockListIdeas).toHaveBeenCalledWith({ status: 'ready' })
      expect(mockListIdeas).toHaveBeenCalledWith({ status: 'draft' })
      expect(loaded).toHaveLength(2)
    })

    test('falls back to existingIdeas when listIdeas throws', async () => {
      mockListIdeas.mockRejectedValue(new Error('API down'))
      const fallbackIdeas = [makeIdea({ issueNumber: 99 })]
      const agentWithFallback = new IdeaDiscoveryAgent(createInputWithClips({
        existingIdeas: fallbackIdeas,
      }))
      const loaded = await (agentWithFallback as any).loadIdeas()

      expect(loaded).toEqual(fallbackIdeas)
    })

    test('returns empty array when listIdeas throws and no existingIdeas', async () => {
      mockListIdeas.mockRejectedValue(new Error('API down'))
      const agentNoFallback = new IdeaDiscoveryAgent(createInputWithClips())
      const loaded = await (agentNoFallback as any).loadIdeas()

      expect(loaded).toEqual([])
    })
  })

  // ========================================================================
  // RESET FOR RETRY
  // ========================================================================

  describe('resetForRetry', () => {
    test('clears assignments, newIdeas, and finalized state', async () => {
      const agentWithClips = new IdeaDiscoveryAgent(createInputWithClips())
      mockCreateIdea.mockResolvedValue(makeIdea({ issueNumber: 100 }))

      const createTool = getTool(agentWithClips, 'create_idea_for_clip')
      await createTool.handler({
        clipId: 'short-1',
        topic: 'Test',
        hook: 'Hook',
        audience: 'devs',
        keyTakeaway: 'Key',
        talkingPoints: ['Point'],
        tags: ['tag'],
      })

      const finalizeTool = getTool(agentWithClips, 'finalize_assignments')
      await finalizeTool.handler({ summary: 'done' })

      expect((agentWithClips as any).assignments).toHaveLength(1)
      expect((agentWithClips as any).newIdeas).toHaveLength(1)
      expect((agentWithClips as any).finalized).toBe(true)

      ;(agentWithClips as any).resetForRetry()

      expect((agentWithClips as any).assignments).toHaveLength(0)
      expect((agentWithClips as any).newIdeas).toHaveLength(0)
      expect((agentWithClips as any).finalized).toBe(false)
    })
  })

  // ========================================================================
  // GET MCP SERVERS
  // ========================================================================

  describe('getMcpServers', () => {
    test('returns undefined or a record of server configs', () => {
      const result = (agent as any).getMcpServers()
      // Result depends on environment — either undefined (no keys) or an object of configs
      if (result === undefined) {
        expect(result).toBeUndefined()
      } else {
        expect(typeof result).toBe('object')
        for (const key of Object.keys(result)) {
          expect(result[key]).toHaveProperty('type')
          expect(result[key]).toHaveProperty('tools')
        }
      }
    })

    test('includes exa server when EXA_API_KEY is present in config', () => {
      const result = (agent as any).getMcpServers()
      if (result?.exa) {
        expect(result.exa.type).toBe('http')
        expect(result.exa.url).toContain('exaApiKey=')
        expect(result.exa.url).toContain('tools=web_search_exa')
      }
    })

    test('includes perplexity server when PERPLEXITY_API_KEY is present in config', () => {
      const result = (agent as any).getMcpServers()
      if (result?.perplexity) {
        expect(result.perplexity.type).toBe('local')
        expect(result.perplexity.command).toBe('npx')
        expect(result.perplexity.args).toContain('perplexity-mcp')
      }
    })
  })

  // ========================================================================
  // CLIP CONVERSION (clipsToInfo)
  // ========================================================================

  describe('clip conversion', () => {
    test('auto-generates clip IDs when not provided', () => {
      const shortNoId = makeShort({ id: undefined as any })
      const mediumNoId = makeMedium({ id: undefined as any })
      const agentAutoId = new IdeaDiscoveryAgent(createMinimalInput({
        shorts: [shortNoId],
        mediumClips: [mediumNoId],
      }))
      const clips = (agentAutoId as any).clips as Array<{ id: string }>

      expect(clips[0].id).toBe('short-1')
      expect(clips[1].id).toBe('medium-1')
    })

    test('computes duration from segments when totalDuration is missing', () => {
      const shortNoDuration = makeShort({ totalDuration: undefined as any, segments: [{ start: 10, end: 25, description: 's' }] })
      const agentNoDuration = new IdeaDiscoveryAgent(createMinimalInput({
        shorts: [shortNoDuration],
      }))
      const clips = (agentNoDuration as any).clips as Array<{ totalDuration: number }>

      expect(clips[0].totalDuration).toBe(15) // 25 - 10
    })

    test('preserves medium clip topic field', () => {
      const mediumWithTopic = makeMedium({ topic: 'Advanced Generics' })
      const agentWithTopic = new IdeaDiscoveryAgent(createMinimalInput({
        mediumClips: [mediumWithTopic],
      }))
      const clips = (agentWithTopic as any).clips as Array<{ topic?: string }>

      expect(clips[0].topic).toBe('Advanced Generics')
    })
  })

  // ========================================================================
  // DESTROY
  // ========================================================================

  describe('destroy', () => {
    test('can be called without prior session', async () => {
      await expect(agent.destroy()).resolves.toBeUndefined()
    })
  })
})

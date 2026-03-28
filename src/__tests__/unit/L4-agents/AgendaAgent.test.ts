import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { Idea } from '../../../L0-pure/types/index.js'

const mockGetBrandConfig = vi.hoisted(() => vi.fn().mockReturnValue({
  name: 'TestBrand',
  voice: 'casual',
  contentPillars: ['AI', 'DevTools'],
}))

const mockCostTracker = vi.hoisted(() => ({
  recordCall: vi.fn(),
}))

const mockGetProvider = vi.hoisted(() => vi.fn())
const mockGetModelForAgent = vi.hoisted(() => vi.fn().mockReturnValue(undefined))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: mockGetBrandConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: mockCostTracker,
}))

vi.mock('../../../L3-services/llm/index.js', () => ({
  getProvider: mockGetProvider.mockReturnValue({
    name: 'mock',
    isAvailable: () => true,
    getDefaultModel: () => 'mock-model',
    createSession: vi.fn(),
  }),
}))

vi.mock('../../../L1-infra/config/modelConfig.js', () => ({
  getModelForAgent: mockGetModelForAgent,
}))

import { AgendaAgent } from '../../../L4-agents/AgendaAgent.js'

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: 1,
    issueUrl: 'https://github.com/test/repo/issues/1',
    repoFullName: 'test/repo',
    id: 'idea-test',
    topic: 'Test Topic',
    hook: 'Grab their attention',
    audience: 'Developers',
    keyTakeaway: 'Key takeaway',
    talkingPoints: ['Point 1', 'Point 2'],
    platforms: [],
    status: 'draft',
    tags: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    publishBy: '2026-02-01',
    ...overrides,
  }
}

describe('AgendaAgent', () => {
  let agent: AgendaAgent
  const ideas: Idea[] = [
    makeIdea({ issueNumber: 1, topic: 'Copilot Tips' }),
    makeIdea({ issueNumber: 2, topic: 'AI Debugging' }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    agent = new AgendaAgent(ideas)
  })

  describe('getTools()', () => {
    test('registers all 6 expected tools', () => {
      const tools = (agent as unknown as { getTools: () => Array<{ name: string }> }).getTools()
      const names = tools.map(t => t.name)
      expect(names).toEqual([
        'get_brand_context',
        'get_idea_details',
        'add_section',
        'set_intro',
        'set_outro',
        'finalize_agenda',
      ])
    })
  })

  describe('handleToolCall — get_brand_context', () => {
    test('returns brand config', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_brand_context', {})
      expect(result).toEqual({
        name: 'TestBrand',
        voice: 'casual',
        contentPillars: ['AI', 'DevTools'],
      })
      expect(mockGetBrandConfig).toHaveBeenCalled()
    })
  })

  describe('handleToolCall — get_idea_details', () => {
    test('returns idea at valid index', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_idea_details', { ideaIndex: 0 })
      expect(result).toMatchObject({ issueNumber: 1, topic: 'Copilot Tips' })
    })

    test('returns second idea at index 1', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_idea_details', { ideaIndex: 1 })
      expect(result).toMatchObject({ issueNumber: 2, topic: 'AI Debugging' })
    })

    test('returns error for out-of-bounds index', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_idea_details', { ideaIndex: 5 })
      expect(result).toEqual({ error: 'Invalid ideaIndex 5. Must be 0–1.' })
    })

    test('returns error for negative index', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_idea_details', { ideaIndex: -1 })
      expect(result).toEqual({ error: 'Invalid ideaIndex -1. Must be 0–1.' })
    })

    test('returns error when ideaIndex is undefined (defaults to -1)', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('get_idea_details', {})
      expect(result).toHaveProperty('error')
    })
  })

  describe('handleToolCall — add_section', () => {
    test('adds section with correct fields and returns order', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('add_section', {
        title: 'Section One',
        ideaIssueNumber: 1,
        estimatedMinutes: 5,
        talkingPoints: ['Point A', 'Point B'],
        transition: 'Now moving on...',
        notes: 'High energy',
      })

      expect(result).toEqual({ added: true, order: 1 })
    })

    test('increments order for consecutive sections', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      await handle('add_section', {
        title: 'First',
        ideaIssueNumber: 1,
        estimatedMinutes: 3,
        talkingPoints: ['A'],
        transition: 'Next...',
        notes: '',
      })
      const result = await handle('add_section', {
        title: 'Second',
        ideaIssueNumber: 2,
        estimatedMinutes: 4,
        talkingPoints: ['B'],
        transition: '',
        notes: '',
      })

      expect(result).toEqual({ added: true, order: 2 })
    })

    test('handles missing optional fields with defaults', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('add_section', {})
      expect(result).toEqual({ added: true, order: 1 })
    })
  })

  describe('handleToolCall — set_intro', () => {
    test('sets intro text and returns confirmation', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('set_intro', { text: 'Welcome to the show!' })
      expect(result).toEqual({ set: true, field: 'intro' })
    })

    test('handles missing text gracefully', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('set_intro', {})
      expect(result).toEqual({ set: true, field: 'intro' })
    })
  })

  describe('handleToolCall — set_outro', () => {
    test('sets outro text and returns confirmation', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('set_outro', { text: 'Like and subscribe!' })
      expect(result).toEqual({ set: true, field: 'outro' })
    })

    test('handles missing text gracefully', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('set_outro', {})
      expect(result).toEqual({ set: true, field: 'outro' })
    })
  })

  describe('handleToolCall — finalize_agenda', () => {
    test('marks agenda finalized and returns summary', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('finalize_agenda', { summary: 'Two-part agenda on AI tools' })
      expect(result).toEqual({ finalized: true, summary: 'Two-part agenda on AI tools' })
    })

    test('handles missing summary gracefully', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('finalize_agenda', {})
      expect(result).toEqual({ finalized: true, summary: '' })
    })
  })

  describe('handleToolCall — unknown tool', () => {
    test('returns error for unknown tool name', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)

      const result = await handle('nonexistent_tool', {})
      expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' })
    })
  })

  describe('destroy', () => {
    test('delegates to BaseAgent.destroy() (super.destroy)', async () => {
      // Access the prototype chain to spy on BaseAgent.destroy
      const BaseAgentProto = Object.getPrototypeOf(Object.getPrototypeOf(agent))
      const superDestroySpy = vi.spyOn(BaseAgentProto, 'destroy')

      await agent.destroy()

      expect(superDestroySpy).toHaveBeenCalledOnce()
      superDestroySpy.mockRestore()
    })
  })

  describe('resetForRetry()', () => {
    test('clears sections, intro, outro, and finalized flag', async () => {
      const handle = (agent as unknown as {
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }).handleToolCall.bind(agent)
      const reset = (agent as unknown as { resetForRetry: () => void }).resetForRetry.bind(agent)

      await handle('add_section', {
        title: 'Section',
        ideaIssueNumber: 1,
        estimatedMinutes: 3,
        talkingPoints: ['A'],
        transition: '',
        notes: '',
      })
      await handle('set_intro', { text: 'Intro' })
      await handle('set_outro', { text: 'Outro' })
      await handle('finalize_agenda', { summary: 'Done' })

      reset()

      // After reset, adding a section should be order 1 again
      const result = await handle('add_section', {
        title: 'Fresh Section',
        ideaIssueNumber: 1,
        estimatedMinutes: 2,
        talkingPoints: [],
        transition: '',
        notes: '',
      })
      expect(result).toEqual({ added: true, order: 1 })
    })
  })
})

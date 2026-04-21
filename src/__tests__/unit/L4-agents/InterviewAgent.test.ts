import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Idea, InterviewInsights } from '../../../L0-pure/types/index.js'
import { Platform } from '../../../L0-pure/types/index.js'

// --- L3 mocks ---
const mockState = vi.hoisted(() => ({
  tools: [] as Array<{
    name: string
    description: string
    parameters: Record<string, unknown>
    handler: (args: Record<string, unknown>) => Promise<unknown>
  }>,
  systemPrompt: '',
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
          content: 'Interview complete.',
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

import { InterviewAgent } from '../../../L4-agents/InterviewAgent.js'

function createMockIdea(overrides: Partial<Idea> = {}): Idea {
  const issueNumber = overrides.issueNumber ?? 42
  return {
    issueNumber,
    issueUrl: `https://github.com/test/repo/issues/${issueNumber}`,
    repoFullName: 'test/repo',
    id: overrides.id ?? 'test-idea',
    topic: overrides.topic ?? 'Test Idea',
    hook: overrides.hook ?? 'Original hook',
    audience: overrides.audience ?? 'developers',
    keyTakeaway: overrides.keyTakeaway ?? 'Original takeaway',
    talkingPoints: overrides.talkingPoints ?? ['point 1', 'point 2'],
    platforms: overrides.platforms ?? [Platform.YouTube],
    status: overrides.status ?? 'draft',
    tags: overrides.tags ?? ['test'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    publishBy: '2026-02-01',
    ...overrides,
  }
}

describe('InterviewAgent', () => {
  let agent: InterviewAgent

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.tools = []
    mockState.systemPrompt = ''
    agent = new InterviewAgent()
  })

  describe('REQ-010: presents one Socratic question at a time', () => {
    test('ideateStart.REQ-010: system prompt contains Socratic questioning guidance', () => {
      expect((agent as any).systemPrompt).toContain('Socratic')
    })

    test('ideateStart.REQ-010: ask_question requires question and rationale', () => {
      const tools = (agent as any).getTools() as Array<{
        name: string
        parameters: { required: string[]; properties: Record<string, unknown> }
      }>
      const askTool = tools.find((t) => t.name === 'ask_question')!

      expect(askTool.parameters.required).toContain('question')
      expect(askTool.parameters.required).toContain('rationale')
      expect(askTool.parameters.properties).toHaveProperty('question')
      expect(askTool.parameters.properties).toHaveProperty('rationale')
      expect(askTool.parameters.properties).toHaveProperty('targetField')
    })
  })

  describe('REQ-052: answerProvider blocks until answered', () => {
    test('ideateStart.REQ-052: calls the answerProvider and returns the answer', async () => {
      const mockAnswer = vi.fn().mockResolvedValue('My answer about the topic')

      // Set up internal state to simulate an active interview
      ;(agent as any).answerProvider = mockAnswer
      ;(agent as any).idea = createMockIdea()

      const result = await (agent as any).handleToolCall('ask_question', {
        question: 'What problem does this solve?',
        rationale: 'Exploring the core problem',
        targetField: 'keyTakeaway',
      })

      expect(mockAnswer).toHaveBeenCalledOnce()
      expect(mockAnswer).toHaveBeenCalledWith(
        'What problem does this solve?',
        expect.objectContaining({
          rationale: 'Exploring the core problem',
          questionNumber: 1,
        }),
      )
      expect(result).toBe('My answer about the topic')
    })

    test('ideateStart.REQ-052: increments question number on each call', async () => {
      const mockAnswer = vi.fn().mockResolvedValue('answer')
      ;(agent as any).answerProvider = mockAnswer

      await (agent as any).handleToolCall('ask_question', {
        question: 'Q1?',
        rationale: 'r1',
      })
      await (agent as any).handleToolCall('ask_question', {
        question: 'Q2?',
        rationale: 'r2',
      })

      expect(mockAnswer).toHaveBeenCalledTimes(2)
      expect(mockAnswer.mock.calls[0][1].questionNumber).toBe(1)
      expect(mockAnswer.mock.calls[1][1].questionNumber).toBe(2)
    })

    test('ideateStart.REQ-052: records Q&A pair in transcript', async () => {
      const mockAnswer = vi.fn().mockResolvedValue('The answer')
      ;(agent as any).answerProvider = mockAnswer

      await (agent as any).handleToolCall('ask_question', {
        question: 'Test question?',
        rationale: 'testing',
      })

      const transcript = (agent as any).transcript as Array<{
        question: string
        answer: string
        questionNumber: number
      }>
      expect(transcript).toHaveLength(1)
      expect(transcript[0].question).toBe('Test question?')
      expect(transcript[0].answer).toBe('The answer')
      expect(transcript[0].questionNumber).toBe(1)
    })

    test('ideateStart.REQ-052: throws when no answerProvider is configured', async () => {
      ;(agent as any).answerProvider = null

      await expect(
        (agent as any).handleToolCall('ask_question', {
          question: 'Q?',
          rationale: 'r',
        }),
      ).rejects.toThrow('No answer provider configured')
    })
  })

  describe('REQ-015: agent identifies insights to improve fields', () => {
    test('ideateStart.REQ-015: stores scalar field (hook)', async () => {
      const result = await (agent as any).handleToolCall('update_field', {
        field: 'hook',
        value: 'You are wasting 3 hours a week',
      })

      expect(result).toEqual({ updated: true, field: 'hook' })

      const insights = (agent as any).insights as InterviewInsights
      expect(insights.hook).toBe('You are wasting 3 hours a week')
    })

    test('ideateStart.REQ-015: stores scalar field (audience)', async () => {
      await (agent as any).handleToolCall('update_field', {
        field: 'audience',
        value: 'senior platform engineers',
      })

      expect((agent as any).insights.audience).toBe('senior platform engineers')
    })

    test('ideateStart.REQ-015: stores scalar field (keyTakeaway)', async () => {
      await (agent as any).handleToolCall('update_field', {
        field: 'keyTakeaway',
        value: 'Ship guardrails before shipping code',
      })

      expect((agent as any).insights.keyTakeaway).toBe('Ship guardrails before shipping code')
    })

    test('ideateStart.REQ-015: stores scalar field (trendContext)', async () => {
      await (agent as any).handleToolCall('update_field', {
        field: 'trendContext',
        value: 'AI hype cycle peaking',
      })

      expect((agent as any).insights.trendContext).toBe('AI hype cycle peaking')
    })

    test('ideateStart.REQ-015: replaces talkingPoints with full list', async () => {
      await (agent as any).handleToolCall('update_field', {
        field: 'talkingPoints',
        values: ['First talking point', 'Second talking point'],
      })

      const insights = (agent as any).insights as InterviewInsights
      expect(insights.talkingPoints).toEqual([
        'First talking point',
        'Second talking point',
      ])
    })

    test('ideateStart.REQ-015: replaces tags with full list', async () => {
      await (agent as any).handleToolCall('update_field', {
        field: 'tags',
        values: ['testing', 'automation'],
      })

      const insights = (agent as any).insights as InterviewInsights
      expect(insights.tags).toEqual(['testing', 'automation'])
    })
  })

  describe('handleToolCall — end_interview', () => {
    test('sets ended flag and returns summary', async () => {
      const result = await (agent as any).handleToolCall('end_interview', {
        summary: 'Great interview! The idea is much sharper now.',
      })

      expect(result).toEqual({
        ended: true,
        summary: 'Great interview! The idea is much sharper now.',
      })
      expect((agent as any).ended).toBe(true)
    })
  })

  describe('handleToolCall — unknown tool', () => {
    test('returns error for unknown tool name', async () => {
      const result = await (agent as any).handleToolCall('nonexistent_tool', {})
      expect(result).toEqual({ error: 'Unknown tool: nonexistent_tool' })
    })
  })

  describe('REQ-014: agent receives idea fields as context', () => {
    test('ideateStart.REQ-014: returns InterviewResult with transcript and insights', async () => {
      const idea = createMockIdea({ topic: 'Agentic Testing' })
      const answerProvider = vi.fn().mockResolvedValue('test answer')

      const result = await agent.runInterview(idea, answerProvider)

      expect(result).toEqual(
        expect.objectContaining({
          ideaNumber: 42,
          transcript: expect.any(Array),
          insights: expect.any(Object),
          updatedFields: expect.any(Array),
          durationMs: expect.any(Number),
          endedBy: expect.stringMatching(/^(agent|user)$/),
        }),
      )
    })

    test('ideateStart.REQ-014: sets endedBy to "user" when agent does not call end_interview', async () => {
      const idea = createMockIdea()
      const answerProvider = vi.fn().mockResolvedValue('answer')

      const result = await agent.runInterview(idea, answerProvider)

      // The mock sendAndWait doesn't invoke end_interview tool, so ended = false
      expect(result.endedBy).toBe('user')
    })

    test('ideateStart.REQ-014: durationMs is a positive number', async () => {
      const idea = createMockIdea()
      const answerProvider = vi.fn().mockResolvedValue('answer')

      const result = await agent.runInterview(idea, answerProvider)

      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    })
  })
})

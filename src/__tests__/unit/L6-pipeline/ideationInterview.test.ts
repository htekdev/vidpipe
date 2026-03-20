import { describe, test, expect, vi } from 'vitest'
import type { InterviewResult, Idea } from '../../../L0-pure/types/index.js'

const { mockAgent, mockCreateInterviewAgent } = vi.hoisted(() => {
  const agent = {
    runInterview: vi.fn(),
    destroy: vi.fn(),
  }
  return { mockAgent: agent, mockCreateInterviewAgent: vi.fn().mockReturnValue(agent) }
})

vi.mock('../../../L5-assets/pipelineServices.js', () => ({
  createInterviewAgent: mockCreateInterviewAgent,
}))

// Must also mock the interviewEmitter since L6 imports it
vi.mock('../../../L1-infra/progress/interviewEmitter.js', () => ({
  interviewEmitter: {
    addListener: vi.fn(),
    removeListener: vi.fn(),
  },
}))

import { startInterview } from '../../../L6-pipeline/ideation.js'

describe('ideation — startInterview bridge', () => {
  const mockIdea = { issueNumber: 42, topic: 'Test' } as Idea
  const mockAnswerProvider = vi.fn()

  test('ideateStart.ARCH-002: startInterview creates agent, runs interview, destroys agent', async () => {
    const mockResult: InterviewResult = {
      ideaNumber: 42,
      transcript: [],
      insights: {},
      updatedFields: [],
      durationMs: 100,
      endedBy: 'agent',
    }
    mockAgent.runInterview.mockResolvedValue(mockResult)

    const result = await startInterview(mockIdea, mockAnswerProvider)

    expect(mockCreateInterviewAgent).toHaveBeenCalled()
    expect(mockAgent.runInterview).toHaveBeenCalledWith(mockIdea, mockAnswerProvider)
    expect(mockAgent.destroy).toHaveBeenCalled()
    expect(result).toEqual(mockResult)
  })

  test('ideateStart.REQ-055: agent is destroyed even if interview throws', async () => {
    mockAgent.runInterview.mockRejectedValue(new Error('boom'))
    mockAgent.destroy.mockClear()

    await expect(startInterview(mockIdea, mockAnswerProvider)).rejects.toThrow('boom')
    expect(mockAgent.destroy).toHaveBeenCalled()
  })
})

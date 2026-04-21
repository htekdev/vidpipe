import { describe, test, expect, vi } from 'vitest'

const mockInterviewAgent = vi.hoisted(() => vi.fn().mockImplementation(function(this: Record<string, unknown>) {
  this.runInterview = vi.fn().mockResolvedValue({ transcript: [], insights: {}, updatedFields: [], durationMs: 0, endedBy: 'agent', ideaNumber: 1 })
  this.destroy = vi.fn()
}))

vi.mock('../../../L4-agents/InterviewAgent.js', () => ({
  InterviewAgent: mockInterviewAgent,
}))

import { createInterviewAgent } from '../../../L5-assets/pipelineServices.js'

describe('pipelineServices — interview bridge', () => {
  test('ideateStart.ARCH-002: createInterviewAgent returns an InterviewAgent instance', () => {
    const agent = createInterviewAgent()
    expect(agent).toBeDefined()
    expect(mockInterviewAgent).toHaveBeenCalled()
  })
})

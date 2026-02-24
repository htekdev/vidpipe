/**
 * L6 Unit Test — scheduleChat wrapper
 *
 * Mocks: L5 assets only
 * Tests that createScheduleAgent delegates to L5 pipelineServices.
 */
import { vi, describe, it, expect } from 'vitest'

const mockCreateScheduleAgent = vi.hoisted(() => vi.fn().mockReturnValue({ run: vi.fn() }))

vi.mock('../../../L5-assets/pipelineServices.js', () => ({
  createScheduleAgent: mockCreateScheduleAgent,
}))

import { createScheduleAgent } from '../../../L6-pipeline/scheduleChat.js'

describe('L6 Unit: scheduleChat wrapper', () => {
  it('createScheduleAgent delegates to L5', () => {
    const agent = createScheduleAgent()
    expect(agent).toBeDefined()
    expect(mockCreateScheduleAgent).toHaveBeenCalledOnce()
  })
})

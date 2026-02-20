import { describe, test, expect } from 'vitest'

describe('pipelineServices wrappers', () => {
  test('costTracker proxy is accessible via L5 pipelineServices', async () => {
    const { costTracker } = await import('../../L5-assets/pipelineServices.js')
    expect(costTracker).toBeDefined()
    expect(typeof costTracker.reset).toBe('function')
    expect(typeof costTracker.formatReport).toBe('function')
  })

  test('createScheduleAgent is accessible via L5', async () => {
    const { createScheduleAgent } = await import('../../L5-assets/pipelineServices.js')
    expect(typeof createScheduleAgent).toBe('function')
  })

  test('createScheduleAgent is accessible via L6 scheduleChat', async () => {
    const { createScheduleAgent } = await import('../../L6-pipeline/scheduleChat.js')
    expect(typeof createScheduleAgent).toBe('function')
  })

  test('analysisServiceBridge exports generateImage wrapper', async () => {
    const mod = await import('../../L4-agents/analysisServiceBridge.js')
    expect(typeof mod.generateImage).toBe('function')
  })
})

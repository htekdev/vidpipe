import { describe, test, expect } from 'vitest'

describe('pipelineServices re-exports', () => {
  test('costTracker is accessible via L5 pipelineServices', async () => {
    const { costTracker } = await import('../../L5-assets/pipelineServices.js')
    expect(costTracker).toBeDefined()
    expect(typeof costTracker.formatReport).toBe('function')
  })

  test('analysisServiceBridge re-exports generateImage', async () => {
    const mod = await import('../../L4-agents/analysisServiceBridge.js')
    expect(typeof mod.generateImage).toBe('function')
  })
})

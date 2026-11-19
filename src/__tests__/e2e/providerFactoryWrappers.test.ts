/**
 * E2E Test — providerFactory wrapper functions delegate to real L2 factory
 *
 * No mocking — verifies that L3 providerFactory wrappers correctly
 * delegate to L2 and return real provider instances.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { getProvider, resetProvider, getProviderName } from '../../L3-services/llm/providerFactory.js'
import { getModelForAgent } from '../../L1-infra/config/modelConfig.js'

describe('E2E: providerFactory wrappers', () => {
  afterEach(async () => {
    await resetProvider()
  })

  test('modelConfig.REQ-001: real provider and agent selection agree on GPT-6.1 Sol', () => {
    const provider = getProvider('copilot')
    expect(provider).toBeDefined()
    expect(provider.name).toBe('copilot')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.createSession).toBe('function')
    expect(provider.getDefaultModel()).toBe('gpt-6.1-sol')
    expect(getModelForAgent('ShortsAgent')).toBe(provider.getDefaultModel())
  })

  test('getProviderName returns a valid provider name', () => {
    const name = getProviderName()
    expect(['copilot', 'openai', 'claude']).toContain(name)
  })

  test('resetProvider allows creating a fresh provider', async () => {
    const first = getProvider('copilot')
    await resetProvider()
    const second = getProvider('copilot')
    expect(first).not.toBe(second)
  })
})

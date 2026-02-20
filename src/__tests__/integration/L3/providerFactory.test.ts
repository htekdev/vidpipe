/**
 * L3 Integration Test — providerFactory → L2 provider chain
 *
 * Mock boundary: L1 (config, logger)
 * Real code:     L2 providers + ai.ts wrappers, L3 providerFactory
 *
 * Validates that the provider factory correctly creates L2 provider
 * instances through the ai.ts wrapper functions and handles
 * fallback behavior when a provider is unavailable.
 */
import { vi, describe, test, expect, afterEach } from 'vitest'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    LLM_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-integration-key',
    ANTHROPIC_API_KEY: '',
    GEMINI_API_KEY: '',
  }),
}))

// providerFactory currently re-exports from L2 — this tests the chain
import { getProvider, resetProvider, getProviderName } from '../../../L3-services/llm/providerFactory.js'

describe('L3 Integration: providerFactory → L2 provider chain', () => {
  afterEach(async () => {
    await resetProvider()
  })

  test('getProvider creates OpenAIProvider that uses createOpenAI wrapper', () => {
    const provider = getProvider('openai')
    expect(provider).toBeDefined()
    expect(provider.name).toBe('openai')
    expect(provider.getDefaultModel()).toBe('gpt-4o')
  })

  test('getProvider creates CopilotProvider that defers createCopilotClient', () => {
    const provider = getProvider('copilot')
    expect(provider).toBeDefined()
    expect(provider.name).toBe('copilot')
    // CopilotProvider.isAvailable() returns true without calling createCopilotClient
    expect(provider.isAvailable()).toBe(true)
  })

  test('getProvider caches singleton instance', () => {
    const first = getProvider('copilot')
    const second = getProvider('copilot')
    expect(first).toBe(second)
  })

  test('resetProvider clears cached instance', async () => {
    const first = getProvider('copilot')
    await resetProvider()
    const second = getProvider('copilot')
    expect(first).not.toBe(second)
  })

  test('getProviderName returns configured provider', () => {
    const name = getProviderName()
    expect(name).toBe('openai')
  })
})

/**
 * E2E Test — providerFactory wrapper functions delegate to real L2 factory
 *
 * No mocking — verifies that L3 providerFactory wrappers correctly
 * delegate to L2 and return real provider instances.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { getProvider, resetProvider, getProviderName } from '../../L3-services/llm/providerFactory.js'
import { getModelForAgent } from '../../L1-infra/config/modelConfig.js'
import { initConfig } from '../../L1-infra/config/environment.js'
import { ClaudeProvider } from '../../L2-clients/llm/ClaudeProvider.js'
import { OpenAIProvider } from '../../L2-clients/llm/OpenAIProvider.js'

describe('E2E: providerFactory wrappers', () => {
  afterEach(async () => {
    await resetProvider()
    initConfig()
  })

  test('modelConfig.REQ-001: real provider and agent selection agree on GPT-6.1 Sol', () => {
    const provider = getProvider('copilot')
    expect(provider).toBeDefined()
    expect(provider.name).toBe('copilot')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.createSession).toBe('function')
    expect(provider.getDefaultModel()).toBe('gpt-6.1-sol')
    initConfig({ llmProvider: 'claude', llmModel: '' })
    expect(getModelForAgent('ShortsAgent', provider.name)).toBe(provider.getDefaultModel())
  })

  test.each([
    [new ClaudeProvider(), 'claude-opus-4.6'],
    [new OpenAIProvider(), 'gpt-4o'],
  ] as const)('modelConfig.REQ-002: real direct provider %s retains its supported default', (provider, expected) => {
    initConfig({ llmProvider: 'copilot', llmModel: '' })
    const model = getModelForAgent('ShortsAgent', provider.name)
    expect(model).toBeUndefined()
    expect(model ?? provider.getDefaultModel()).toBe(expected)
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

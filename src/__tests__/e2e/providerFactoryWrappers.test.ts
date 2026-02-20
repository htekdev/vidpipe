/**
 * E2E Test — providerFactory wrapper functions delegate to real L2 factory
 *
 * No mocking — verifies that L3 providerFactory wrappers correctly
 * delegate to L2 and return real provider instances.
 */
import { describe, test, expect, afterEach } from 'vitest'
import { getProvider, resetProvider, getProviderName } from '../../L3-services/llm/providerFactory.js'

describe('E2E: providerFactory wrappers', () => {
  afterEach(async () => {
    await resetProvider()
  })

  test('getProvider returns a real provider with expected interface', () => {
    const provider = getProvider('copilot')
    expect(provider).toBeDefined()
    expect(provider.name).toBe('copilot')
    expect(typeof provider.isAvailable).toBe('function')
    expect(typeof provider.createSession).toBe('function')
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

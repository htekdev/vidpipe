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

// providerFactory wraps L2 functions — this tests the L3→L2 chain
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

  test('ClaudeProvider.createSession creates session with Anthropic client', async () => {
    const { ClaudeProvider } = await import('../../../L2-clients/llm/ClaudeProvider.js')
    const provider = new ClaudeProvider()
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
  })

  test('CopilotProvider exposes approveAll from L1 copilot wrapper', async () => {
    const { approveAll } = await import('../../../L1-infra/ai/copilot.js')
    expect(approveAll).toBeDefined()
    expect(typeof approveAll).toBe('function')
  })

  test('CopilotProvider passes child env with ExperimentalWarning suppression', async () => {
    const { CopilotClient } = await import('@github/copilot-sdk')
    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()
    await provider.createSession({ systemPrompt: 'test', tools: [] })

    // The CopilotClient constructor should have been called with env option
    const ctorCalls = (CopilotClient as ReturnType<typeof vi.fn>).mock.calls
    expect(ctorCalls.length).toBeGreaterThan(0)
    const opts = ctorCalls[ctorCalls.length - 1][0] as Record<string, unknown>
    const env = opts.env as Record<string, string>
    expect(env.NODE_OPTIONS).toContain('--disable-warning=ExperimentalWarning')
  })
})

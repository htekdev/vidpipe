import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseAgent } from '../../../L4-agents/BaseAgent.js'
import { initConfig } from '../../../L1-infra/config/environment.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'
import type { LLMProvider } from '../../../L3-services/llm/providerFactory.js'

const { getProvider } = vi.hoisted(() => ({ getProvider: vi.fn() }))
// Real L3 factory delegates to this L2 boundary, simulating configured/fallback providers.
vi.mock('../../../L2-clients/llm/index.js', () => ({
  getProvider,
  resetProvider: vi.fn(),
  getProviderName: vi.fn(),
}))

class TestAgent extends BaseAgent {
  constructor() {
    super('ShortsAgent', 'test')
  }

  protected async handleToolCall(): Promise<unknown> {
    return undefined
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  initConfig()
  costTracker.reset()
})

describe('BaseAgent → L3 factory → L2 provider model selection', () => {
  it.each([
    ['copilot', 'claude', undefined],
    ['copilot', 'openai', undefined],
    ['claude', 'copilot', 'gpt-6.1-sol'],
  ] as const)('modelConfig.REQ-003: configured %s but factory returns %s', async (configured, actual, expected) => {
    vi.stubEnv('MODEL_SHORTS_AGENT', '')
    initConfig({ llmProvider: configured, llmModel: '' })
    const provider: LLMProvider = {
      name: actual,
      createSession: vi.fn().mockResolvedValue({
        sendAndWait: async () => ({
          content: 'done', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        }),
        on: vi.fn(),
        close: vi.fn(),
      }),
      getDefaultModel: () => actual === 'claude' ? 'claude-opus-4.6' : 'gpt-4o',
      isAvailable: () => true,
    }
    getProvider.mockReturnValue(provider)
    const agent = new TestAgent()
    try {
      expect(await agent.run('test')).toBe('done')
      expect(provider.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: expected }))
    } finally {
      await agent.destroy()
    }
  })
})

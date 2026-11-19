import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseAgent } from '../../../L4-agents/BaseAgent.js'
import { initConfig } from '../../../L1-infra/config/environment.js'
import type { LLMProvider, LLMSession } from '../../../L3-services/llm/providerFactory.js'

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: { setAgent: vi.fn(), recordUsage: vi.fn() },
}))

class TestAgent extends BaseAgent {
  constructor(provider: LLMProvider, model?: string) {
    super('ShortsAgent', 'test', provider, model)
  }

  protected async handleToolCall(): Promise<unknown> {
    return undefined
  }
}

beforeEach(() => {
  vi.stubEnv('MODEL_SHORTS_AGENT', '')
  initConfig({ llmProvider: 'copilot', llmModel: '' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  initConfig()
})

describe('BaseAgent model selection', () => {
  it.each([
    ['copilot', 'claude', undefined],
    ['copilot', 'openai', undefined],
    ['claude', 'copilot', 'gpt-6.1-sol'],
  ] as const)('modelConfig.REQ-003: configured %s but injected %s', async (configured, actual, expected) => {
    initConfig({ llmProvider: configured, llmModel: '' })
    const session: LLMSession = {
      sendAndWait: vi.fn().mockResolvedValue({
        content: 'done', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      }),
      on: vi.fn(),
      close: vi.fn(),
    }
    const provider: LLMProvider = {
      name: actual,
      createSession: vi.fn().mockResolvedValue(session),
      getDefaultModel: () => 'provider-default',
      isAvailable: () => true,
    }
    const agent = new TestAgent(provider)
    try {
      expect(await agent.run('test')).toBe('done')
      expect(provider.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: expected }))
    } finally {
      await agent.destroy()
    }
    expect(session.close).toHaveBeenCalledOnce()
  })

  it('modelConfig.REQ-004: constructor model wins over per-agent and provider defaults', async () => {
    vi.stubEnv('MODEL_SHORTS_AGENT', 'per-agent-model')
    initConfig({ llmProvider: 'copilot', llmModel: 'global-model' })
    const provider: LLMProvider = {
      name: 'claude',
      createSession: vi.fn().mockResolvedValue({
        sendAndWait: vi.fn().mockResolvedValue({
          content: 'done', toolCalls: [], usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        }),
        on: vi.fn(),
        close: vi.fn(),
      }),
      getDefaultModel: () => 'provider-default',
      isAvailable: () => true,
    }
    const agent = new TestAgent(provider, 'explicit-session-model')
    try {
      await agent.run('test')
      expect(provider.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'explicit-session-model' }))
    } finally {
      await agent.destroy()
    }
  })
})

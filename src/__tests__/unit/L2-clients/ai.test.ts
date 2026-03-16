import { describe, test, expect, vi, beforeEach } from 'vitest'
import { initConfig } from '../../../L1-infra/config/environment.js'

const mockCreateFn = vi.hoisted(() => vi.fn())
const MockOpenAI = vi.hoisted(() => vi.fn(function (this: Record<string, unknown>, opts?: Record<string, unknown>) {
  this.apiKey = opts?.apiKey ?? 'default'
  this.chat = { completions: { create: mockCreateFn } }
  this.audio = { transcriptions: { create: mockCreateFn } }
}))

vi.mock('openai', () => {
  return { default: MockOpenAI }
})
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function (this: Record<string, unknown>) {
    this.name = 'anthropic'
    this.messages = { create: mockCreateFn }
  })
  return { default: MockAnthropic }
})

const mockCopilotCreateSession = vi.hoisted(() => vi.fn().mockResolvedValue({
  sendMessage: vi.fn(),
  destroy: vi.fn(),
  on: vi.fn(),
}))
const mockCopilotClientOptions = vi.hoisted(() => ({ captured: null as Record<string, unknown> | null }))
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(function (this: Record<string, unknown>, opts?: Record<string, unknown>) {
    mockCopilotClientOptions.captured = opts ?? null
    this.name = 'copilot-client'
    this.createSession = mockCopilotCreateSession
  }),
  CopilotSession: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'copilot-session'
  }),
  approveAll: vi.fn().mockReturnValue({ result: 'allow' }),
}))

import {
  createOpenAI,
  createAnthropic,
  createCopilotClient,
  createCopilotSession,
} from '../../../L2-clients/llm/ai.js'

describe('L2 ai.ts wrapper functions', () => {
  test('createOpenAI returns an instance', () => {
    const client = createOpenAI({ apiKey: 'test-key' })
    expect(client).toBeDefined()
  })

  test('createAnthropic returns an instance', () => {
    const client = createAnthropic()
    expect(client).toBeDefined()
  })

  test('createCopilotClient returns an instance', () => {
    const client = createCopilotClient()
    expect(client).toBeDefined()
  })

  test('createCopilotSession returns an instance', () => {
    // CopilotSession requires (sessionId, connection) — mocked constructor accepts anything
    const session = (createCopilotSession as (...args: unknown[]) => unknown)('test-id', {})
    expect(session).toBeDefined()
  })
})

// ── Provider createSession exercises the wrappers ─────────────────────

describe('OpenAIProvider.createSession uses createOpenAI wrapper', () => {
  beforeEach(() => {
    MockOpenAI.mockClear()
  })

  test('createSession creates client via wrapper and returns session', async () => {
    const { OpenAIProvider } = await import('../../../L2-clients/llm/OpenAIProvider.js')
    const provider = new OpenAIProvider()
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
  })

  test('createSession passes API key from config to OpenAI constructor', async () => {
    initConfig({ openaiKey: 'sk-test-from-config-42' })
    const { OpenAIProvider } = await import('../../../L2-clients/llm/OpenAIProvider.js')
    const provider = new OpenAIProvider()
    await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(MockOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test-from-config-42' }),
    )
  })
})

describe('ClaudeProvider.createSession uses createAnthropic wrapper', () => {
  test('createSession creates client via wrapper and returns session', async () => {
    const { ClaudeProvider } = await import('../../../L2-clients/llm/ClaudeProvider.js')
    const provider = new ClaudeProvider()
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
  })
})

describe('CopilotProvider.createSession uses createCopilotClient wrapper', () => {
  test('createSession creates client via wrapper and returns session', async () => {
    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
  })

  test('createSession passes onUserInputRequest through', async () => {
    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()
    const handler = vi.fn().mockResolvedValue({ response: 'ok' })
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
      onUserInputRequest: handler,
    })
    expect(session).toBeDefined()
  })

  test('createSession times out and throws when SDK hangs', async () => {
    // Make the mock createSession hang forever
    mockCopilotCreateSession.mockImplementationOnce(
      () => new Promise(() => { /* never resolves */ }),
    )

    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()

    vi.useFakeTimers()
    const sessionPromise = provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })

    // Attach rejection handler BEFORE advancing timers to prevent unhandled rejection
    const assertion = expect(sessionPromise).rejects.toThrow('createSession timed out')
    await vi.advanceTimersByTimeAsync(31_000)
    await assertion

    vi.useRealTimers()
  })

  test('createSession resets client after timeout so next attempt starts fresh', async () => {
    // First call hangs
    mockCopilotCreateSession.mockImplementationOnce(
      () => new Promise(() => { /* never resolves */ }),
    )

    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()

    vi.useFakeTimers()
    const sessionPromise = provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    const assertion = expect(sessionPromise).rejects.toThrow('createSession timed out')
    await vi.advanceTimersByTimeAsync(31_000)
    await assertion
    vi.useRealTimers()

    // Second call should succeed (mock returns normally)
    mockCopilotCreateSession.mockResolvedValueOnce({
      sendMessage: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(),
    })
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
  })

  test('createSession passes env with --disable-warning=ExperimentalWarning to suppress Node.js 24 stderr warnings', async () => {
    const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
    const provider = new CopilotProvider()
    await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })

    // The CopilotClient constructor should receive an env option
    const opts = mockCopilotClientOptions.captured
    expect(opts).toBeDefined()
    expect(opts?.env).toBeDefined()

    const env = opts?.env as Record<string, string>
    expect(env.NODE_OPTIONS).toContain('--disable-warning=ExperimentalWarning')
  })

  test('env preserves existing NODE_OPTIONS when adding warning suppression', async () => {
    const originalNodeOptions = process.env.NODE_OPTIONS
    process.env.NODE_OPTIONS = '--max-old-space-size=4096'

    try {
      const { CopilotProvider } = await import('../../../L2-clients/llm/CopilotProvider.js')
      // Force new client creation by using a fresh provider
      const provider = new CopilotProvider()
      await provider.close() // clear any cached client
      await provider.createSession({
        systemPrompt: 'test',
        tools: [],
      })

      const opts = mockCopilotClientOptions.captured
      const env = opts?.env as Record<string, string>
      expect(env.NODE_OPTIONS).toContain('--max-old-space-size=4096')
      expect(env.NODE_OPTIONS).toContain('--disable-warning=ExperimentalWarning')
    } finally {
      if (originalNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS
      } else {
        process.env.NODE_OPTIONS = originalNodeOptions
      }
    }
  })
})

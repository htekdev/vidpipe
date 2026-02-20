import { describe, test, expect, vi } from 'vitest'

const mockCreateFn = vi.hoisted(() => vi.fn())

vi.mock('openai', () => {
  const MockOpenAI = vi.fn(function (this: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.apiKey = opts?.apiKey ?? 'default'
    this.chat = { completions: { create: mockCreateFn } }
    this.audio = { transcriptions: { create: mockCreateFn } }
  })
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
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'copilot-client'
    this.createSession = mockCopilotCreateSession
  }),
  CopilotSession: vi.fn(function (this: Record<string, unknown>) {
    this.name = 'copilot-session'
  }),
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
    const session = createCopilotSession()
    expect(session).toBeDefined()
  })
})

// ── Provider createSession exercises the wrappers ─────────────────────

describe('OpenAIProvider.createSession uses createOpenAI wrapper', () => {
  test('createSession creates client via wrapper and returns session', async () => {
    const { OpenAIProvider } = await import('../../../L2-clients/llm/OpenAIProvider.js')
    const provider = new OpenAIProvider()
    const session = await provider.createSession({
      systemPrompt: 'test',
      tools: [],
    })
    expect(session).toBeDefined()
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
})

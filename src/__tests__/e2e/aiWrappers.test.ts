/**
 * E2E Test — ai.ts wrapper functions create real SDK instances
 *
 * No mocking — verifies that the L2 factory wrappers produce
 * real OpenAI and Anthropic SDK instances with expected interfaces.
 * CopilotClient is skipped since it requires a running Copilot process.
 */
import { describe, test, expect } from 'vitest'
import {
  createOpenAI,
  createAnthropic,
} from '../../L2-clients/llm/ai.js'

describe('E2E: ai.ts wrapper functions', () => {
  test('createOpenAI produces real OpenAI instance with chat API', () => {
    const client = createOpenAI({ apiKey: 'e2e-test-key' })
    expect(client).toBeDefined()
    // Real OpenAI SDK exposes chat.completions
    expect(client.chat).toBeDefined()
    expect(client.chat.completions).toBeDefined()
  })

  test('createAnthropic produces real Anthropic instance with messages API', () => {
    const client = createAnthropic({ apiKey: 'e2e-test-key' })
    expect(client).toBeDefined()
    // Real Anthropic SDK exposes messages
    expect(client.messages).toBeDefined()
  })

  test('OpenAI instance has expected namespace properties', () => {
    const client = createOpenAI({ apiKey: 'e2e-test-key' })
    expect(client.models).toBeDefined()
    expect(client.audio).toBeDefined()
  })
})

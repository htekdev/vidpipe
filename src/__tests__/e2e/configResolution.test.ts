/**
 * E2E — Config resolution end-to-end.
 *
 * No mocks. Tests that initConfig + getConfig work with real
 * globalConfig and environment. Validates the priority cascade.
 */
import { describe, test, expect, afterEach, vi } from 'vitest'
import { initConfig, getConfig } from '../../L1-infra/config/environment.js'

describe('E2E: config resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    initConfig()
  })

  test('CLI options override env vars', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    initConfig({ llmProvider: 'claude' })
    expect(getConfig().LLM_PROVIDER).toBe('claude')
  })

  test('env vars provide values when CLI is not set', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    initConfig({})
    expect(getConfig().LLM_PROVIDER).toBe('openai')
  })

  test('defaults apply when nothing is set', () => {
    vi.stubEnv('LLM_PROVIDER', '')
    initConfig({ llmProvider: undefined })
    // Falls through to global config or default ('copilot')
    const provider = getConfig().LLM_PROVIDER
    expect(typeof provider).toBe('string')
    expect(provider.length).toBeGreaterThan(0)
  })

  test('MODEL_OVERRIDES captures MODEL_* env vars', () => {
    vi.stubEnv('MODEL_BLOG_AGENT', 'custom-model')
    initConfig({})
    expect(getConfig().MODEL_OVERRIDES['MODEL_BLOG_AGENT']).toBe('custom-model')
  })

  test('FFMPEG_PATH has a fallback default', () => {
    initConfig({})
    expect(getConfig().FFMPEG_PATH).toBeTruthy()
  })

  test('empty CLI option prevents fallback to env var', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-pro')
    initConfig({ geminiModel: '' })
    expect(getConfig().GEMINI_MODEL).toBe('')
  })
})

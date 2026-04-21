/**
 * L3 Integration Test — configResolver → global config chain
 *
 * Mock boundary: L1 globalConfig (to control config file contents)
 * Real code:     L1 configResolver + L1 environment
 *
 * Validates that CLI options take priority over env vars and global config,
 * and that empty CLI strings are treated as explicit values.
 */
import { vi, describe, test, expect, afterEach } from 'vitest'

vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  loadGlobalConfig: () => ({
    credentials: {
      openaiApiKey: 'global-key',
      anthropicApiKey: 'global-anthropic',
      geminiApiKey: 'global-gemini',
    },
    defaults: {
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      geminiModel: 'gemini-2.5-pro',
    },
  }),
}))

import { initConfig, getConfig, validateRequiredKeys } from '../../../L1-infra/config/environment.js'

describe('L3 Integration: configResolver with global config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    initConfig()
  })

  test('CLI option openaiKey takes priority over global config', () => {
    initConfig({ openaiKey: 'cli-key' })
    expect(getConfig().OPENAI_API_KEY).toBe('cli-key')
  })

  test('global config provides fallback when CLI and env are not set', () => {
    initConfig({})
    expect(getConfig().OPENAI_API_KEY).toBe('global-key')
  })

  test('empty CLI option overrides global config (explicit empty)', () => {
    initConfig({ openaiKey: '' })
    expect(getConfig().OPENAI_API_KEY).toBe('')
  })

  test('validateRequiredKeys throws when CLI explicitly empties key', () => {
    initConfig({ openaiKey: '' })
    expect(() => validateRequiredKeys()).toThrow('Missing required: OPENAI_API_KEY')
  })

  test('validateRequiredKeys passes when global config has key', () => {
    initConfig({})
    expect(() => validateRequiredKeys()).not.toThrow()
  })

  test('CLI anthropicKey takes priority over global config', () => {
    initConfig({ anthropicKey: 'cli-anthropic' })
    expect(getConfig().ANTHROPIC_API_KEY).toBe('cli-anthropic')
  })

  test('CLI llmProvider takes priority over global config', () => {
    initConfig({ llmProvider: 'claude' })
    expect(getConfig().LLM_PROVIDER).toBe('claude')
  })

  test('MODEL_OVERRIDES populated from env vars', () => {
    vi.stubEnv('MODEL_SHORTS_AGENT', 'gpt-5-mini')
    initConfig({})
    expect(getConfig().MODEL_OVERRIDES['MODEL_SHORTS_AGENT']).toBe('gpt-5-mini')
  })
})

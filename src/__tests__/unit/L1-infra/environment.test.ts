import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initConfig, getConfig, validateRequiredKeys } from '../../../L1-infra/config/environment.js'

describe('getConfig environment consolidation', () => {
  beforeEach(() => {
    // Ensure fresh config each test
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('LLM_PROVIDER', '')
    vi.stubEnv('EXA_MCP_URL', '')
    initConfig()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('getConfig returns default values when no env vars set', () => {
    initConfig()
    const cfg = getConfig()

    expect(cfg.LLM_PROVIDER).toBe('copilot')
    expect(cfg.EXA_MCP_URL).toBe('https://mcp.exa.ai/mcp')
    expect(cfg.OPENAI_API_KEY).toBe('')
  })

  it('getConfig reads from env vars', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai')
    initConfig()

    expect(getConfig().LLM_PROVIDER).toBe('openai')
  })

  it('initConfig CLI options override env vars', () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-key')
    initConfig({ openaiKey: 'cli-key' })

    expect(getConfig().OPENAI_API_KEY).toBe('cli-key')
  })

  it('EXA_MCP_URL can be overridden via env var', () => {
    vi.stubEnv('EXA_MCP_URL', 'https://custom.mcp.url')
    initConfig()

    expect(getConfig().EXA_MCP_URL).toBe('https://custom.mcp.url')
  })

  it('SKIP_GIT is true when cli.git is false', () => {
    initConfig({ git: false })
    expect(getConfig().SKIP_GIT).toBe(true)
  })

  it('SKIP_GIT is false by default', () => {
    initConfig()
    expect(getConfig().SKIP_GIT).toBe(false)
  })

  it('SKIP_SILENCE_REMOVAL is true when cli.silenceRemoval is false', () => {
    initConfig({ silenceRemoval: false })
    expect(getConfig().SKIP_SILENCE_REMOVAL).toBe(true)
  })

  it('SKIP_SHORTS is true when cli.shorts is false', () => {
    initConfig({ shorts: false })
    expect(getConfig().SKIP_SHORTS).toBe(true)
  })

  it('SKIP_MEDIUM_CLIPS is true when cli.mediumClips is false', () => {
    initConfig({ mediumClips: false })
    expect(getConfig().SKIP_MEDIUM_CLIPS).toBe(true)
  })

  it('GEMINI_MODEL defaults to gemini-2.5-pro', () => {
    initConfig()
    expect(getConfig().GEMINI_MODEL).toBe('gemini-2.5-pro')
  })

  it('GEMINI_MODEL reads from env var', () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.0-flash')
    initConfig()
    expect(getConfig().GEMINI_MODEL).toBe('gemini-2.0-flash')
  })

  it('BRAND_PATH defaults to include brand.json', () => {
    initConfig()
    expect(getConfig().BRAND_PATH).toContain('brand.json')
  })

  it('BRAND_PATH can be set via CLI option', () => {
    initConfig({ brand: '/custom/brand.json' })
    expect(getConfig().BRAND_PATH).toBe('/custom/brand.json')
  })

  it('initConfig resets previously cached config', () => {
    initConfig({ openaiKey: 'first-key' })
    expect(getConfig().OPENAI_API_KEY).toBe('first-key')

    initConfig({ openaiKey: 'second-key' })
    expect(getConfig().OPENAI_API_KEY).toBe('second-key')
  })

  it('getConfig returns same object on repeated calls', () => {
    initConfig()
    const first = getConfig()
    const second = getConfig()
    expect(first).toBe(second)
  })

  it('validateRequiredKeys throws when OPENAI_API_KEY is missing', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    initConfig()
    expect(() => validateRequiredKeys()).toThrow('Missing required: OPENAI_API_KEY')
  })

  it('validateRequiredKeys does not throw when key is set via CLI', () => {
    initConfig({ openaiKey: 'my-key' })
    expect(() => validateRequiredKeys()).not.toThrow()
  })
})

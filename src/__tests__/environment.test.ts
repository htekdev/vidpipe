import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initConfig, getConfig } from '../config/environment.js'

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
})

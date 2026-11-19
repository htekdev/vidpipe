import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getModelForAgent,
  AGENT_MODEL_MAP,
  PREMIUM_MODEL,
} from '../../../L1-infra/config/modelConfig.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

beforeEach(() => {
  vi.stubEnv('MODEL_SHORTS_AGENT', '')
  initConfig({ llmProvider: 'copilot', llmModel: '' })
})

afterEach(() => {
  vi.unstubAllEnvs()
  initConfig()
})

describe('getModelForAgent', () => {
  it('modelConfig.REQ-001: selects GPT-6.1 Sol for every built-in Copilot agent', () => {
    for (const agentName of Object.keys(AGENT_MODEL_MAP)) {
      expect(getModelForAgent(agentName)).toBe('gpt-6.1-sol')
    }
  })

  it('returns undefined for unknown agents', () => {
    vi.stubEnv('LLM_MODEL', '')
    expect(getModelForAgent('UnknownAgent')).toBeUndefined()
  })

  it('env var override takes priority', () => {
    vi.stubEnv('MODEL_SHORTS_AGENT', 'GPT-5 mini')
    initConfig()
    expect(getModelForAgent('ShortsAgent')).toBe('GPT-5 mini')
  })

  it('LLM_MODEL env var serves as fallback for unknown agents', () => {
    vi.stubEnv('LLM_MODEL', 'custom-model')
    initConfig()
    expect(getModelForAgent('UnknownAgent')).toBe('custom-model')
  })

  it.each(['claude', 'openai'])('modelConfig.REQ-002: %s built-ins defer to the configured provider default', (provider) => {
    initConfig({ llmProvider: provider, llmModel: '' })
    for (const agentName of Object.keys(AGENT_MODEL_MAP)) {
      expect(getModelForAgent(agentName)).toBeUndefined()
    }
  })

  it('modelConfig.REQ-003: actual provider takes precedence over global provider selection', () => {
    expect(getModelForAgent('ShortsAgent', 'claude')).toBeUndefined()
    expect(getModelForAgent('ShortsAgent', 'openai')).toBeUndefined()
    initConfig({ llmProvider: 'claude', llmModel: '' })
    expect(getModelForAgent('ShortsAgent', 'copilot')).toBe('gpt-6.1-sol')
  })

  it.each(['copilot', 'claude', 'openai'])('modelConfig.REQ-004: preserves per-agent overrides for %s', (provider) => {
    vi.stubEnv('MODEL_SHORTS_AGENT', 'explicit-agent-model')
    initConfig({ llmProvider: provider, llmModel: 'global-model' })
    expect(getModelForAgent('ShortsAgent', provider)).toBe('explicit-agent-model')
  })

  it.each(['claude', 'openai'])('modelConfig.REQ-004: uses explicit global fallback for %s', (provider) => {
    initConfig({ llmProvider: provider, llmModel: 'explicit-global-model' })
    expect(getModelForAgent('ShortsAgent', provider)).toBe('explicit-global-model')
  })
})

describe('AGENT_MODEL_MAP tier assignments', () => {
  const premiumAgents = [
    'SilenceRemovalAgent', 'ShortsAgent', 'MediumVideoAgent',
    'SocialMediaAgent', 'BlogAgent',
    'SummaryAgent', 'ChapterAgent', 'ShortPostsAgent', 'MediumClipPostsAgent',
  ]

  it('all agents map to PREMIUM_MODEL', () => {
    for (const agent of premiumAgents) {
      expect(AGENT_MODEL_MAP[agent], `${agent} should be premium`).toBe(PREMIUM_MODEL)
    }
  })
})

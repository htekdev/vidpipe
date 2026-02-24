import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  getModelForAgent,
  AGENT_MODEL_MAP,
  PREMIUM_MODEL,
} from '../../../L1-infra/config/modelConfig.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

afterEach(() => {
  vi.unstubAllEnvs()
  initConfig()
})

describe('getModelForAgent', () => {
  it('returns correct model for each tier', () => {
    expect(getModelForAgent('ShortsAgent')).toBe('claude-opus-4.5')
    expect(getModelForAgent('BlogAgent')).toBe('claude-opus-4.5')
    expect(getModelForAgent('ChapterAgent')).toBe('claude-opus-4.5')
  })

  it('returns undefined for unknown agents', () => {
    vi.stubEnv('LLM_MODEL', '')
    expect(getModelForAgent('UnknownAgent')).toBeUndefined()
  })

  it('env var override takes priority', () => {
    vi.stubEnv('MODEL_SHORTS_AGENT', 'GPT-5 mini')
    expect(getModelForAgent('ShortsAgent')).toBe('GPT-5 mini')
  })

  it('LLM_MODEL env var serves as fallback for unknown agents', () => {
    vi.stubEnv('LLM_MODEL', 'custom-model')
    initConfig()
    expect(getModelForAgent('UnknownAgent')).toBe('custom-model')
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

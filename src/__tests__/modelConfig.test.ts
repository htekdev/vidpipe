import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  getModelForAgent,
  AGENT_MODEL_MAP,
  PREMIUM_MODEL,
  STANDARD_MODEL,
  FREE_MODEL,
} from '../config/modelConfig.js'
import { initConfig } from '../config/environment.js'

afterEach(() => {
  vi.unstubAllEnvs()
  initConfig()
})

describe('getModelForAgent', () => {
  it('returns correct model for each tier', () => {
    expect(getModelForAgent('ShortsAgent')).toBe('claude-opus-4.5')
    expect(getModelForAgent('BlogAgent')).toBe('claude-opus-4.5')
    expect(getModelForAgent('ChapterAgent')).toBe('gpt-4.1')
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
  const premiumAgents = ['SilenceRemovalAgent', 'ShortsAgent', 'MediumVideoAgent', 'BlogAgent']
  const standardAgents = ['SocialMediaAgent']
  const freeAgents = ['SummaryAgent', 'ChapterAgent', 'ShortPostsAgent', 'MediumClipPostsAgent']

  it('all premium agents map to PREMIUM_MODEL', () => {
    for (const agent of premiumAgents) {
      expect(AGENT_MODEL_MAP[agent], `${agent} should be premium`).toBe(PREMIUM_MODEL)
    }
  })

  it('all standard agents map to STANDARD_MODEL', () => {
    for (const agent of standardAgents) {
      expect(AGENT_MODEL_MAP[agent], `${agent} should be standard`).toBe(STANDARD_MODEL)
    }
  })

  it('all free agents map to FREE_MODEL', () => {
    for (const agent of freeAgents) {
      expect(AGENT_MODEL_MAP[agent], `${agent} should be free`).toBe(FREE_MODEL)
    }
  })
})

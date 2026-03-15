import { join } from 'node:path'

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mockLoadGlobalConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  loadGlobalConfig: mockLoadGlobalConfig,
}))

import type { GlobalConfig } from '../../../L1-infra/config/globalConfig.js'
import { resolveConfig } from '../../../L1-infra/config/configResolver.js'

const trackedEnvKeys = [
  'REPO_ROOT',
  'OPENAI_API_KEY',
  'OUTPUT_DIR',
  'WATCH_FOLDER',
  'BRAND_PATH',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'SKIP_GIT',
  'SKIP_SHORTS',
  'EXA_API_KEY',
  'YOUTUBE_API_KEY',
  'PERPLEXITY_API_KEY',
  'LATE_API_KEY',
  'LATE_PROFILE_ID',
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'IDEAS_REPO',
  'FFMPEG_PATH',
  'FFPROBE_PATH',
  'SKIP_SILENCE_REMOVAL',
  'SKIP_MEDIUM_CLIPS',
  'SKIP_SOCIAL',
  'SKIP_CAPTIONS',
  'SKIP_VISUAL_ENHANCEMENT',
  'SKIP_SOCIAL_PUBLISH',
] as const

const originalEnv = new Map<string, string | undefined>(
  trackedEnvKeys.map((key) => [key, process.env[key]]),
)

function restoreTrackedEnv(): void {
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }
}

function clearTrackedEnv(): void {
  for (const key of trackedEnvKeys) {
    delete process.env[key]
  }
}

function createGlobalConfig(overrides?: {
  credentials?: Partial<GlobalConfig['credentials']>
  defaults?: Partial<GlobalConfig['defaults']>
}): GlobalConfig {
  return {
    credentials: {
      openaiApiKey: 'global-openai',
      exaApiKey: 'global-exa',
      youtubeApiKey: 'global-youtube',
      perplexityApiKey: 'global-perplexity',
      lateApiKey: 'global-late',
      githubToken: 'global-github',
      anthropicApiKey: 'global-anthropic',
      geminiApiKey: 'global-gemini',
      ...overrides?.credentials,
    },
    defaults: {
      llmProvider: 'global-provider',
      llmModel: 'global-model',
      outputDir: 'C:\\global\\recordings',
      watchFolder: 'C:\\global\\watch',
      brandPath: 'C:\\global\\brand.json',
      ideasRepo: 'global\\ideas',
      lateProfileId: 'global-profile',
      geminiModel: 'global-gemini-model',
      ...overrides?.defaults,
    },
  }
}

describe('resolveConfig', () => {
  beforeEach(() => {
    mockLoadGlobalConfig.mockReset()
    mockLoadGlobalConfig.mockReturnValue(createGlobalConfig())
    clearTrackedEnv()
    vi.stubEnv('REPO_ROOT', 'C:\\repo-root')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    restoreTrackedEnv()
  })

  it('calls loadGlobalConfig and uses global values when CLI and env are absent', () => {
    const config = resolveConfig()

    expect(mockLoadGlobalConfig).toHaveBeenCalledTimes(1)
    expect(config.OPENAI_API_KEY).toBe('global-openai')
    expect(config.LATE_PROFILE_ID).toBe('global-profile')
    expect(config.LLM_PROVIDER).toBe('global-provider')
  })

  it('prefers CLI values over env vars and global config for strings', () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-openai')
    vi.stubEnv('OUTPUT_DIR', 'C:\\env\\recordings')

    const config = resolveConfig({
      openaiKey: 'cli-openai',
      outputDir: 'C:\\cli\\recordings',
    })

    expect(config.OPENAI_API_KEY).toBe('cli-openai')
    expect(config.OUTPUT_DIR).toBe('C:\\cli\\recordings')
  })

  it('prefers env vars over global config and defaults for strings', () => {
    mockLoadGlobalConfig.mockReturnValue(
      createGlobalConfig({
        defaults: {
          llmProvider: 'global-provider',
          outputDir: 'C:\\global\\recordings',
        },
      }),
    )
    vi.stubEnv('LLM_PROVIDER', 'env-provider')
    vi.stubEnv('OUTPUT_DIR', 'C:\\env\\recordings')

    const config = resolveConfig()

    expect(config.LLM_PROVIDER).toBe('env-provider')
    expect(config.OUTPUT_DIR).toBe('C:\\env\\recordings')
  })

  it('prefers global config values over hard-coded defaults for strings', () => {
    mockLoadGlobalConfig.mockReturnValue(
      createGlobalConfig({
        defaults: {
          llmProvider: 'global-provider',
          outputDir: 'C:\\global\\custom-recordings',
        },
      }),
    )

    const config = resolveConfig()

    expect(config.LLM_PROVIDER).toBe('global-provider')
    expect(config.OUTPUT_DIR).toBe('C:\\global\\custom-recordings')
  })

  it('resolves representative string keys from each source independently', () => {
    mockLoadGlobalConfig.mockReturnValue(
      createGlobalConfig({
        credentials: {
          openaiApiKey: undefined,
        },
        defaults: {
          outputDir: undefined,
          llmProvider: 'global-provider-only',
        },
      }),
    )
    vi.stubEnv('OUTPUT_DIR', 'C:\\env-only\\recordings')

    const config = resolveConfig({ openaiKey: 'cli-only-openai' })

    expect(config.OPENAI_API_KEY).toBe('cli-only-openai')
    expect(config.OUTPUT_DIR).toBe('C:\\env-only\\recordings')
    expect(config.LLM_PROVIDER).toBe('global-provider-only')
  })

  it('falls back through missing string sources to defaults or empty strings', () => {
    mockLoadGlobalConfig.mockReturnValue({
      credentials: {},
      defaults: {},
    })

    const config = resolveConfig()

    expect(config.OPENAI_API_KEY).toBe('')
    expect(config.OUTPUT_DIR).toBe(join('C:\\repo-root', 'recordings'))
    expect(config.WATCH_FOLDER).toBe(join('C:\\repo-root', 'watch'))
    expect(config.BRAND_PATH).toBe(join('C:\\repo-root', 'brand.json'))
    expect(config.LLM_PROVIDER).toBe('copilot')
    expect(config.GEMINI_MODEL).toBe('gemini-2.5-pro')
    expect(config.IDEAS_REPO).toBe('htekdev/content-management')
    expect(config.FFMPEG_PATH).toBe('ffmpeg')
    expect(config.FFPROBE_PATH).toBe('ffprobe')
  })

  it('inverts cli.git=false into SKIP_GIT=true', () => {
    vi.stubEnv('SKIP_GIT', 'false')

    const config = resolveConfig({ git: false })

    expect(config.SKIP_GIT).toBe(true)
  })

  it('inverts cli.git=true into SKIP_GIT=false', () => {
    vi.stubEnv('SKIP_GIT', 'true')

    const config = resolveConfig({ git: true })

    expect(config.SKIP_GIT).toBe(false)
  })

  it('uses env boolean values when CLI booleans are undefined', () => {
    vi.stubEnv('SKIP_GIT', 'true')

    const config = resolveConfig()

    expect(config.SKIP_GIT).toBe(true)
  })

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
    ['unexpected', false],
  ])('parses SKIP_GIT=%s as %s', (envValue, expected) => {
    vi.stubEnv('SKIP_GIT', envValue)

    const config = resolveConfig()

    expect(config.SKIP_GIT).toBe(expected)
  })

  it('uses default false for booleans when CLI and env values are absent', () => {
    const config = resolveConfig()

    expect(config.SKIP_GIT).toBe(false)
    expect(config.SKIP_SHORTS).toBe(false)
    expect(config.SKIP_SOCIAL_PUBLISH).toBe(false)
  })
})

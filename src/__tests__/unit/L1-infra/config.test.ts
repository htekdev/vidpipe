import { describe, it, expect, afterEach, vi } from 'vitest'
import { initConfig, getConfig, validateRequiredKeys } from '../../../L1-infra/config/environment.js'
import type { CLIOptions } from '../../../L1-infra/config/environment.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('initConfig', () => {
  it('CLI params override env vars', () => {
    vi.stubEnv('OPENAI_API_KEY', 'env-key')
    vi.stubEnv('OUTPUT_DIR', '/env/output')

    const cfg = initConfig({
      openaiKey: 'cli-key',
      outputDir: '/cli/output',
    })

    expect(cfg.OPENAI_API_KEY).toBe('cli-key')
    expect(cfg.OUTPUT_DIR).toBe('/cli/output')
  })

  it('defaults used when nothing provided', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    vi.stubEnv('OUTPUT_DIR', '')
    vi.stubEnv('WATCH_FOLDER', '')
    vi.stubEnv('FFMPEG_PATH', '')
    vi.stubEnv('FFPROBE_PATH', '')

    const cfg = initConfig({})

    expect(cfg.FFMPEG_PATH).toBe('ffmpeg')
    expect(cfg.FFPROBE_PATH).toBe('ffprobe')
    expect(cfg.VERBOSE).toBe(false)
    expect(cfg.SKIP_GIT).toBe(false)
    expect(cfg.SKIP_SILENCE_REMOVAL).toBe(false)
    expect(cfg.SKIP_SHORTS).toBe(false)
  })

  it('OPENAI_API_KEY from env used when no CLI param', () => {
    vi.stubEnv('OPENAI_API_KEY', 'from-env')

    const cfg = initConfig({})

    expect(cfg.OPENAI_API_KEY).toBe('from-env')
  })

  it('OUTPUT_DIR defaults to recordings under repo root', () => {
    vi.stubEnv('OUTPUT_DIR', '')

    const cfg = initConfig({})

    expect(cfg.OUTPUT_DIR).toContain('recordings')
  })

  it('SKIP_* flags honor CLI --no-* params', () => {
    const cfg = initConfig({
      silenceRemoval: false,
      shorts: false,
      social: false,
      captions: false,
      git: false,
      mediumClips: false,
    })

    expect(cfg.SKIP_SILENCE_REMOVAL).toBe(true)
    expect(cfg.SKIP_SHORTS).toBe(true)
    expect(cfg.SKIP_SOCIAL).toBe(true)
    expect(cfg.SKIP_CAPTIONS).toBe(true)
    expect(cfg.SKIP_GIT).toBe(true)
    expect(cfg.SKIP_MEDIUM_CLIPS).toBe(true)
  })

  it('VERBOSE flag from -v param', () => {
    const cfg = initConfig({ verbose: true })

    expect(cfg.VERBOSE).toBe(true)
  })
})

describe('Environment validation', () => {
  it('throws when OPENAI_API_KEY is missing', () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    initConfig({ openaiKey: '' })

    expect(() => validateRequiredKeys()).toThrow('Missing required: OPENAI_API_KEY')
  })

  it('FFMPEG_PATH has a default value', () => {
    const cfg = initConfig({})

    expect(cfg.FFMPEG_PATH).toBeTruthy()
  })
})

describe('getConfig', () => {
  it('returns previously initialized config', () => {
    const cfg = initConfig({ openaiKey: 'test-key-123' })
    const retrieved = getConfig()

    expect(retrieved.OPENAI_API_KEY).toBe('test-key-123')
    expect(retrieved).toEqual(cfg)
  })
})

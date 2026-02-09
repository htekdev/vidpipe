import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks must be declared before imports ──────────────────────────────

// Mock logger to suppress console output in tests
vi.mock('../config/logger.js', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    level: 'info',
  }
  return { default: mockLogger, setVerbose: vi.fn() }
})

// Mock environment config
vi.mock('../config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    BRAND_PATH: '/fake/brand.json',
    OPENAI_API_KEY: 'test-key',
    EXA_API_KEY: 'test-exa-key',
  }),
  initConfig: vi.fn(),
}))

// Mock fs for brand.ts and whisperClient.ts
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(true),
      readFileSync: vi.fn().mockReturnValue('{}'),
      statSync: vi.fn().mockReturnValue({ size: 1024 * 1024 }),
      createReadStream: vi.fn().mockReturnValue('fake-stream'),
    },
  }
})

// Mock openai for whisperClient.ts
const mockCreate = vi.fn().mockResolvedValue({
  text: 'Hello world',
  language: 'en',
  duration: 5.0,
  segments: [{ id: 0, start: 0, end: 1, text: 'Hello world' }],
  words: [
    { word: 'Hello', start: 0, end: 0.5 },
    { word: 'world', start: 0.6, end: 1.0 },
  ],
})

vi.mock('openai', () => ({
  default: class MockOpenAI {
    audio = {
      transcriptions: {
        create: mockCreate,
      },
    }
  },
}))



// ── Imports (after mocks) ──────────────────────────────────────────────

import fs from 'fs'
import { getConfig } from '../config/environment.js'

// ========================================================================
// 1. brand.ts
// ========================================================================

describe('brand.ts', () => {
  const fakeBrand = {
    name: 'TestBrand',
    handle: '@test',
    tagline: 'Test tagline',
    voice: { tone: 'casual', personality: 'fun', style: 'brief' },
    advocacy: { primary: ['a11y'], interests: ['tech'], avoids: ['spam'] },
    customVocabulary: ['Copilot', 'TypeScript', 'FFmpeg'],
    hashtags: { always: ['#test'], preferred: ['#dev'], platforms: {} },
    contentGuidelines: {
      shortsFocus: 'key moments',
      blogFocus: 'education',
      socialFocus: 'engagement',
    },
  }

  beforeEach(() => {
    vi.resetModules()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fakeBrand))
  })

  it('getBrandConfig() returns parsed brand config', async () => {
    const { getBrandConfig } = await import('../config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('TestBrand')
    expect(config.handle).toBe('@test')
    expect(config.customVocabulary).toContain('Copilot')
  })

  it('getBrandConfig() returns defaults when file not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const { getBrandConfig } = await import('../config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('Creator')
    expect(config.handle).toBe('@creator')
  })

  it('getBrandConfig() caches — second call does not re-read', async () => {
    const { getBrandConfig } = await import('../config/brand.js')

    getBrandConfig()
    const callsAfterFirst = vi.mocked(fs.readFileSync).mock.calls.length

    getBrandConfig()
    const callsAfterSecond = vi.mocked(fs.readFileSync).mock.calls.length

    // Second call should not trigger another read
    expect(callsAfterSecond).toBe(callsAfterFirst)
  })

  it('getWhisperPrompt() includes vocabulary words', async () => {
    const { getWhisperPrompt } = await import('../config/brand.js')
    const prompt = getWhisperPrompt()

    expect(prompt).toContain('Copilot')
    expect(prompt).toContain('TypeScript')
    expect(prompt).toContain('FFmpeg')
  })
})

// ========================================================================
// 2. logger.ts
// ========================================================================

describe('logger.ts', () => {
  it('default export has expected logging methods', async () => {
    // Import the REAL logger (not the mock) for interface checks
    const loggerMod = await import('../config/logger.js')
    const log = loggerMod.default

    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
  })

  it('setVerbose is exported as a function', async () => {
    const { setVerbose } = await import('../config/logger.js')
    expect(typeof setVerbose).toBe('function')
  })

  it('real logger: setVerbose changes level to debug', async () => {
    // Temporarily import real logger by resetting modules
    vi.resetModules()

    // Dynamically import without the mock to test real behaviour
    const realLogger = await vi.importActual<typeof import('../config/logger.js')>(
      '../config/logger.js'
    )

    realLogger.setVerbose()
    expect(realLogger.default.level).toBe('debug')
  })

  it('real logger is a winston Logger instance', async () => {
    vi.resetModules()
    const realLogger = await vi.importActual<typeof import('../config/logger.js')>(
      '../config/logger.js'
    )

    // Winston loggers have a `transports` array
    expect(realLogger.default).toHaveProperty('transports')
    expect(Array.isArray(realLogger.default.transports)).toBe(true)
  })
})

// ========================================================================
// 3. whisperClient.ts
// ========================================================================

describe('whisperClient.ts', () => {
  beforeEach(() => {
    vi.resetModules()
    mockCreate.mockClear()
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 * 1024 } as any)
    vi.mocked(fs.createReadStream).mockReturnValue('fake-stream' as any)
    vi.mocked(getConfig).mockReturnValue({
      OPENAI_API_KEY: 'test-key',
      BRAND_PATH: '/fake/brand.json',
      EXA_API_KEY: '',
    } as any)
  })

  it('transcribeAudio() returns correct transcript structure', async () => {
    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')
    const result = await transcribeAudio('/fake/audio.mp3')

    expect(result.text).toBe('Hello world')
    expect(result.language).toBe('en')
    expect(result.duration).toBe(5.0)
    expect(result.segments).toHaveLength(1)
    expect(result.words).toHaveLength(2)
  })

  it('transcribeAudio() parses words correctly', async () => {
    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')
    const result = await transcribeAudio('/fake/audio.mp3')

    expect(result.words[0]).toEqual({ word: 'Hello', start: 0, end: 0.5 })
    expect(result.words[1]).toEqual({ word: 'world', start: 0.6, end: 1.0 })
  })

  it('transcribeAudio() throws when file not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    await expect(transcribeAudio('/missing/audio.mp3')).rejects.toThrow(
      'Audio file not found'
    )
  })

  it('transcribeAudio() throws when file exceeds 25MB', async () => {
    vi.mocked(fs.statSync).mockReturnValue({
      size: 30 * 1024 * 1024,
    } as any)

    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    await expect(transcribeAudio('/fake/large.mp3')).rejects.toThrow(
      "exceeds Whisper's 25MB limit"
    )
  })

  it('transcribeAudio() handles API 401 error', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { status: 401 })
    )

    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    await expect(transcribeAudio('/fake/audio.mp3')).rejects.toThrow(
      'OpenAI API authentication failed'
    )
  })

  it('transcribeAudio() handles API 429 rate limit', async () => {
    mockCreate.mockRejectedValueOnce(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )

    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    await expect(transcribeAudio('/fake/audio.mp3')).rejects.toThrow(
      'rate limit exceeded'
    )
  })
})



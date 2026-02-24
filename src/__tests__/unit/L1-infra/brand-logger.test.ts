import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fileSystem for brand file reading
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExistsSync: vi.fn().mockReturnValue(true),
  readTextFileSync: vi.fn().mockReturnValue('{}'),
  getFileStatsSync: vi.fn(),
  openReadStream: vi.fn(),
}))

// Mock environment config
vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    BRAND_PATH: '/fake/brand.json',
    OPENAI_API_KEY: 'test-key',
    EXA_API_KEY: 'test-exa-key',
  }),
  initConfig: vi.fn(),
}))

import { fileExistsSync, readTextFileSync } from '../../../L1-infra/fileSystem/fileSystem.js'

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
    vi.mocked(fileExistsSync).mockReturnValue(true)
    vi.mocked(readTextFileSync).mockReturnValue(JSON.stringify(fakeBrand))
  })

  it('getBrandConfig() returns parsed brand config', async () => {
    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('TestBrand')
    expect(config.handle).toBe('@test')
    expect(config.customVocabulary).toContain('Copilot')
  })

  it('getBrandConfig() returns defaults when file not found', async () => {
    vi.mocked(fileExistsSync).mockReturnValue(false)

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('Creator')
    expect(config.handle).toBe('@creator')
  })

  it('getBrandConfig() caches — second call does not re-read', async () => {
    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')

    getBrandConfig()
    const callsAfterFirst = vi.mocked(readTextFileSync).mock.calls.length

    getBrandConfig()
    const callsAfterSecond = vi.mocked(readTextFileSync).mock.calls.length

    expect(callsAfterSecond).toBe(callsAfterFirst)
  })

  it('getWhisperPrompt() includes vocabulary words', async () => {
    const { getWhisperPrompt } = await import('../../../L1-infra/config/brand.js')
    const prompt = getWhisperPrompt()

    expect(prompt).toContain('Copilot')
    expect(prompt).toContain('TypeScript')
    expect(prompt).toContain('FFmpeg')
  })

  it('getBrandConfig() validates and warns for missing/empty fields', async () => {
    const partialBrand = {
      name: '',
      handle: '',
      tagline: '',
      customVocabulary: [],
      hashtags: { always: [], preferred: [] },
      contentGuidelines: { shortsFocus: '', blogFocus: '', socialFocus: '' },
    }
    vi.mocked(readTextFileSync).mockReturnValue(JSON.stringify(partialBrand))

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('')
    expect(config.customVocabulary).toEqual([])
  })

  it('getBrandConfig() validates and warns for missing sections', async () => {
    const minimalBrand = {
      name: 'Test',
      handle: '@t',
      tagline: 'tag',
      customVocabulary: ['word'],
    }
    vi.mocked(readTextFileSync).mockReturnValue(JSON.stringify(minimalBrand))

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('Test')
  })
})

describe('logger.ts', () => {
  it('default export has expected logging methods', async () => {
    const loggerMod = await import('../../../L1-infra/logger/configLogger.js')
    const log = loggerMod.default

    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
    expect(typeof log.debug).toBe('function')
  })

  it('setVerbose is exported as a function', async () => {
    const { setVerbose } = await import('../../../L1-infra/logger/configLogger.js')
    expect(typeof setVerbose).toBe('function')
  })

  it('real logger: setVerbose changes level to debug', async () => {
    vi.resetModules()

    const realLogger = await vi.importActual<typeof import('../../../L1-infra/logger/configLogger.js')>(
      '../../../L1-infra/logger/configLogger.js'
    )

    realLogger.setVerbose()
    expect(realLogger.default.level).toBe('debug')
  })

  it('real logger is a winston Logger instance', async () => {
    vi.resetModules()
    const realLogger = await vi.importActual<typeof import('../../../L1-infra/logger/configLogger.js')>(
      '../../../L1-infra/logger/configLogger.js'
    )

    expect(realLogger.default).toHaveProperty('transports')
    expect(Array.isArray(realLogger.default.transports)).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadFileSync = vi.hoisted(() => vi.fn())
const mockWriteFileSync = vi.hoisted(() => vi.fn())
const mockMkdirSync = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockChmodSync = vi.hoisted(() => vi.fn())
const mockUnlinkSync = vi.hoisted(() => vi.fn())
const mockHomedir = vi.hoisted(() => vi.fn())
const mockJoin = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
  chmodSync: mockChmodSync,
  unlinkSync: mockUnlinkSync,
}))

vi.mock('node:os', () => ({
  homedir: mockHomedir,
}))

vi.mock('node:path', () => ({
  join: mockJoin,
}))

import {
  getConfigPath,
  getGlobalConfigValue,
  loadGlobalConfig,
  maskSecret,
  resetGlobalConfig,
  saveGlobalConfig,
  setGlobalConfigValue,
} from '../../../L1-infra/config/globalConfig.js'
import type { GlobalConfig } from '../../../L1-infra/config/globalConfig.js'

const originalPlatform = process.platform

function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { value })
}

function setExistingPaths(paths: readonly string[]): void {
  const existing = new Set(paths)
  mockExistsSync.mockImplementation((path: unknown) => existing.has(String(path)))
}

function getWriteCall(path: string): [string, string, string] | undefined {
  return mockWriteFileSync.mock.calls.find(([writtenPath]) => writtenPath === path) as [string, string, string] | undefined
}

beforeEach(() => {
  vi.unstubAllEnvs()
  setPlatform(originalPlatform)

  mockReadFileSync.mockReset()
  mockWriteFileSync.mockReset()
  mockMkdirSync.mockReset()
  mockExistsSync.mockReset()
  mockChmodSync.mockReset()
  mockUnlinkSync.mockReset()
  mockHomedir.mockReset()
  mockJoin.mockReset()

  mockHomedir.mockReturnValue('/home/tester')
  mockJoin.mockImplementation((...parts: unknown[]) => parts.map(String).join('/'))
  mockExistsSync.mockReturnValue(false)
})

afterEach(() => {
  vi.unstubAllEnvs()
  setPlatform(originalPlatform)
  vi.restoreAllMocks()
})

describe('getConfigPath', () => {
  it('returns the override path when VIDPIPE_CONFIG_DIR is set', () => {
    vi.stubEnv('VIDPIPE_CONFIG_DIR', '/custom/vidpipe')
    setPlatform('linux')

    expect(getConfigPath()).toBe('/custom/vidpipe/config.json')
  })

  it('uses APPDATA on win32 when no override is set', () => {
    vi.stubEnv('APPDATA', 'C:/Users/tester/AppData/Roaming')
    setPlatform('win32')

    expect(getConfigPath()).toBe('C:/Users/tester/AppData/Roaming/vidpipe/config.json')
  })

  it('falls back to homedir based config path on non-win32 platforms', () => {
    setPlatform('linux')

    expect(getConfigPath()).toBe('/home/tester/.config/vidpipe/config.json')
  })
})

describe('loadGlobalConfig', () => {
  it('returns an empty config when the file does not exist', () => {
    mockExistsSync.mockReturnValue(false)

    expect(loadGlobalConfig()).toEqual({ credentials: {}, defaults: {} })
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('parses valid JSON and keeps only string values in each section', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      credentials: {
        openaiApiKey: 'openai-key',
        githubToken: 'gh-token',
        ignoredNumber: 123,
      },
      defaults: {
        llmProvider: 'openai',
        outputDir: '/tmp/output',
        ignoredObject: { nested: true },
      },
    }))

    expect(loadGlobalConfig()).toEqual({
      credentials: {
        openaiApiKey: 'openai-key',
        githubToken: 'gh-token',
      },
      defaults: {
        llmProvider: 'openai',
        outputDir: '/tmp/output',
      },
    })
  })

  it('returns an empty config when the file contains invalid JSON', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue('{invalid json')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(loadGlobalConfig()).toEqual({ credentials: {}, defaults: {} })
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})

describe('saveGlobalConfig', () => {
  const config: GlobalConfig = {
    credentials: { openaiApiKey: 'openai-key' },
    defaults: { llmProvider: 'openai' },
  }

  it('creates the config directory, writes the config and README, and chmods on unix', () => {
    setPlatform('linux')
    setExistingPaths([])

    saveGlobalConfig(config)

    expect(mockMkdirSync).toHaveBeenCalledWith('/home/tester/.config/vidpipe', { recursive: true })
    expect(getWriteCall('/home/tester/.config/vidpipe/README.txt')).toEqual([
      '/home/tester/.config/vidpipe/README.txt',
      [
        'This directory stores vidpipe global configuration, including API credentials.',
        'Do not share, commit, or send these files to anyone you do not trust.',
        'Keep this directory private.',
        '',
      ].join('\n'),
      'utf8',
    ])
    expect(getWriteCall('/home/tester/.config/vidpipe/config.json')).toEqual([
      '/home/tester/.config/vidpipe/config.json',
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    ])
    expect(mockChmodSync).toHaveBeenCalledWith('/home/tester/.config/vidpipe/config.json', 0o600)
  })

  it('skips chmod and README creation when saving on win32 to an existing directory', () => {
    vi.stubEnv('APPDATA', 'C:/Users/tester/AppData/Roaming')
    setPlatform('win32')
    setExistingPaths(['C:/Users/tester/AppData/Roaming/vidpipe'])

    saveGlobalConfig(config)

    expect(mockMkdirSync).not.toHaveBeenCalled()
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1)
    expect(getWriteCall('C:/Users/tester/AppData/Roaming/vidpipe/config.json')).toEqual([
      'C:/Users/tester/AppData/Roaming/vidpipe/config.json',
      `${JSON.stringify(config, null, 2)}\n`,
      'utf8',
    ])
    expect(mockChmodSync).not.toHaveBeenCalled()
  })
})

describe('getGlobalConfigValue', () => {
  it('reads a value from the credentials section', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      credentials: { openaiApiKey: 'secret-key' },
      defaults: {},
    }))

    expect(getGlobalConfigValue('credentials', 'openaiApiKey')).toBe('secret-key')
  })

  it('reads a value from the defaults section', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      credentials: {},
      defaults: { outputDir: '/tmp/output' },
    }))

    expect(getGlobalConfigValue('defaults', 'outputDir')).toBe('/tmp/output')
  })

  it('returns undefined for a missing key', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      credentials: {},
      defaults: {},
    }))

    expect(getGlobalConfigValue('defaults', 'missingKey')).toBeUndefined()
  })
})

describe('setGlobalConfigValue', () => {
  it('stores credential values under the credentials section', () => {
    setPlatform('linux')
    setExistingPaths(['/home/tester/.config/vidpipe'])

    setGlobalConfigValue('credentials', 'openaiApiKey', 'secret-key')

    const configWrite = getWriteCall('/home/tester/.config/vidpipe/config.json')
    expect(configWrite).toBeDefined()
    expect(JSON.parse(configWrite![1])).toEqual({
      credentials: { openaiApiKey: 'secret-key' },
      defaults: {},
    })
  })

  it('stores default values under the defaults section', () => {
    setPlatform('linux')
    setExistingPaths(['/home/tester/.config/vidpipe'])

    setGlobalConfigValue('defaults', 'outputDir', '/tmp/output')

    const configWrite = getWriteCall('/home/tester/.config/vidpipe/config.json')
    expect(configWrite).toBeDefined()
    expect(JSON.parse(configWrite![1])).toEqual({
      credentials: {},
      defaults: { outputDir: '/tmp/output' },
    })
  })
})

describe('resetGlobalConfig', () => {
  it('deletes the config file when it exists', () => {
    setPlatform('linux')
    setExistingPaths(['/home/tester/.config/vidpipe/config.json'])

    resetGlobalConfig()

    expect(mockUnlinkSync).toHaveBeenCalledWith('/home/tester/.config/vidpipe/config.json')
  })

  it('does nothing when the config file does not exist', () => {
    setPlatform('linux')
    setExistingPaths([])

    resetGlobalConfig()

    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })
})

describe('GlobalDefaults accepts scheduleConfig', () => {
  it('stores and retrieves scheduleConfig from the defaults section', () => {
    setPlatform('linux')
    setExistingPaths(['/home/tester/.config/vidpipe'])

    setGlobalConfigValue('defaults', 'scheduleConfig', '/custom/schedule.json')

    const configWrite = getWriteCall('/home/tester/.config/vidpipe/config.json')
    expect(configWrite).toBeDefined()
    expect(JSON.parse(configWrite![1])).toEqual({
      credentials: {},
      defaults: { scheduleConfig: '/custom/schedule.json' },
    })
  })

  it('reads scheduleConfig from a saved config file', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      credentials: {},
      defaults: { scheduleConfig: '/shared/schedule.json' },
    }))

    expect(getGlobalConfigValue('defaults', 'scheduleConfig')).toBe('/shared/schedule.json')
  })
})

describe('maskSecret', () => {
  it('returns a fixed mask for short values', () => {
    expect(maskSecret('short-key')).toBe('****')
  })

  it('reveals only the first eight and last four characters for long values', () => {
    expect(maskSecret('12345678abcdefghZZZZ')).toBe('12345678...ZZZZ')
  })
})

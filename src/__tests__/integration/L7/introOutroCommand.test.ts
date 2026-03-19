import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockQuestion = vi.hoisted(() => vi.fn().mockResolvedValue(''))
const mockClose = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ BRAND_PATH: '/repo/brand.json', SKIP_INTRO_OUTRO: false }),
  initConfig: vi.fn(),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  resolve: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('../../../L1-infra/readline/readlinePromises.js', () => ({
  createPromptInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}))

import { runIntroOutro } from '../../../L7-app/commands/introOutro.js'

describe('intro-outro CLI integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadJsonFile.mockResolvedValue({
      name: 'Test',
      introOutro: { enabled: false, fadeDuration: 0.5, intro: { default: './intro.mp4' }, outro: { default: './outro.mp4' } },
    })
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockFileExists.mockResolvedValue(true)
    mockQuestion.mockResolvedValue('')
    process.exitCode = undefined
  })

  test('enable → set-intro → set-fade → show flow works', async () => {
    await runIntroOutro('enable')
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({ enabled: true }),
    }))
    await runIntroOutro('set-intro', ['./assets/new-intro.mp4'])
    await runIntroOutro('set-fade', ['1.0'])
    await runIntroOutro('show')
  })

  test('set-rule updates video type rules', async () => {
    await runIntroOutro('set-rule', ['shorts', 'intro', 'on'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        rules: expect.objectContaining({ shorts: expect.objectContaining({ intro: true }) }),
      }),
    }))
  })

  test('set-rule both off disables both toggles', async () => {
    await runIntroOutro('set-rule', ['main', 'both', 'off'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        rules: expect.objectContaining({ main: { intro: false, outro: false } }),
      }),
    }))
  })

  test('set-intro-ratio and set-outro-ratio set aspect ratio files', async () => {
    await runIntroOutro('set-intro-ratio', ['9:16', './intro-portrait.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        intro: expect.objectContaining({ aspectRatios: expect.objectContaining({ '9:16': './intro-portrait.mp4' }) }),
      }),
    }))

    vi.clearAllMocks()
    mockReadJsonFile.mockResolvedValue({ name: 'Test', introOutro: { enabled: true, fadeDuration: 0, outro: { default: './outro.mp4' } } })
    mockWriteJsonFile.mockResolvedValue(undefined)

    await runIntroOutro('set-outro-ratio', ['1:1', './outro-square.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        outro: expect.objectContaining({ aspectRatios: expect.objectContaining({ '1:1': './outro-square.mp4' }) }),
      }),
    }))
  })

  test('set-intro and set-outro with --platform flag', async () => {
    await runIntroOutro('set-intro', ['./intro-yt.mp4', '--platform', 'youtube'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        intro: expect.objectContaining({ platforms: expect.objectContaining({ youtube: './intro-yt.mp4' }) }),
      }),
    }))

    vi.clearAllMocks()
    mockReadJsonFile.mockResolvedValue({ name: 'Test', introOutro: { enabled: true, fadeDuration: 0, outro: { default: './outro.mp4' } } })
    mockWriteJsonFile.mockResolvedValue(undefined)

    await runIntroOutro('set-outro', ['./outro-tt.mp4', '--platform', 'tiktok'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        outro: expect.objectContaining({ platforms: expect.objectContaining({ tiktok: './outro-tt.mp4' }) }),
      }),
    }))
  })

  test('wizard with default answers saves config', async () => {
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  test('wizard with explicit enable and custom paths', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return 'y'                    // enable
      if (callCount === 2) return './my-intro.mp4'        // intro path
      if (callCount === 3) return './my-outro.mp4'        // outro path
      if (callCount === 4) return '1.0'                   // fade
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({
        enabled: true,
        fadeDuration: 1.0,
        intro: expect.objectContaining({ default: './my-intro.mp4' }),
        outro: expect.objectContaining({ default: './my-outro.mp4' }),
      }),
    }))
  })

  test('wizard with platform-specific file setup', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // Q11 = "Set platform-specific files? (y/N)"
      if (callCount === 11) return 'y'
      // Q12 = tiktok intro path
      if (callCount === 12) return './intro-tt.mp4'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
  })

  test('wizard with aspect-ratio-specific file setup', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // After platform question (N), aspect ratio question
      if (callCount === 12) return 'y'
      if (callCount === 13) return './intro-portrait.mp4'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
  })

  test('wizard with invalid fade corrects to 0.5', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      if (callCount === 4) return 'notanumber'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalledWith('/repo/brand.json', expect.objectContaining({
      introOutro: expect.objectContaining({ fadeDuration: 0.5 }),
    }))
  })

  test('wizard when intro file does not exist shows warning', async () => {
    mockFileExists.mockResolvedValue(false)
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
  })

  test('help and unknown subcommands', async () => {
    await runIntroOutro('help')
    expect(process.exitCode).toBeUndefined()

    await runIntroOutro('--help')
    expect(process.exitCode).toBeUndefined()
  })

  test('set-rule with invalid args sets exit code', async () => {
    await runIntroOutro('set-rule', [])
    expect(process.exitCode).toBe(1)
  })

  test('set-rule with invalid video type sets exit code', async () => {
    await runIntroOutro('set-rule', ['invalid', 'intro', 'on'])
    expect(process.exitCode).toBe(1)
  })

  test('set-rule with invalid target sets exit code', async () => {
    await runIntroOutro('set-rule', ['main', 'invalid', 'on'])
    expect(process.exitCode).toBe(1)
  })

  test('set-intro-ratio with invalid ratio sets exit code', async () => {
    await runIntroOutro('set-intro-ratio', ['3:2', './file.mp4'])
    expect(process.exitCode).toBe(1)
  })

  test('set-intro-ratio with missing args sets exit code', async () => {
    await runIntroOutro('set-intro-ratio', [])
    expect(process.exitCode).toBe(1)
  })

  test('set-outro-ratio with missing args sets exit code', async () => {
    await runIntroOutro('set-outro-ratio', [])
    expect(process.exitCode).toBe(1)
  })

  test('set-intro with no args sets exit code', async () => {
    await runIntroOutro('set-intro', [])
    expect(process.exitCode).toBe(1)
  })

  test('set-outro with no args sets exit code', async () => {
    await runIntroOutro('set-outro', [])
    expect(process.exitCode).toBe(1)
  })

  test('set-fade with invalid value sets exit code', async () => {
    await runIntroOutro('set-fade', ['-5'])
    expect(process.exitCode).toBe(1)
  })
})

/**
 * L7 Unit Test — intro-outro CLI command
 *
 * Mocks: L1 infra only (fileSystem, config, paths, readline).
 * Logger is auto-mocked by global setup.
 * Tests subcommand dispatch and brand.json mutation logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockConsoleLog = vi.hoisted(() => vi.fn())
const mockConsoleError = vi.hoisted(() => vi.fn())
const mockQuestion = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
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

describe('L7 Unit: intro-outro command', () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    vi.clearAllMocks()
    process.exitCode = undefined
    vi.spyOn(console, 'log').mockImplementation(mockConsoleLog)
    vi.spyOn(console, 'error').mockImplementation(mockConsoleError)

    mockGetConfig.mockReturnValue({ BRAND_PATH: '/repo/brand.json' })
    mockReadJsonFile.mockResolvedValue({
      name: 'TestBrand',
      introOutro: { enabled: false, fadeDuration: 0.5 },
    })
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockFileExists.mockResolvedValue(false)
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    vi.restoreAllMocks()
  })

  it('show subcommand displays config without error', async () => {
    await runIntroOutro('show')
    expect(mockConsoleLog).toHaveBeenCalled()
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('enable subcommand sets enabled to true and saves', async () => {
    await runIntroOutro('enable')
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({ enabled: true }),
      }),
    )
  })

  it('disable subcommand sets enabled to false and saves', async () => {
    mockReadJsonFile.mockResolvedValue({
      name: 'TestBrand',
      introOutro: { enabled: true, fadeDuration: 0.5 },
    })

    await runIntroOutro('disable')
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({ enabled: false }),
      }),
    )
  })

  it('set-fade subcommand updates fadeDuration', async () => {
    await runIntroOutro('set-fade', ['1.5'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({ fadeDuration: 1.5 }),
      }),
    )
  })

  it('set-fade rejects negative values', async () => {
    await runIntroOutro('set-fade', ['-1'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-intro subcommand updates default intro path', async () => {
    await runIntroOutro('set-intro', ['./assets/my-intro.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          intro: expect.objectContaining({ default: './assets/my-intro.mp4' }),
        }),
      }),
    )
  })

  it('set-intro without path sets exitCode 1', async () => {
    await runIntroOutro('set-intro', [])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-outro subcommand updates default outro path', async () => {
    await runIntroOutro('set-outro', ['./assets/my-outro.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          outro: expect.objectContaining({ default: './assets/my-outro.mp4' }),
        }),
      }),
    )
  })

  it('unknown subcommand sets exitCode 1', async () => {
    await runIntroOutro('nonexistent')
    expect(process.exitCode).toBe(1)
  })

  // ── set-intro / set-outro with --platform ─────────────────────────────────

  it('set-intro with --platform sets platform-specific path', async () => {
    await runIntroOutro('set-intro', ['./intro-yt.mp4', '--platform', 'youtube'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          intro: expect.objectContaining({
            platforms: expect.objectContaining({ youtube: './intro-yt.mp4' }),
          }),
        }),
      }),
    )
  })

  it('set-outro with --platform sets platform-specific path', async () => {
    await runIntroOutro('set-outro', ['./outro-ig.mp4', '--platform', 'instagram'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          outro: expect.objectContaining({
            platforms: expect.objectContaining({ instagram: './outro-ig.mp4' }),
          }),
        }),
      }),
    )
  })

  it('set-outro with no args sets exit code', async () => {
    await runIntroOutro('set-outro', [])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  // ── set-rule ──────────────────────────────────────────────────────────────

  it('set-rule sets intro toggle for video type', async () => {
    await runIntroOutro('set-rule', ['shorts', 'intro', 'on'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          rules: expect.objectContaining({
            shorts: expect.objectContaining({ intro: true }),
          }),
        }),
      }),
    )
  })

  it('set-rule both sets both toggles', async () => {
    await runIntroOutro('set-rule', ['main', 'both', 'off'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          rules: expect.objectContaining({
            main: { intro: false, outro: false },
          }),
        }),
      }),
    )
  })

  it('set-rule with invalid video type sets exit code', async () => {
    await runIntroOutro('set-rule', ['invalid', 'intro', 'on'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-rule with missing args sets exit code', async () => {
    await runIntroOutro('set-rule', [])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-rule with invalid target sets exit code', async () => {
    await runIntroOutro('set-rule', ['main', 'invalid', 'on'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-rule with invalid value (not on/off) sets exit code', async () => {
    await runIntroOutro('set-rule', ['main', 'intro', 'maybe'])
    expect(process.exitCode).toBe(1)
  })

  // ── set-intro-ratio / set-outro-ratio ─────────────────────────────────────

  it('set-intro-ratio sets aspect ratio file', async () => {
    await runIntroOutro('set-intro-ratio', ['9:16', './intro-portrait.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          intro: expect.objectContaining({
            aspectRatios: expect.objectContaining({ '9:16': './intro-portrait.mp4' }),
          }),
        }),
      }),
    )
  })

  it('set-outro-ratio sets aspect ratio file', async () => {
    await runIntroOutro('set-outro-ratio', ['1:1', './outro-square.mp4'])
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({
          outro: expect.objectContaining({
            aspectRatios: expect.objectContaining({ '1:1': './outro-square.mp4' }),
          }),
        }),
      }),
    )
  })

  it('set-intro-ratio with invalid ratio sets exit code', async () => {
    await runIntroOutro('set-intro-ratio', ['3:2', './file.mp4'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-intro-ratio with missing args sets exit code', async () => {
    await runIntroOutro('set-intro-ratio', [])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-outro-ratio with invalid ratio sets exit code', async () => {
    await runIntroOutro('set-outro-ratio', ['3:2', './file.mp4'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  it('set-outro-ratio with missing args sets exit code', async () => {
    await runIntroOutro('set-outro-ratio', [])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  // ── set-fade additional edge cases ────────────────────────────────────────

  it('set-fade with non-number sets exit code', async () => {
    await runIntroOutro('set-fade', ['abc'])
    expect(process.exitCode).toBe(1)
    expect(mockWriteJsonFile).not.toHaveBeenCalled()
  })

  // ── help ──────────────────────────────────────────────────────────────────

  it('help subcommand runs without error', async () => {
    await runIntroOutro('help')
    expect(process.exitCode).toBeUndefined()
    expect(mockConsoleLog).toHaveBeenCalled()
  })

  // ── Interactive wizard ────────────────────────────────────────────────────

  it('wizard runs without error with default answers', async () => {
    mockQuestion.mockResolvedValue('')
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('wizard accepts explicit yes/no answers', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // First question is "enable intro/outro?" — answer 'y'
      if (callCount === 1) return 'y'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({ enabled: true }),
      }),
    )
  })

  it('wizard handles platform-specific file setup', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // Question 11 is "Set platform-specific files? (y/N)"
      if (callCount === 11) return 'y'
      // Platform questions return empty (use default / skip)
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('wizard handles aspect-ratio-specific file setup', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // Question 12 (after platform='N') is "Set aspect-ratio-specific files?"
      if (callCount === 12) return 'y'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  it('wizard corrects invalid fade duration', async () => {
    let callCount = 0
    mockQuestion.mockImplementation(async () => {
      callCount++
      // Question 4 is fade duration
      if (callCount === 4) return 'notanumber'
      return ''
    })
    await runIntroOutro(undefined)
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      '/repo/brand.json',
      expect.objectContaining({
        introOutro: expect.objectContaining({ fadeDuration: 0.5 }),
      }),
    )
  })
})

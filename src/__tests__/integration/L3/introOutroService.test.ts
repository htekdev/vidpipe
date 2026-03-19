import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockFileExists = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockGetIntroOutroConfig = vi.hoisted(() => vi.fn())
const mockExecCommand = vi.hoisted(() => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }))
const mockEnsureDirectory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockWriteTextFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// L3 integration: mock only L1 — L2 runs real (backed by mocked L1 infra)
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  ensureDirectory: mockEnsureDirectory,
  writeTextFile: mockWriteTextFile,
  removeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L1-infra/process/process.js', () => ({
  execCommand: mockExecCommand,
  createModuleRequire: () => () => null,
  execFileRaw: vi.fn(),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getIntroOutroConfig: mockGetIntroOutroConfig,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  resolve: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  join: (...args: string[]) => args.join('/'),
}))

import { applyIntroOutro } from '../../../L3-services/introOutro/introOutroService.js'

describe('introOutro L3 integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ SKIP_INTRO_OUTRO: false, BRAND_PATH: '/repo/brand.json' })
    mockGetIntroOutroConfig.mockReturnValue({
      enabled: true,
      fadeDuration: 0.5,
      intro: { default: './assets/intro.mp4' },
      outro: { default: './assets/outro.mp4' },
      rules: { main: { intro: true, outro: true } },
    })
    mockFileExists.mockResolvedValue(true)
    mockExecCommand.mockImplementation(async (_cmd: string, args: string[]) => {
      // Handle ffprobe calls for getVideoProperties (JSON output)
      if (args && args.includes('-of') && args.includes('json')) {
        return {
          stdout: JSON.stringify({ streams: [{ width: 1920, height: 1080, r_frame_rate: '30/1' }] }),
          stderr: '',
        }
      }
      // Handle ffprobe calls for getVideoDuration (csv output)
      if (args && args.includes('format=duration')) {
        return { stdout: '5.0\n', stderr: '' }
      }
      // FFmpeg encode/concat calls
      return { stdout: '', stderr: '' }
    })
  })

  test('full intro+outro flow exercises L2 videoConcat via L1 execCommand', async () => {
    const result = await applyIntroOutro('/video/captioned.mp4', 'main', '/video/intro-outro.mp4')
    expect(result).toBe('/video/intro-outro.mp4')
    expect(mockExecCommand).toHaveBeenCalled()
  })

  test('skips when disabled, no L2 calls made', async () => {
    mockGetConfig.mockReturnValue({ SKIP_INTRO_OUTRO: true, BRAND_PATH: '/repo/brand.json' })
    const result = await applyIntroOutro('/video.mp4', 'main', '/out.mp4')
    expect(result).toBe('/video.mp4')
    expect(mockExecCommand).not.toHaveBeenCalled()
  })

  test('only outro normalized when intro disabled in rules', async () => {
    mockGetIntroOutroConfig.mockReturnValue({
      enabled: true, fadeDuration: 0,
      intro: { default: './assets/intro.mp4' },
      outro: { default: './assets/outro.mp4' },
      rules: { shorts: { intro: false, outro: true } },
    })
    await applyIntroOutro('/short/media.mp4', 'shorts', '/short/out.mp4')
    expect(mockExecCommand).toHaveBeenCalled()
  })
})

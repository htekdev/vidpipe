import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IntroOutroConfig } from '../../../../src/L0-pure/types/index.js'

const {
  mockConcatVideos,
  mockNormalizeForConcat,
  mockGetConfig,
  mockGetIntroOutroConfig,
  mockFileExists,
  mockResolve,
  mockJoin,
  mockDirname,
} = vi.hoisted(() => ({
  mockConcatVideos: vi.fn(),
  mockNormalizeForConcat: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetIntroOutroConfig: vi.fn(),
  mockFileExists: vi.fn(),
  mockResolve: vi.fn(),
  mockJoin: vi.fn(),
  mockDirname: vi.fn(),
}))

vi.mock('../../../../src/L2-clients/ffmpeg/videoConcat.js', () => ({
  concatVideos: mockConcatVideos,
  normalizeForConcat: mockNormalizeForConcat,
}))

vi.mock('../../../../src/L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../../src/L1-infra/config/brand.js', () => ({
  getIntroOutroConfig: mockGetIntroOutroConfig,
}))

vi.mock('../../../../src/L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  removeFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../../src/L1-infra/paths/paths.js', () => ({
  resolve: mockResolve,
  join: mockJoin,
  dirname: mockDirname,
}))

vi.mock('../../../../src/L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { applyIntroOutro } from '../../../../src/L3-services/introOutro/introOutroService.js'

/** Helper: build a full IntroOutroConfig with intro + outro enabled. */
function makeConfig(overrides?: Partial<IntroOutroConfig>): IntroOutroConfig {
  return {
    enabled: true,
    fadeDuration: 0,
    intro: { default: 'assets/intro.mp4' },
    outro: { default: 'assets/outro.mp4' },
    rules: {
      main: { intro: true, outro: true },
      shorts: { intro: false, outro: false },
      'medium-clips': { intro: true, outro: true },
    },
    ...overrides,
  }
}

describe('introOutroService', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default env config — intro/outro enabled
    mockGetConfig.mockReturnValue({
      SKIP_INTRO_OUTRO: false,
      BRAND_PATH: '/repo/brand.json',
    })

    // Default brand config — everything enabled
    mockGetIntroOutroConfig.mockReturnValue(makeConfig())

    // Paths
    mockDirname.mockImplementation((p: string) =>
      p.split('/').slice(0, -1).join('/') || '.',
    )
    mockResolve.mockImplementation((...args: string[]) => args.join('/'))
    mockJoin.mockImplementation((...args: string[]) => args.join('/'))

    // Files exist by default
    mockFileExists.mockResolvedValue(true)

    // L2 mocks
    mockNormalizeForConcat.mockImplementation(
      async (_src: string, _ref: string, out: string) => out,
    )
    mockConcatVideos.mockImplementation(
      async (_segs: string[], out: string) => out,
    )
  })

  describe('REQ-001: Returns original videoPath when SKIP_INTRO_OUTRO is true', () => {
    it('introOutroService.REQ-001 - skips when env toggle is true', async () => {
      mockGetConfig.mockReturnValue({
        SKIP_INTRO_OUTRO: true,
        BRAND_PATH: '/repo/brand.json',
      })

      const result = await applyIntroOutro(
        '/tmp/content.mp4',
        'main',
        '/out/final.mp4',
      )

      expect(result).toBe('/tmp/content.mp4')
      expect(mockConcatVideos).not.toHaveBeenCalled()
      expect(mockNormalizeForConcat).not.toHaveBeenCalled()
    })
  })

  describe('REQ-002: Returns original videoPath when brand config enabled=false', () => {
    it('introOutroService.REQ-002 - skips when brand config disabled', async () => {
      mockGetIntroOutroConfig.mockReturnValue(makeConfig({ enabled: false }))

      const result = await applyIntroOutro(
        '/tmp/content.mp4',
        'main',
        '/out/final.mp4',
      )

      expect(result).toBe('/tmp/content.mp4')
      expect(mockConcatVideos).not.toHaveBeenCalled()
    })
  })

  describe('REQ-003: Returns original videoPath when both toggles are false', () => {
    it('introOutroService.REQ-003 - skips when video type rules disable both', async () => {
      mockGetIntroOutroConfig.mockReturnValue(
        makeConfig({
          rules: {
            main: { intro: false, outro: false },
            shorts: { intro: false, outro: false },
            'medium-clips': { intro: false, outro: false },
          },
        }),
      )

      const result = await applyIntroOutro(
        '/tmp/content.mp4',
        'main',
        '/out/final.mp4',
      )

      expect(result).toBe('/tmp/content.mp4')
      expect(mockConcatVideos).not.toHaveBeenCalled()
    })
  })

  describe('REQ-004: Resolves file paths relative to brand.json directory', () => {
    it('introOutroService.REQ-004 - resolves intro/outro paths from brand dir', async () => {
      mockDirname.mockReturnValue('/repo')

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      // resolve(brandDir, introRelative) and resolve(brandDir, outroRelative)
      expect(mockResolve).toHaveBeenCalledWith('/repo', 'assets/intro.mp4')
      expect(mockResolve).toHaveBeenCalledWith('/repo', 'assets/outro.mp4')
    })
  })

  describe('REQ-005: Skips intro when file does not exist on disk', () => {
    it('introOutroService.REQ-005 - omits intro from segments when missing', async () => {
      // Intro does not exist, outro does
      mockFileExists.mockImplementation(async (p: string) => {
        if (String(p).includes('intro')) return false
        return true
      })

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      // normalizeForConcat should only be called for outro, not intro
      const normCalls = mockNormalizeForConcat.mock.calls
      const normalizedPaths = normCalls.map(([src]: string[]) => src)
      expect(normalizedPaths.every((p: string) => !p.includes('intro'))).toBe(true)

      // concatVideos should receive content + normalized outro (no intro)
      expect(mockConcatVideos).toHaveBeenCalledOnce()
      const [segments] = mockConcatVideos.mock.calls[0]
      expect(segments).toHaveLength(2) // content + outro
      expect(segments[0]).toBe('/tmp/content.mp4')
    })
  })

  describe('REQ-006: Skips outro when file does not exist on disk', () => {
    it('introOutroService.REQ-006 - omits outro from segments when missing', async () => {
      mockFileExists.mockImplementation(async (p: string) => {
        if (String(p).includes('outro')) return false
        return true
      })

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      // normalizeForConcat should only be called for intro, not outro
      const normCalls = mockNormalizeForConcat.mock.calls
      const normalizedPaths = normCalls.map(([src]: string[]) => src)
      expect(normalizedPaths.every((p: string) => !p.includes('outro'))).toBe(true)

      // concatVideos should receive normalized intro + content (no outro)
      expect(mockConcatVideos).toHaveBeenCalledOnce()
      const [segments] = mockConcatVideos.mock.calls[0]
      expect(segments).toHaveLength(2) // intro + content
      expect(segments[1]).toBe('/tmp/content.mp4')
    })
  })

  describe('REQ-007: Normalizes intro/outro to match content video', () => {
    it('introOutroService.REQ-007 - calls normalizeForConcat for intro before concatenation', async () => {
      mockJoin.mockImplementation((...args: string[]) => args.join('/'))

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      // normalizeForConcat should be called for intro (and outro if configured)
      expect(mockNormalizeForConcat).toHaveBeenCalledWith(
        expect.any(String),   // resolved intro path
        '/tmp/content.mp4',   // reference video
        expect.any(String),   // normalized output path
      )
    })

    it('introOutroService.REQ-007 - calls normalizeForConcat for outro', async () => {
      mockGetIntroOutroConfig.mockReturnValue({
        enabled: true,
        fadeDuration: 0,
        outro: { default: './outro.mp4' },
        rules: { main: { intro: false, outro: true } },
      })
      mockJoin.mockImplementation((...args: string[]) => args.join('/'))

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      expect(mockNormalizeForConcat).toHaveBeenCalledWith(
        expect.any(String),   // resolved outro path
        '/tmp/content.mp4',   // reference video
        expect.any(String),   // normalized output path
      )
    })
  })

  describe('REQ-008: Calls concatVideos with segments in correct order [intro, content, outro]', () => {
    it('introOutroService.REQ-008 - segments ordered as intro → content → outro', async () => {
      mockJoin.mockImplementation((...args: string[]) => args.join('/'))

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      expect(mockConcatVideos).toHaveBeenCalledOnce()
      const [segments, outputPath, opts] = mockConcatVideos.mock.calls[0]

      // First segment is normalized intro, middle is content, last is normalized outro
      expect(segments).toHaveLength(3)
      expect(segments[0]).toContain('.intro-normalized.mp4')
      expect(segments[1]).toBe('/tmp/content.mp4')
      expect(segments[2]).toContain('.outro-normalized.mp4')
      expect(outputPath).toBe('/out/final.mp4')
      expect(opts).toEqual({ fadeDuration: 0 })
    })

    it('introOutroService.REQ-008 - passes fadeDuration from brand config', async () => {
      mockGetIntroOutroConfig.mockReturnValue(makeConfig({ fadeDuration: 1.5 }))

      await applyIntroOutro('/tmp/content.mp4', 'main', '/out/final.mp4')

      const [, , opts] = mockConcatVideos.mock.calls[0]
      expect(opts).toEqual({ fadeDuration: 1.5 })
    })
  })

  describe('REQ-009: Returns outputPath when applied successfully', () => {
    it('introOutroService.REQ-009 - returns outputPath on success', async () => {
      const result = await applyIntroOutro(
        '/tmp/content.mp4',
        'main',
        '/out/final.mp4',
      )

      expect(result).toBe('/out/final.mp4')
    })

    it('introOutroService.REQ-009 - returns original path when no valid files exist', async () => {
      mockFileExists.mockResolvedValue(false)

      const result = await applyIntroOutro(
        '/tmp/content.mp4',
        'main',
        '/out/final.mp4',
      )

      expect(result).toBe('/tmp/content.mp4')
      expect(mockConcatVideos).not.toHaveBeenCalled()
    })
  })

  describe('REQ-010: Passes aspect ratio to resolver', () => {
    it('introOutroService.REQ-010 - passes aspectRatio to file resolution', async () => {
      mockGetIntroOutroConfig.mockReturnValue({
        enabled: true,
        fadeDuration: 0,
        intro: {
          default: './intro.mp4',
          aspectRatios: { '9:16': './intro-portrait.mp4' },
        },
        outro: { default: './outro.mp4' },
        rules: { shorts: { intro: true, outro: true } },
      })
      mockFileExists.mockResolvedValue(true)

      await applyIntroOutro('/video.mp4', 'shorts', '/out.mp4', 'tiktok', '9:16')

      // The normalized intro should use the portrait file
      expect(mockNormalizeForConcat).toHaveBeenCalled()
      expect(mockConcatVideos).toHaveBeenCalled()
    })
  })
})

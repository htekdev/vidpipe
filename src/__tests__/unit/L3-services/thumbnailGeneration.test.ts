import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ThumbnailConfig } from '../../../L0-pure/types/index.js'

// ── L2 mocks (primary mock target for L3 unit tests) ──────────────────────────

const mockL2GenerateImage = vi.hoisted(() => vi.fn())
const mockL2GenerateImageWithReference = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/openai/imageGeneration.js', () => ({
  generateImage: mockL2GenerateImage,
  generateImageWithReference: mockL2GenerateImageWithReference,
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 } as Record<string, number>,
}))

// ── L1 mocks (practical exception: config/IO must be controlled in tests) ─────

const mockGetThumbnailConfig = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getThumbnailConfig: mockGetThumbnailConfig,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  resolve: (...segments: string[]) => segments.join('/'),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

// ── Import SUT ────────────────────────────────────────────────────────────────

import {
  resolveThumbnailConfig,
  generateThumbnail,
} from '../../../L3-services/imageGeneration/thumbnailGeneration.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseThumbnailConfig(overrides: Partial<ThumbnailConfig> = {}): ThumbnailConfig {
  return { enabled: true, ...overrides }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('L3 thumbnailGeneration service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    costTracker.reset()
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/repo' })
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })
    mockFileExists.mockResolvedValue(false)
  })

  // ── resolveThumbnailConfig ────────────────────────────────────────────────

  describe('resolveThumbnailConfig', () => {
    test('ThumbnailGeneration.REQ-001 - returns disabled when config.enabled is false', () => {
      mockGetThumbnailConfig.mockReturnValue({ enabled: false })

      const result = resolveThumbnailConfig()

      expect(result.enabled).toBe(false)
      expect(result.referenceImagePath).toBeNull()
      expect(result.style).toBeNull()
      expect(result.promptOverride).toBeNull()
      expect(result.size).toBe('auto')
      expect(result.quality).toBe('high')
    })

    test('ThumbnailGeneration.REQ-002 - returns disabled when contentType rule is false', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        rules: { shorts: false },
      }))

      const result = resolveThumbnailConfig(undefined, 'shorts')

      expect(result.enabled).toBe(false)
    })

    test('ThumbnailGeneration.REQ-002 - returns enabled when contentType rule is true', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        rules: { shorts: true },
      }))

      const result = resolveThumbnailConfig(undefined, 'shorts')

      expect(result.enabled).toBe(true)
    })

    test('ThumbnailGeneration.REQ-002 - returns enabled when contentType has no matching rule', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        rules: { shorts: false },
      }))

      const result = resolveThumbnailConfig(undefined, 'main')

      expect(result.enabled).toBe(true)
    })

    test('ThumbnailGeneration.REQ-003 - applies platform overrides for all override fields', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        style: 'base-style',
        size: '1536x1024',
        platformOverrides: {
          youtube: {
            referenceImage: 'yt-ref.png',
            style: 'yt-style',
            promptOverride: 'yt prompt',
            size: '1024x1024',
          },
        },
      }))

      const result = resolveThumbnailConfig('youtube')

      expect(result.enabled).toBe(true)
      expect(result.style).toBe('yt-style')
      expect(result.promptOverride).toBe('yt prompt')
      expect(result.size).toBe('1024x1024')
      expect(result.referenceImagePath).toBe('/repo/yt-ref.png')
    })

    test('ThumbnailGeneration.REQ-003 - uses base config when no platform override exists', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        style: 'base-style',
        size: '1536x1024',
      }))

      const result = resolveThumbnailConfig('tiktok')

      expect(result.style).toBe('base-style')
      expect(result.size).toBe('1536x1024')
    })

    test('ThumbnailGeneration.REQ-004 - resolves reference image path to absolute using REPO_ROOT', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        referenceImage: 'assets/ref.png',
      }))
      mockGetConfig.mockReturnValue({ REPO_ROOT: '/my/repo' })

      const result = resolveThumbnailConfig()

      expect(result.referenceImagePath).toBe('/my/repo/assets/ref.png')
    })

    test('ThumbnailGeneration.REQ-004 - referenceImagePath is null when no referenceImage configured', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())

      const result = resolveThumbnailConfig()

      expect(result.referenceImagePath).toBeNull()
    })

    test('uses default size 1536x1024 when not specified in config', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())

      const result = resolveThumbnailConfig()

      expect(result.size).toBe('1536x1024')
    })

    test('uses default quality high when not specified in config', () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())

      const result = resolveThumbnailConfig()

      expect(result.quality).toBe('high')
    })
  })

  // ── generateThumbnail ─────────────────────────────────────────────────────

  describe('generateThumbnail', () => {
    test('ThumbnailGeneration.REQ-005 - returns null when thumbnails are disabled', async () => {
      mockGetThumbnailConfig.mockReturnValue({ enabled: false })

      const result = await generateThumbnail('prompt', '/out/thumb.png')

      expect(result).toBeNull()
      expect(mockL2GenerateImage).not.toHaveBeenCalled()
      expect(mockL2GenerateImageWithReference).not.toHaveBeenCalled()
    })

    test('ThumbnailGeneration.REQ-006 - calls L2 generateImage when no reference image configured', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        size: '1024x1024',
        quality: 'high',
      }))
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')

      const result = await generateThumbnail('a colorful banner', '/out/thumb.png')

      expect(result).toBe('/out/thumb.png')
      expect(mockL2GenerateImage).toHaveBeenCalledWith(
        'a colorful banner',
        '/out/thumb.png',
        { size: '1024x1024', quality: 'high', style: undefined },
      )
      expect(mockL2GenerateImageWithReference).not.toHaveBeenCalled()
    })

    test('ThumbnailGeneration.REQ-007 - calls L2 generateImageWithReference when reference image exists', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        referenceImage: 'ref.png',
      }))
      mockFileExists.mockResolvedValue(true)
      mockL2GenerateImageWithReference.mockResolvedValue('/out/thumb.png')

      const result = await generateThumbnail('banner prompt', '/out/thumb.png')

      expect(result).toBe('/out/thumb.png')
      expect(mockL2GenerateImageWithReference).toHaveBeenCalledWith(
        'banner prompt',
        '/out/thumb.png',
        '/repo/ref.png',
        { size: '1536x1024', quality: 'high', style: undefined },
      )
      expect(mockL2GenerateImage).not.toHaveBeenCalled()
    })

    test('ThumbnailGeneration.REQ-007 - falls back to generateImage when reference file is missing', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        referenceImage: 'missing.png',
      }))
      mockFileExists.mockResolvedValue(false)
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')

      const result = await generateThumbnail('prompt', '/out/thumb.png')

      expect(result).toBe('/out/thumb.png')
      expect(mockL2GenerateImage).toHaveBeenCalled()
      expect(mockL2GenerateImageWithReference).not.toHaveBeenCalled()
    })

    test('ThumbnailGeneration.REQ-008 - uses promptOverride instead of provided prompt', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        promptOverride: 'overridden prompt text',
      }))
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')

      await generateThumbnail('original prompt', '/out/thumb.png')

      expect(mockL2GenerateImage).toHaveBeenCalledWith(
        'overridden prompt text',
        '/out/thumb.png',
        expect.any(Object),
      )
    })

    test('ThumbnailGeneration.REQ-009 - records cost via costTracker with correct metadata', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        quality: 'low',
        size: '1024x1024',
      }))
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')
      const spy = vi.spyOn(costTracker, 'recordServiceUsage')

      await generateThumbnail('test prompt', '/out/thumb.png', 'youtube', 'shorts')

      expect(spy).toHaveBeenCalledWith(
        'openai-image-thumbnail',
        0.04,
        expect.objectContaining({
          model: 'gpt-image-1.5',
          size: '1024x1024',
          quality: 'low',
          referenceUsed: false,
          platform: 'youtube',
          contentType: 'shorts',
        }),
      )
    })

    test('ThumbnailGeneration.REQ-009 - records referenceUsed true when reference image is used', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
        referenceImage: 'ref.png',
      }))
      mockFileExists.mockResolvedValue(true)
      mockL2GenerateImageWithReference.mockResolvedValue('/out/thumb.png')
      const spy = vi.spyOn(costTracker, 'recordServiceUsage')

      await generateThumbnail('prompt', '/out/thumb.png')

      expect(spy).toHaveBeenCalledWith(
        'openai-image-thumbnail',
        expect.any(Number),
        expect.objectContaining({ referenceUsed: true }),
      )
    })

    test('ThumbnailGeneration.REQ-009 - truncates prompt in metadata to 200 chars', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')
      const spy = vi.spyOn(costTracker, 'recordServiceUsage')
      const longPrompt = 'A'.repeat(300)

      await generateThumbnail(longPrompt, '/out/thumb.png')

      expect(spy).toHaveBeenCalledWith(
        'openai-image-thumbnail',
        expect.any(Number),
        expect.objectContaining({ prompt: 'A'.repeat(200) }),
      )
    })

    test('defaults platform to "default" and contentType to "unknown" in cost metadata', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())
      mockL2GenerateImage.mockResolvedValue('/out/thumb.png')
      const spy = vi.spyOn(costTracker, 'recordServiceUsage')

      await generateThumbnail('prompt', '/out/thumb.png')

      expect(spy).toHaveBeenCalledWith(
        'openai-image-thumbnail',
        expect.any(Number),
        expect.objectContaining({ platform: 'default', contentType: 'unknown' }),
      )
    })

    test('propagates L2 errors without catching', async () => {
      mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())
      mockL2GenerateImage.mockRejectedValue(new Error('DALL-E unavailable'))

      await expect(generateThumbnail('prompt', '/out/thumb.png')).rejects.toThrow('DALL-E unavailable')
    })
  })
})

import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ThumbnailConfig } from '../../../L0-pure/types/index.js'

// ── Hoisted mocks (for vi.mock factories) ──────────────────────────────────
const mockGetThumbnailConfig = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

// ── Mock boundary: L1 infra only (L2 + L3 run real) ────────────────────────
vi.mock('../../../L1-infra/config/brand.js', () => ({
  getThumbnailConfig: mockGetThumbnailConfig,
  getBrandConfig: () => ({
    name: 'TestBrand', handle: '@test',
    voice: { tone: 'casual', personality: 'friendly', style: 'dev' },
    advocacy: { primary: ['testing'], interests: ['video'], avoids: [] },
    customVocabulary: [], tagline: '',
    hashtags: { always: [], preferred: [], platforms: {} },
    contentGuidelines: { shortsFocus: '', blogFocus: '', socialFocus: '' },
  }),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  ensureDirectory: mockEnsureDirectory,
  writeFileBuffer: vi.fn().mockResolvedValue(undefined),
  readFileBuffer: vi.fn(async () => Buffer.from('fake-image')),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  resolve: (...segments: string[]) => segments.join('/'),
  join: (...segments: string[]) => segments.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}))

// ── Import SUT after mocks ──────────────────────────────────────────────────
import {
  resolveThumbnailConfig,
  generateThumbnail,
} from '../../../L3-services/imageGeneration/thumbnailGeneration.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'

// ── Helpers ─────────────────────────────────────────────────────────────────
function baseThumbnailConfig(overrides: Partial<ThumbnailConfig> = {}): ThumbnailConfig {
  return { enabled: true, ...overrides }
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('Integration L3: thumbnailGeneration config resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    costTracker.reset()
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/repo' })
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })
    mockFileExists.mockResolvedValue(false)
  })

  test('resolveThumbnailConfig returns disabled when config.enabled is false', () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })

    const config = resolveThumbnailConfig()

    expect(config.enabled).toBe(false)
    expect(config.referenceImagePath).toBeNull()
    expect(config.style).toBeNull()
    expect(config.promptOverride).toBeNull()
  })

  test('resolveThumbnailConfig returns enabled with defaults when config.enabled is true', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig())

    const config = resolveThumbnailConfig()

    expect(config.enabled).toBe(true)
    expect(config.size).toBe('1536x1024')
    expect(config.quality).toBe('high')
    expect(config.referenceImagePath).toBeNull()
  })

  test('resolveThumbnailConfig merges platform overrides', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      style: 'base-style',
      size: '1536x1024',
      platformOverrides: {
        youtube: { style: 'yt-style', size: '1024x1024', promptOverride: 'yt prompt' },
      },
    }))

    const config = resolveThumbnailConfig('youtube')

    expect(config.enabled).toBe(true)
    expect(config.style).toBe('yt-style')
    expect(config.size).toBe('1024x1024')
    expect(config.promptOverride).toBe('yt prompt')
  })

  test('resolveThumbnailConfig respects contentType rules disabling shorts', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      rules: { shorts: false },
    }))

    const config = resolveThumbnailConfig(undefined, 'shorts')

    expect(config.enabled).toBe(false)
  })

  test('resolveThumbnailConfig allows main when only shorts disabled', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      rules: { shorts: false, main: true },
    }))

    const config = resolveThumbnailConfig(undefined, 'main')

    expect(config.enabled).toBe(true)
  })

  test('resolveThumbnailConfig resolves referenceImage to absolute path via REPO_ROOT', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      referenceImage: 'assets/ref.png',
    }))
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/my/repo' })

    const config = resolveThumbnailConfig()

    expect(config.referenceImagePath).toBe('/my/repo/assets/ref.png')
  })

  test('resolveThumbnailConfig platform override overrides reference image', () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      referenceImage: 'base-ref.png',
      platformOverrides: { tiktok: { referenceImage: 'tiktok-ref.png' } },
    }))
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/repo' })

    const config = resolveThumbnailConfig('tiktok')

    expect(config.referenceImagePath).toBe('/repo/tiktok-ref.png')
  })
})

describe('Integration L3: generateThumbnail disabled paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    costTracker.reset()
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/repo' })
    mockFileExists.mockResolvedValue(false)
  })

  test('returns null when thumbnails globally disabled', async () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })

    const result = await generateThumbnail('some prompt', '/out/thumb.png')

    expect(result).toBeNull()
  })

  test('returns null when content type rule is disabled', async () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      rules: { shorts: false },
    }))

    const result = await generateThumbnail('prompt', '/out/thumb.png', undefined, 'shorts')

    expect(result).toBeNull()
  })
})

// ── Content-type-aware default sizes (no API required) ──────────────────────
describe('Integration L3: content-type-aware default sizes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({ REPO_ROOT: '/repo' })
  })

  test('shorts resolve to portrait size 1024x1536 by default', () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: true })
    const config = resolveThumbnailConfig(undefined, 'shorts')
    expect(config.size).toBe('1024x1536')
  })

  test('main and medium-clips resolve to landscape size 1536x1024 by default', () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: true })
    const mainConfig = resolveThumbnailConfig(undefined, 'main')
    expect(mainConfig.size).toBe('1536x1024')

    const mediumConfig = resolveThumbnailConfig(undefined, 'medium-clips')
    expect(mediumConfig.size).toBe('1536x1024')
  })

  test('L2 generateImage is importable from L3 thumbnailGeneration context', async () => {
    // Verifies the L2→L3 dependency chain works without import errors
    const mod = await import('../../../L3-services/imageGeneration/thumbnailGeneration.js')
    expect(typeof mod.generateThumbnail).toBe('function')
  })

  test('L2 Late API CreatePostParams accepts thumbnail as string URL', async () => {
    // Type-level validation: thumbnail field is string, not object
    const params: import('../../../L2-clients/late/lateApi.js').CreatePostParams = {
      content: 'test',
      platforms: [{ platform: 'youtube', accountId: 'a' }],
      mediaItems: [{ type: 'video', url: 'https://cdn/v.mp4', thumbnail: 'https://cdn/thumb.jpg' }],
    }
    expect(params.mediaItems![0].thumbnail).toBe('https://cdn/thumb.jpg')
    expect(typeof params.mediaItems![0].thumbnail).toBe('string')
  })
})

// ── Tests requiring OPENAI_API_KEY (L2 runs real) ───────────────────────────
const hasApiKey = !!process.env.OPENAI_API_KEY

describe.skipIf(!hasApiKey)('Integration L3: generateThumbnail with real API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    costTracker.reset()
    mockGetConfig.mockReturnValue({
      REPO_ROOT: process.cwd(),
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    })
    mockFileExists.mockResolvedValue(false)
  })

  test('generates a thumbnail via real OpenAI API and records cost', async () => {
    mockGetThumbnailConfig.mockReturnValue(baseThumbnailConfig({
      quality: 'low',
      size: '1024x1024',
    }))
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')
    const outputPath = '/tmp/integration-test-thumb.png'

    const result = await generateThumbnail(
      'A simple geometric pattern in blue and white',
      outputPath,
      'youtube',
      'main',
    )

    expect(result).toBe(outputPath)
    expect(spy).toHaveBeenCalledWith(
      'openai-image-thumbnail',
      expect.any(Number),
      expect.objectContaining({
        model: 'gpt-image-1.5',
        quality: 'low',
        platform: 'youtube',
        contentType: 'main',
      }),
    )
  }, 60_000)
})

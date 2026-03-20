import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MediumClip, Platform } from '../../../L0-pure/types/index.js'

// ── Mocks ──────────────────────────────────────────────────────

const mockFileExists = vi.fn<(path: string) => Promise<boolean>>()
const mockEnsureDirectory = vi.fn<(path: string) => Promise<void>>()
const mockExtractCompositeClip = vi.fn<(...args: unknown[]) => Promise<void>>()

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: (...args: unknown[]) => mockFileExists(args[0] as string),
  fileExistsSync: vi.fn().mockReturnValue(false),
  ensureDirectory: (...args: unknown[]) => mockEnsureDirectory(args[0] as string),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../../L4-agents/videoServiceBridge.js', () => ({
  extractCompositeClip: (...args: unknown[]) => mockExtractCompositeClip(...args),
  applyIntroOutro: vi.fn().mockImplementation(async (clipPath: string) => clipPath),
}))

const mockGenerateThumbnailForClip = vi.fn<(...args: unknown[]) => Promise<string | null>>()
vi.mock('../../../L5-assets/thumbnailGeneration.js', () => ({
  generateThumbnailForClip: (...args: unknown[]) => mockGenerateThumbnailForClip(...args),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
}))

import { MediumClipAsset } from '../../../L5-assets/MediumClipAsset.js'
import { VideoAsset } from '../../../L5-assets/VideoAsset.js'

// ── Helpers ────────────────────────────────────────────────────

function makeClip(overrides?: Partial<MediumClip>): MediumClip {
  return {
    id: 'medium-1',
    title: 'Test Medium Clip',
    slug: 'test-medium',
    segments: [{ start: 10, end: 70, description: 'full segment' }],
    totalDuration: 60,
    outputPath: '/out/test-medium/media.mp4',
    description: 'A medium clip',
    tags: ['#test'],
    hook: 'Watch this!',
    topic: 'Testing',
    ...overrides,
  }
}

function makeParent(): VideoAsset {
  return {
    getResult: vi.fn().mockResolvedValue('/videos/source.mp4'),
    getEnhancedVideo: vi.fn().mockResolvedValue('/videos/source-enhanced.mp4'),
    getTranscript: vi.fn(),
    exists: vi.fn().mockResolvedValue(true),
  } as unknown as VideoAsset
}

// ── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MediumClipAsset', () => {
  describe('constructor and paths', () => {
    it('sets slug, videoDir, videoPath, postsDir', () => {
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      expect(asset.slug).toBe('test-medium')
      expect(asset.videoDir).toBe('/medium-clips/test-medium')
      expect(asset.videoPath).toBe('/medium-clips/test-medium/media.mp4')
      expect(asset.postsDir).toBe('/medium-clips/test-medium/posts')
    })
  })

  describe('exists', () => {
    it('returns true when video exists', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      expect(await asset.exists()).toBe(true)
    })

    it('returns false when video missing', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      expect(await asset.exists()).toBe(false)
    })
  })

  describe('getResult', () => {
    it('returns video path when file exists', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      const result = await asset.getResult()
      expect(result).toBe('/medium-clips/test-medium/media.mp4')
    })

    it('extracts clip from enhanced video when file missing', async () => {
      mockFileExists.mockResolvedValue(false)
      mockExtractCompositeClip.mockResolvedValue(undefined)
      const parent = makeParent()
      const clip = makeClip()
      const asset = new MediumClipAsset(parent, clip, '/medium-clips')
      await asset.getResult()
      expect(mockExtractCompositeClip).toHaveBeenCalledWith(
        '/videos/source-enhanced.mp4',
        clip.segments,
        '/medium-clips/test-medium/media.mp4',
      )
    })

    it('re-extracts when force is true even if file exists', async () => {
      mockFileExists.mockResolvedValue(true)
      mockExtractCompositeClip.mockResolvedValue(undefined)
      const parent = makeParent()
      const clip = makeClip()
      const asset = new MediumClipAsset(parent, clip, '/medium-clips')
      await asset.getResult({ force: true })
      expect(mockExtractCompositeClip).toHaveBeenCalled()
    })
  })

  describe('getSocialPosts', () => {
    it('returns 5 social post assets', async () => {
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      const posts = await asset.getSocialPosts()
      expect(posts).toHaveLength(5)
    })
  })

  describe('generateThumbnail', () => {
    it('calls generateThumbnailForClip with clip context', async () => {
      mockGenerateThumbnailForClip.mockResolvedValue('/medium-clips/test-medium/thumbnails/thumbnail.png')
      const clip = makeClip({
        captionedPath: '/medium-clips/test-medium/media-captioned.mp4',
        tags: ['#test', '#medium'],
      })
      const asset = new MediumClipAsset(makeParent(), clip, '/medium-clips')

      const result = await asset.generateThumbnail()

      expect(mockGenerateThumbnailForClip).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Medium Clip',
          description: 'A medium clip',
          hook: 'Watch this!',
          topics: ['#test', '#medium'],
          videoPath: '/medium-clips/test-medium/media-captioned.mp4',
          outputDir: '/medium-clips/test-medium/thumbnails',
          contentType: 'medium-clips',
        }),
        undefined,
      )
      expect(result).toBe('/medium-clips/test-medium/thumbnails/thumbnail.png')
      expect(clip.thumbnailPath).toBe('/medium-clips/test-medium/thumbnails/thumbnail.png')
    })

    it('uses outputPath as videoPath when captionedPath is undefined', async () => {
      mockGenerateThumbnailForClip.mockResolvedValue('/medium-clips/test-medium/thumbnails/thumbnail.png')
      const clip = makeClip({ captionedPath: undefined })
      const asset = new MediumClipAsset(makeParent(), clip, '/medium-clips')

      await asset.generateThumbnail()

      expect(mockGenerateThumbnailForClip).toHaveBeenCalledWith(
        expect.objectContaining({
          videoPath: '/out/test-medium/media.mp4',
        }),
        undefined,
      )
    })

    it('returns null when bridge returns null', async () => {
      mockGenerateThumbnailForClip.mockResolvedValue(null)
      const clip = makeClip()
      const asset = new MediumClipAsset(makeParent(), clip, '/medium-clips')

      const result = await asset.generateThumbnail()

      expect(result).toBeNull()
      expect(clip.thumbnailPath).toBeUndefined()
    })

    it('passes force flag from opts', async () => {
      mockGenerateThumbnailForClip.mockResolvedValue('/out/thumbnail.png')
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')

      await asset.generateThumbnail({ force: true })

      expect(mockGenerateThumbnailForClip).toHaveBeenCalledWith(
        expect.any(Object),
        true,
      )
    })
  })
})

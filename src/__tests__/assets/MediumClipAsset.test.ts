import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MediumClip, Platform } from '../../types/index.js'

// ── Mocks ──────────────────────────────────────────────────────

const mockFileExists = vi.fn<(path: string) => Promise<boolean>>()

vi.mock('../../core/fileSystem.js', () => ({
  fileExists: (...args: unknown[]) => mockFileExists(args[0] as string),
  fileExistsSync: vi.fn().mockReturnValue(false),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../core/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
}))

vi.mock('../../config/ffmpegResolver.js', () => ({
  getFFprobePath: vi.fn().mockReturnValue('ffprobe'),
}))

import { MediumClipAsset } from '../../assets/MediumClipAsset.js'
import { VideoAsset } from '../../assets/VideoAsset.js'

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

    it('throws when file does not exist', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      await expect(asset.getResult()).rejects.toThrow('Medium clip "test-medium" not found')
    })

    it('throws with instructions to run medium-clips stage', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      await expect(asset.getResult()).rejects.toThrow('Run the medium-clips stage first')
    })
  })

  describe('getSocialPosts', () => {
    it('returns 5 social post assets', async () => {
      const asset = new MediumClipAsset(makeParent(), makeClip(), '/medium-clips')
      const posts = await asset.getSocialPosts()
      expect(posts).toHaveLength(5)
    })
  })
})

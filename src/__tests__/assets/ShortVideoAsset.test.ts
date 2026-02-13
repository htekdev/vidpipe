import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShortClip, Transcript, Platform } from '../../types/index.js'

// ── Mocks ──────────────────────────────────────────────────────

const mockFileExists = vi.fn<(path: string) => Promise<boolean>>()
const mockEnsureDirectory = vi.fn<(path: string) => Promise<void>>()
const mockExtractCompositeClip = vi.fn<(...args: unknown[]) => Promise<void>>()

vi.mock('../../core/fileSystem.js', () => ({
  fileExists: (...args: unknown[]) => mockFileExists(args[0] as string),
  fileExistsSync: vi.fn().mockReturnValue(false),
  ensureDirectory: (...args: unknown[]) => mockEnsureDirectory(args[0] as string),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../tools/ffmpeg/clipExtraction.js', () => ({
  extractCompositeClip: (...args: unknown[]) => mockExtractCompositeClip(...args),
}))

vi.mock('../../core/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
}))

vi.mock('../../config/ffmpegResolver.js', () => ({
  getFFprobePath: vi.fn().mockReturnValue('ffprobe'),
}))

import { ShortVideoAsset } from '../../assets/ShortVideoAsset.js'
import { VideoAsset } from '../../assets/VideoAsset.js'

// ── Helpers ────────────────────────────────────────────────────

function makeClip(overrides?: Partial<ShortClip>): ShortClip {
  return {
    id: 'short-1',
    title: 'Test Short',
    slug: 'test-short',
    segments: [{ start: 10, end: 25, description: 'intro' }],
    totalDuration: 15,
    outputPath: '/out/test-short/media.mp4',
    description: 'A test short',
    tags: ['#test'],
    ...overrides,
  }
}

function makeParent(): VideoAsset {
  const parent = {
    getResult: vi.fn().mockResolvedValue('/videos/source.mp4'),
    getTranscript: vi.fn().mockResolvedValue({
      text: 'Hello world this is a test of the system',
      segments: [
        { id: 0, text: 'Hello world', start: 5, end: 12, words: [] },
        { id: 1, text: 'this is a test', start: 12, end: 20, words: [] },
        { id: 2, text: 'of the system', start: 25, end: 32, words: [] },
      ],
      words: [
        { word: 'Hello', start: 5, end: 6 },
        { word: 'world', start: 6, end: 7 },
        { word: 'this', start: 12, end: 13 },
        { word: 'is', start: 13, end: 14 },
        { word: 'a', start: 14, end: 15 },
        { word: 'test', start: 15, end: 16 },
        { word: 'of', start: 25, end: 26 },
        { word: 'the', start: 26, end: 27 },
        { word: 'system', start: 27, end: 28 },
      ],
      language: 'en',
      duration: 35,
    } satisfies Transcript),
    exists: vi.fn().mockResolvedValue(true),
  } as unknown as VideoAsset
  return parent
}

// ── Tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ShortVideoAsset', () => {
  describe('constructor and paths', () => {
    it('sets slug, videoDir, videoPath, postsDir from clip', () => {
      const clip = makeClip()
      const asset = new ShortVideoAsset(makeParent(), clip, '/shorts')
      expect(asset.slug).toBe('test-short')
      expect(asset.videoDir).toBe('/shorts/test-short')
      expect(asset.videoPath).toBe('/shorts/test-short/media.mp4')
      expect(asset.postsDir).toBe('/shorts/test-short/posts')
    })
  })

  describe('exists', () => {
    it('returns true when video file exists', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      expect(await asset.exists()).toBe(true)
    })

    it('returns false when video file missing', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      expect(await asset.exists()).toBe(false)
    })
  })

  describe('getResult', () => {
    it('returns cached path when file exists and not forced', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      const result = await asset.getResult()
      expect(result).toBe('/shorts/test-short/media.mp4')
      expect(mockExtractCompositeClip).not.toHaveBeenCalled()
    })

    it('extracts clip when file missing', async () => {
      mockFileExists.mockResolvedValue(false)
      mockEnsureDirectory.mockResolvedValue(undefined)
      mockExtractCompositeClip.mockResolvedValue(undefined)
      const parent = makeParent()
      const clip = makeClip()
      const asset = new ShortVideoAsset(parent, clip, '/shorts')
      const result = await asset.getResult()
      expect(result).toBe('/shorts/test-short/media.mp4')
      expect(mockEnsureDirectory).toHaveBeenCalledWith('/shorts/test-short')
      expect(parent.getResult).toHaveBeenCalled()
      expect(mockExtractCompositeClip).toHaveBeenCalledWith(
        '/videos/source.mp4',
        clip.segments,
        '/shorts/test-short/media.mp4',
      )
    })

    it('re-extracts when force is true even if file exists', async () => {
      mockFileExists.mockResolvedValue(true)
      mockEnsureDirectory.mockResolvedValue(undefined)
      mockExtractCompositeClip.mockResolvedValue(undefined)
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      await asset.getResult({ force: true })
      expect(mockExtractCompositeClip).toHaveBeenCalled()
    })
  })

  describe('getPlatformVariants', () => {
    it('returns map of existing platform variants', async () => {
      // Only tiktok and instagram variants exist
      mockFileExists.mockImplementation(async (path: string) => {
        return path.includes('tiktok') || path.includes('instagram')
      })
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      const variants = await asset.getPlatformVariants()
      expect(variants.size).toBe(2)
      expect(variants.has('tiktok' as Platform)).toBe(true)
      expect(variants.has('instagram' as Platform)).toBe(true)
      expect(variants.has('linkedin' as Platform)).toBe(false)
    })

    it('returns empty map when no variants exist', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      const variants = await asset.getPlatformVariants()
      expect(variants.size).toBe(0)
    })
  })

  describe('getSocialPosts', () => {
    it('returns 5 social post assets for all platforms', async () => {
      const asset = new ShortVideoAsset(makeParent(), makeClip(), '/shorts')
      const posts = await asset.getSocialPosts()
      expect(posts).toHaveLength(5)
    })
  })

  describe('getTranscript', () => {
    it('filters segments and words to clip time range', async () => {
      // Clip is 10-25s
      const clip = makeClip({ segments: [{ start: 10, end: 25, description: 'mid' }] })
      const asset = new ShortVideoAsset(makeParent(), clip, '/shorts')
      const transcript = await asset.getTranscript()

      // Segment 0 (5-12) overlaps with 10-25 ✓
      // Segment 1 (12-20) fully within 10-25 ✓
      // Segment 2 (25-32) does NOT overlap (seg.start < clipSeg.end → 25 < 25 → false)
      expect(transcript.segments).toHaveLength(2)
      expect(transcript.segments[0].text).toBe('Hello world')
      expect(transcript.segments[1].text).toBe('this is a test')

      // Words: only those with start >= 10 AND end <= 25
      // 'this' (12-13) ✓, 'is' (13-14) ✓, 'a' (14-15) ✓, 'test' (15-16) ✓
      // 'Hello' (5-6) ✗ start < 10, 'world' (6-7) ✗ start < 10
      // 'of' (25-26) ✗ start >= 25 but end > 25
      expect(transcript.words).toHaveLength(4)
      expect(transcript.words.map((w) => w.word)).toEqual(['this', 'is', 'a', 'test'])

      expect(transcript.language).toBe('en')
      expect(transcript.duration).toBe(15)
    })

    it('handles composite clips with multiple segments', async () => {
      const clip = makeClip({
        segments: [
          { start: 5, end: 8, description: 'first' },
          { start: 25, end: 30, description: 'second' },
        ],
        totalDuration: 8,
      })
      const asset = new ShortVideoAsset(makeParent(), clip, '/shorts')
      const transcript = await asset.getTranscript()

      // Segment 0 (5-12) overlaps with clipSeg 5-8 ✓
      // Segment 1 (12-20) does NOT overlap with either
      // Segment 2 (25-32) overlaps with clipSeg 25-30 ✓
      expect(transcript.segments).toHaveLength(2)
      expect(transcript.segments[0].text).toBe('Hello world')
      expect(transcript.segments[1].text).toBe('of the system')

      // Words within 5-8: Hello (5-6) ✓, world (6-7) ✓
      // Words within 25-30: of (25-26) ✓, the (26-27) ✓, system (27-28) ✓
      expect(transcript.words).toHaveLength(5)
    })

    it('returns empty transcript when clip does not overlap any segments', async () => {
      const clip = makeClip({ segments: [{ start: 40, end: 50, description: 'outside' }] })
      const asset = new ShortVideoAsset(makeParent(), clip, '/shorts')
      const transcript = await asset.getTranscript()
      expect(transcript.segments).toHaveLength(0)
      expect(transcript.words).toHaveLength(0)
      expect(transcript.text).toBe('')
    })
  })
})

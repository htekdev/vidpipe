/**
 * Unit tests for the VideoAsset base class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VideoAsset, VideoMetadata, CaptionFiles } from '../../../L5-assets/VideoAsset.js'
import { AssetOptions } from '../../../L5-assets/Asset.js'
import { join } from '../../../L1-infra/paths/paths.js'
import * as fileSystem from '../../../L1-infra/fileSystem/fileSystem.js'
import * as videoServiceBridge from '../../../L4-agents/videoServiceBridge.js'

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: vi.fn(),
  fileExistsSync: vi.fn().mockReturnValue(false),
  readJsonFile: vi.fn(),
  readTextFile: vi.fn(),
  writeJsonFile: vi.fn(),
  ensureDirectory: vi.fn(),
  writeTextFile: vi.fn(),
  removeFile: vi.fn(),
}))

vi.mock('../../../L4-agents/videoServiceBridge.js', () => ({
  ffprobe: vi.fn(),
}))

const mockGenerateImage = vi.hoisted(() => vi.fn())
vi.mock('../../../L4-agents/analysisServiceBridge.js', () => ({
  generateImage: mockGenerateImage,
}))
vi.mock('../../../L0-pure/captions/captionGenerator.js', () => ({
  generateSRT: vi.fn().mockReturnValue('SRT content'),
  generateVTT: vi.fn().mockReturnValue('VTT content'),
  generateStyledASS: vi.fn().mockReturnValue('ASS content'),
}))

/**
 * Concrete implementation of VideoAsset for testing.
 */
class TestVideoAsset extends VideoAsset {
  readonly videoDir: string
  readonly videoPath: string
  readonly slug: string

  constructor(videoDir: string, slug: string) {
    super()
    this.videoDir = videoDir
    this.slug = slug
    this.videoPath = join(videoDir, `${slug}.mp4`)
  }
}

describe('VideoAsset', () => {
  let asset: TestVideoAsset

  beforeEach(() => {
    vi.clearAllMocks()
    asset = new TestVideoAsset('/recordings/test-video', 'test-video')
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('computed paths', () => {
    it('VideoAsset.REQ-001: computes transcript path as {videoDir}/transcript.json', () => {
      expect(asset.transcriptPath).toMatch(/recordings[/\\]test-video[/\\]transcript\.json$/)
    })

    it('VideoAsset.REQ-002: computes layout path as {videoDir}/layout.json', () => {
      expect(asset.layoutPath).toMatch(/recordings[/\\]test-video[/\\]layout\.json$/)
    })

    it('VideoAsset.REQ-003: computes captions directory as {videoDir}/captions/', () => {
      expect(asset.captionsDir).toMatch(/recordings[/\\]test-video[/\\]captions$/)
    })
  })

  describe('exists()', () => {
    it('VideoAsset.REQ-010: exists() returns true when video file exists on disk', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const result = await asset.exists()

      expect(result).toBe(true)
      expect(fileSystem.fileExists).toHaveBeenCalled()
      const calledPath = vi.mocked(fileSystem.fileExists).mock.calls[0][0]
      expect(calledPath).toMatch(/recordings[/\\]test-video[/\\]test-video\.mp4$/)
    })

    it('VideoAsset.REQ-011: exists() returns false when video file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const result = await asset.exists()

      expect(result).toBe(false)
    })
  })

  describe('getResult()', () => {
    it('VideoAsset.REQ-012: getResult() returns video path when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const result = await asset.getResult()

      expect(result).toMatch(/recordings[/\\]test-video[/\\]test-video\.mp4$/)
    })

    it('VideoAsset.REQ-013: getResult() throws "Video not found" error when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(asset.getResult()).rejects.toThrow('Video not found')
    })
  })

  describe('getMetadata()', () => {
    it('VideoAsset.REQ-020: extracts video duration in seconds via ffprobe', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: {
          duration: 120.5,
          size: 1024000,
          filename: '',
          nb_streams: 2,
          format_name: 'mp4',
          format_long_name: 'MPEG-4',
          start_time: 0,
          bit_rate: 5000000,
          tags: {},
        },
        streams: [
          {
            codec_type: 'video',
            width: 1920,
            height: 1080,
            index: 0,
            codec_name: 'h264',
            codec_long_name: 'H.264 / AVC',
            profile: 100,
            codec_time_base: '1/30',
            duration: '120.5',
            bit_rate: '5000000',
          },
        ],
        chapters: [],
      })

      const metadata = await asset.getMetadata()

      expect(metadata).toEqual({
        duration: 120.5,
        size: 1024000,
        width: 1920,
        height: 1080,
      })
    })

    it('VideoAsset.REQ-023: defaults resolution to 0×0 when no video stream found', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'audio', index: 0, codec_name: 'aac', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      const metadata = await asset.getMetadata()
      expect(metadata.width).toBe(0)
      expect(metadata.height).toBe(0)
    })

    it('VideoAsset.REQ-024: defaults duration and size to 0 when format fields missing', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { filename: '', nb_streams: 0, format_name: '', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [],
        chapters: [],
      })

      const metadata = await asset.getMetadata()
      expect(metadata.duration).toBe(0)
      expect(metadata.size).toBe(0)
    })

    it('VideoAsset.REQ-025: caches metadata after first extraction', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      await asset.getMetadata()

      expect(videoServiceBridge.ffprobe).toHaveBeenCalledTimes(1)
    })

    it('VideoAsset.REQ-026: force flag bypasses metadata cache and re-fetches', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      await asset.getMetadata({ force: true })

      expect(videoServiceBridge.ffprobe).toHaveBeenCalledTimes(2)
    })
  })

  describe('getTranscript()', () => {
    it('VideoAsset.REQ-030: loads transcript from disk when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Test transcript',
        segments: [],
        words: [],
      })

      const transcript = await asset.getTranscript()

      expect(transcript.text).toBe('Test transcript')
      const calledPath = vi.mocked(fileSystem.readJsonFile).mock.calls[0][0]
      expect(calledPath).toMatch(/recordings[/\\]test-video[/\\]transcript\.json$/)
    })

    it('VideoAsset.REQ-031: throws "Transcript not found" error when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(asset.getTranscript()).rejects.toThrow('Transcript not found')
    })

    it('VideoAsset.REQ-032: caches transcript after first load', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({ text: '', segments: [], words: [] })

      await asset.getTranscript()
      await asset.getTranscript()

      expect(fileSystem.readJsonFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('getCaptions()', () => {
    it('VideoAsset.REQ-040: returns existing caption paths when all three files exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const captions = await asset.getCaptions()

      expect(captions.srt).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.srt$/)
      expect(captions.vtt).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.vtt$/)
      expect(captions.ass).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.ass$/)
    })

    it('VideoAsset.REQ-041: generates SRT, VTT, and ASS captions when files do not exist', async () => {
      // First call for exists check on video, then for each caption file
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(false) // srt
        .mockResolvedValueOnce(false) // vtt
        .mockResolvedValueOnce(false) // ass
        .mockResolvedValueOnce(true) // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Test',
        segments: [{ id: 0, start: 0, end: 1, text: 'Test' }],
        words: [],
      })

      const captions = await asset.getCaptions()

      expect(fileSystem.ensureDirectory).toHaveBeenCalled()
      const dirPath = vi.mocked(fileSystem.ensureDirectory).mock.calls[0][0]
      expect(dirPath).toMatch(/recordings[/\\]test-video[/\\]captions$/)
      expect(fileSystem.writeTextFile).toHaveBeenCalledTimes(3)
      expect(captions.srt).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.srt$/)
    })

    it('VideoAsset.REQ-043: force flag regenerates captions even when files exist', async () => {
      // fileExists calls for caption files return true, but force overrides
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // srt
        .mockResolvedValueOnce(true) // vtt
        .mockResolvedValueOnce(true) // ass
        .mockResolvedValueOnce(true) // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Test',
        segments: [{ id: 0, start: 0, end: 1, text: 'Test' }],
        words: [],
      })

      await asset.getCaptions({ force: true })

      expect(fileSystem.writeTextFile).toHaveBeenCalledTimes(3)
    })

    it('VideoAsset.REQ-044: regenerates all captions when only some files exist', async () => {
      // srt exists, vtt doesn't, ass exists — should still generate
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)  // srt
        .mockResolvedValueOnce(false) // vtt
        .mockResolvedValueOnce(true)  // ass
        .mockResolvedValueOnce(true)  // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Test',
        segments: [{ id: 0, start: 0, end: 1, text: 'Test' }],
        words: [],
      })

      const captions = await asset.getCaptions()

      // Should generate all captions since not all existed
      expect(fileSystem.writeTextFile).toHaveBeenCalledTimes(3)
      expect(captions.srt).toBeDefined()
    })
  })

  describe('getChapters()', () => {
    it('VideoAsset.REQ-050: loads chapters from chapters/chapters.json when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [
          { timestamp: 0, title: 'Intro', description: 'Start' },
          { timestamp: 60, title: 'Main', description: 'Content' },
        ],
      })

      const chapters = await asset.getChapters()

      expect(chapters).toHaveLength(2)
      expect(chapters[0].title).toBe('Intro')
    })

    it('VideoAsset.REQ-051: returns empty array when chapters file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const chapters = await asset.getChapters()

      expect(chapters).toEqual([])
    })

    it('VideoAsset.REQ-052: returns empty array when chapters key is missing from file', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({})

      const chapters = await asset.getChapters()

      expect(chapters).toEqual([])
    })

    it('VideoAsset.REQ-053: force flag returns empty array (skips disk cache)', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [{ timestamp: 0, title: 'Ch1', description: '' }],
      })

      const chapters = await asset.getChapters({ force: true })

      // force=true causes !opts?.force to be false, so it skips disk read
      expect(chapters).toEqual([])
    })

    it('VideoAsset.REQ-054: caches chapters after first load', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [{ timestamp: 0, title: 'Ch1', description: '' }],
      })

      await asset.getChapters()
      await asset.getChapters()

      expect(fileSystem.readJsonFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('coverImagePath', () => {
    it('VideoAsset.REQ-004: computes cover image path as {videoDir}/cover.png', () => {
      expect(asset.coverImagePath).toMatch(/recordings[/\\]test-video[/\\]cover\.png$/)
    })
  })

  describe('generateCoverImage()', () => {
    it('VideoAsset.REQ-060: generates cover image with AI using post content as context', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)
      mockGenerateImage.mockResolvedValue(asset.coverImagePath)

      const result = await asset.generateCoverImage('Check out this TypeScript tutorial!')

      expect(mockGenerateImage).toHaveBeenCalledWith(
        expect.stringContaining('social media cover image'),
        expect.stringMatching(/cover\.png$/),
        expect.objectContaining({ size: '1024x1024', quality: 'high' }),
      )
      expect(result).toMatch(/cover\.png$/)
    })

    it('VideoAsset.REQ-062: returns cached path when cover image already exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const result = await asset.generateCoverImage('Some post content')

      expect(mockGenerateImage).not.toHaveBeenCalled()
      expect(result).toMatch(/cover\.png$/)
    })

    it('VideoAsset.REQ-063: generation prompt includes post content for context', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)
      mockGenerateImage.mockResolvedValue(asset.coverImagePath)

      await asset.generateCoverImage('Learn about async patterns in Node.js')

      const promptArg = mockGenerateImage.mock.calls[0][0]
      expect(promptArg).toContain('async patterns in Node.js')
    })
  })

  describe('clearCache()', () => {
    it('VideoAsset.REQ-070: clearCache() clears all in-memory cached data', async () => {
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      asset.clearCache()
      await asset.getMetadata()

      expect(videoServiceBridge.ffprobe).toHaveBeenCalledTimes(2)
    })
  })
})

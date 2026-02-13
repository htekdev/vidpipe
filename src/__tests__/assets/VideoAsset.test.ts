/**
 * Unit tests for the VideoAsset base class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VideoAsset, VideoMetadata, CaptionFiles } from '../../assets/VideoAsset.js'
import { AssetOptions } from '../../assets/Asset.js'
import { join } from '../../core/paths.js'
import * as fileSystem from '../../core/fileSystem.js'
import * as ffmpeg from '../../core/ffmpeg.js'

vi.mock('../../core/fileSystem.js', () => ({
  fileExists: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  ensureDirectory: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock('../../core/ffmpeg.js', () => ({
  ffprobe: vi.fn(),
}))

vi.mock('../../tools/ffmpeg/faceDetection.js', () => ({
  detectWebcamRegion: vi.fn().mockResolvedValue(null),
  getVideoResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
}))

vi.mock('../../tools/captions/captionGenerator.js', () => ({
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
    it('computes transcriptPath correctly', () => {
      expect(asset.transcriptPath).toMatch(/recordings[/\\]test-video[/\\]transcript\.json$/)
    })

    it('computes layoutPath correctly', () => {
      expect(asset.layoutPath).toMatch(/recordings[/\\]test-video[/\\]layout\.json$/)
    })

    it('computes captionsDir correctly', () => {
      expect(asset.captionsDir).toMatch(/recordings[/\\]test-video[/\\]captions$/)
    })
  })

  describe('exists()', () => {
    it('returns true when video file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const result = await asset.exists()

      expect(result).toBe(true)
      expect(fileSystem.fileExists).toHaveBeenCalled()
      const calledPath = vi.mocked(fileSystem.fileExists).mock.calls[0][0]
      expect(calledPath).toMatch(/recordings[/\\]test-video[/\\]test-video\.mp4$/)
    })

    it('returns false when video file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const result = await asset.exists()

      expect(result).toBe(false)
    })
  })

  describe('getResult()', () => {
    it('returns video path when video exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const result = await asset.getResult()

      expect(result).toMatch(/recordings[/\\]test-video[/\\]test-video\.mp4$/)
    })

    it('throws error when video does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(asset.getResult()).rejects.toThrow('Video not found')
    })
  })

  describe('getMetadata()', () => {
    it('returns video metadata from ffprobe', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
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

    it('defaults to 0 when no video stream found', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'audio', index: 0, codec_name: 'aac', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      const metadata = await asset.getMetadata()
      expect(metadata.width).toBe(0)
      expect(metadata.height).toBe(0)
    })

    it('defaults duration and size to 0 when format fields missing', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { filename: '', nb_streams: 0, format_name: '', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [],
        chapters: [],
      })

      const metadata = await asset.getMetadata()
      expect(metadata.duration).toBe(0)
      expect(metadata.size).toBe(0)
    })

    it('caches metadata on subsequent calls', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      await asset.getMetadata()

      expect(ffmpeg.ffprobe).toHaveBeenCalledTimes(1)
    })

    it('re-fetches metadata when force is true', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      await asset.getMetadata({ force: true })

      expect(ffmpeg.ffprobe).toHaveBeenCalledTimes(2)
    })
  })

  describe('getTranscript()', () => {
    it('loads transcript from disk when it exists', async () => {
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

    it('throws error when transcript does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(asset.getTranscript()).rejects.toThrow('Transcript not found')
    })

    it('caches transcript on subsequent calls', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({ text: '', segments: [], words: [] })

      await asset.getTranscript()
      await asset.getTranscript()

      expect(fileSystem.readJsonFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('getCaptions()', () => {
    it('returns existing caption file paths when all exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const captions = await asset.getCaptions()

      expect(captions.srt).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.srt$/)
      expect(captions.vtt).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.vtt$/)
      expect(captions.ass).toMatch(/recordings[/\\]test-video[/\\]captions[/\\]captions\.ass$/)
    })

    it('generates captions when files do not exist', async () => {
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

    it('regenerates captions when force is true even if files exist', async () => {
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

    it('generates captions when only some files exist', async () => {
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
    it('loads chapters from disk when file exists', async () => {
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

    it('returns empty array when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      const chapters = await asset.getChapters()

      expect(chapters).toEqual([])
    })

    it('returns empty array when chapters key is missing from file', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({})

      const chapters = await asset.getChapters()

      expect(chapters).toEqual([])
    })

    it('returns empty array when force is true (skips disk cache)', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [{ timestamp: 0, title: 'Ch1', description: '' }],
      })

      const chapters = await asset.getChapters({ force: true })

      // force=true causes !opts?.force to be false, so it skips disk read
      expect(chapters).toEqual([])
    })

    it('caches chapters on subsequent calls', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [{ timestamp: 0, title: 'Ch1', description: '' }],
      })

      await asset.getChapters()
      await asset.getChapters()

      expect(fileSystem.readJsonFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('clearCache()', () => {
    it('clears cached metadata', async () => {
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 60, size: 500000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1280, height: 720, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      await asset.getMetadata()
      asset.clearCache()
      await asset.getMetadata()

      expect(ffmpeg.ffprobe).toHaveBeenCalledTimes(2)
    })
  })
})

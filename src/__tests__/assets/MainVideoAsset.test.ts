/**
 * Unit tests for the MainVideoAsset class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MainVideoAsset } from '../../assets/MainVideoAsset.js'
import * as fileSystem from '../../core/fileSystem.js'
import * as ffmpeg from '../../core/ffmpeg.js'
import * as environment from '../../config/environment.js'

vi.mock('../../core/fileSystem.js', () => ({
  fileExists: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  ensureDirectory: vi.fn(),
  copyFile: vi.fn(),
  getFileStats: vi.fn(),
  listDirectory: vi.fn(),
  removeDirectory: vi.fn(),
  removeFile: vi.fn(),
  openReadStream: vi.fn(),
  openWriteStream: vi.fn(),
}))

vi.mock('../../core/ffmpeg.js', () => ({
  ffprobe: vi.fn(),
  getFFmpegPath: vi.fn().mockReturnValue('/usr/bin/ffmpeg'),
  getFFprobePath: vi.fn().mockReturnValue('/usr/bin/ffprobe'),
}))

vi.mock('../../config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OUTPUT_DIR: '/recordings',
    WATCH_DIR: '/watch',
  }),
}))

vi.mock('../../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../../tools/ffmpeg/faceDetection.js', () => ({
  detectWebcamRegion: vi.fn().mockResolvedValue(null),
  getVideoResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
}))

vi.mock('../../tools/captions/captionGenerator.js', () => ({
  generateSRT: vi.fn().mockReturnValue('SRT'),
  generateVTT: vi.fn().mockReturnValue('VTT'),
  generateStyledASS: vi.fn().mockReturnValue('ASS'),
}))

// Mock loaders to prevent actual agent instantiation during tests
vi.mock('../../assets/loaders.js', () => ({
  loadTranscription: vi.fn(async () => ({
    transcribeVideo: vi.fn().mockResolvedValue({
      text: 'test transcript',
      segments: [],
      words: [],
      language: 'en',
      duration: 100,
    }),
  })),
  loadSilenceRemovalAgent: vi.fn(async () => ({
    removeDeadSilence: vi.fn().mockResolvedValue({
      editedPath: '/recordings/test/test.mp4',
      removals: [],
      keepSegments: [],
      wasEdited: false,
    }),
  })),
  loadCaptionBurning: vi.fn(async () => ({
    burnCaptions: vi.fn().mockResolvedValue('/recordings/test/test-captioned.mp4'),
  })),
  loadShortsAgent: vi.fn(async () => ({
    generateShorts: vi.fn().mockResolvedValue([]),
  })),
  loadChapterAgent: vi.fn(async () => ({
    generateChapters: vi.fn().mockResolvedValue([]),
  })),
  loadFaceDetection: vi.fn(async () => ({
    detectWebcamRegion: vi.fn().mockResolvedValue(null),
    getVideoResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  })),
  loadVisualEnhancement: vi.fn(async () => ({
    enhanceVideo: vi.fn().mockResolvedValue({
      enhancedVideoPath: '/recordings/test/test-enhanced.mp4',
      overlays: [{ imagePath: '/tmp/test.png', width: 1024, height: 1024, opportunity: {} }],
      report: 'test report',
    }),
  })),
}))

describe('MainVideoAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('load()', () => {
    it('loads an existing video from directory', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)

      const asset = await MainVideoAsset.load('/recordings/my-video')

      expect(asset.slug).toBe('my-video')
      expect(asset.videoDir).toMatch(/recordings[/\\]my-video$/)
      expect(asset.videoPath).toMatch(/recordings[/\\]my-video[/\\]my-video\.mp4$/)
    })

    it('throws error when directory does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(MainVideoAsset.load('/recordings/nonexistent')).rejects.toThrow(
        'Video directory not found',
      )
    })

    it('throws error when video file does not exist in directory', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // directory exists
        .mockResolvedValueOnce(false) // video file does not exist

      await expect(MainVideoAsset.load('/recordings/my-video')).rejects.toThrow(
        'Video file not found',
      )
    })
  })

  describe('computed paths', () => {
    let asset: MainVideoAsset

    beforeEach(async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      asset = await MainVideoAsset.load('/recordings/test-slug')
    })

    it('computes videoPath correctly', () => {
      expect(asset.videoPath).toMatch(/recordings[/\\]test-slug[/\\]test-slug\.mp4$/)
    })

    it('computes editedVideoPath correctly', () => {
      expect(asset.editedVideoPath).toMatch(/recordings[/\\]test-slug[/\\]test-slug-edited\.mp4$/)
    })

    it('computes captionedVideoPath correctly', () => {
      expect(asset.captionedVideoPath).toMatch(/recordings[/\\]test-slug[/\\]test-slug-captioned\.mp4$/)
    })

    it('computes enhancedVideoPath correctly', () => {
      expect(asset.enhancedVideoPath).toMatch(/recordings[/\\]test-slug[/\\]test-slug-enhanced\.mp4$/)
    })

    it('computes producedVideoPath correctly', () => {
      expect(asset.producedVideoPath).toMatch(/recordings[/\\]test-slug[/\\]test-slug-produced\.mp4$/)
    })

    it('computes shortsJsonPath correctly', () => {
      expect(asset.shortsJsonPath).toMatch(/recordings[/\\]test-slug[/\\]shorts[/\\]shorts\.json$/)
    })

    it('computes mediumClipsJsonPath correctly', () => {
      expect(asset.mediumClipsJsonPath).toMatch(/recordings[/\\]test-slug[/\\]medium-clips[/\\]medium-clips\.json$/)
    })

    it('computes chaptersJsonPath correctly', () => {
      expect(asset.chaptersJsonPath).toMatch(/recordings[/\\]test-slug[/\\]chapters[/\\]chapters\.json$/)
    })

    it('computes summaryPath correctly', () => {
      expect(asset.summaryPath).toMatch(/recordings[/\\]test-slug[/\\]README\.md$/)
    })

    it('computes blogPath correctly', () => {
      expect(asset.blogPath).toMatch(/recordings[/\\]test-slug[/\\]blog-post\.md$/)
    })

    it('computes adjustedTranscriptPath correctly', () => {
      expect(asset.adjustedTranscriptPath).toMatch(/recordings[/\\]test-slug[/\\]transcript-edited\.json$/)
    })

    it('computes transcriptPath correctly (inherited)', () => {
      expect(asset.transcriptPath).toMatch(/recordings[/\\]test-slug[/\\]transcript\.json$/)
    })

    it('computes layoutPath correctly (inherited)', () => {
      expect(asset.layoutPath).toMatch(/recordings[/\\]test-slug[/\\]layout\.json$/)
    })

    it('computes captionsDir correctly (inherited)', () => {
      expect(asset.captionsDir).toMatch(/recordings[/\\]test-slug[/\\]captions$/)
    })
  })

  describe('exists()', () => {
    it('returns true when video file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const result = await asset.exists()

      expect(result).toBe(true)
    })
  })

  describe('getOriginalVideo()', () => {
    it('returns video path when exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      const result = await asset.getOriginalVideo()

      expect(result).toMatch(/recordings[/\\]test[/\\]test\.mp4$/)
    })

    it('throws error when video does not exist', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)

      await expect(asset.getOriginalVideo()).rejects.toThrow('Original video not found')
    })
  })

  describe('getEditedVideo()', () => {
    it('returns edited video path when exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      const result = await asset.getEditedVideo()

      expect(result).toMatch(/recordings[/\\]test[/\\]test-edited\.mp4$/)
    })

    it('generates edited video via agent when file does not exist', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir exists
        .mockResolvedValueOnce(true) // load: video exists
        .mockResolvedValueOnce(false) // edited video does not exist
        .mockResolvedValueOnce(true) // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'test transcript',
        segments: [],
        words: [],
        language: 'en',
        duration: 100,
      })

      // Mock ffprobe for toVideoFile call
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 100, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1000,
        mtime: new Date(),
      } as any)

      const asset = await MainVideoAsset.load('/recordings/test')
      const result = await asset.getEditedVideo()

      // Agent mock returns wasEdited: false, so original video path is returned
      expect(result).toMatch(/recordings[/\\]test[/\\]test\.mp4$/)
    })
  })

  describe('getEnhancedVideo()', () => {
    it('returns enhanced video path when file already exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      const result = await asset.getEnhancedVideo()

      expect(result).toMatch(/recordings[/\\]test[/\\]test-enhanced\.mp4$/)
    })

    it('falls back to edited video when SKIP_VISUAL_ENHANCEMENT is set', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir exists
        .mockResolvedValueOnce(true) // load: video exists
        .mockResolvedValueOnce(false) // enhanced video does not exist
        .mockResolvedValueOnce(true) // edited video exists (fallback)

      vi.mocked(environment.getConfig).mockReturnValue({
        OUTPUT_DIR: '/recordings',
        WATCH_DIR: '/watch',
        SKIP_VISUAL_ENHANCEMENT: true,
      } as any)

      const asset = await MainVideoAsset.load('/recordings/test')
      const result = await asset.getEnhancedVideo()

      // Should return edited video path (skipping enhancement)
      expect(result).toMatch(/recordings[/\\]test[/\\]test-edited\.mp4$/)
    })
  })

  describe('getShorts()', () => {
    it('returns shorts from JSON file when exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        shorts: [
          {
            id: 'short-1',
            title: 'First Short',
            slug: 'first-short',
            segments: [{ start: 0, end: 30, transition: null }],
            totalDuration: 30,
            outputPath: '/recordings/test/shorts/first-short/media.mp4',
            description: 'First short description',
            tags: ['test'],
          },
          {
            id: 'short-2',
            title: 'Second Short',
            slug: 'second-short',
            segments: [{ start: 60, end: 90, transition: null }],
            totalDuration: 30,
            outputPath: '/recordings/test/shorts/second-short/media.mp4',
            description: 'Second short description',
            tags: ['test'],
          },
        ],
      })

      const shorts = await asset.getShorts()

      expect(shorts).toHaveLength(2)
      expect(shorts[0].clip.id).toBe('short-1')
    })

    it('returns empty array when no shorts exist', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir
        .mockResolvedValueOnce(true) // load: video
        .mockResolvedValueOnce(false) // shorts json
        .mockResolvedValueOnce(false) // shorts dir
        .mockResolvedValueOnce(true) // transcript json for agent call

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'test transcript',
        segments: [],
        words: [],
        language: 'en',
        duration: 100,
      })

      const asset = await MainVideoAsset.load('/recordings/test')

      // Mock ffprobe for toVideoFile call
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 100, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1000,
        mtime: new Date(),
      } as any)

      const shorts = await asset.getShorts()

      expect(shorts).toEqual([])
    })
  })

  describe('getMediumClips()', () => {
    it('returns medium clips from JSON file when exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        clips: [
          {
            id: 'clip-1',
            title: 'First Clip',
            slug: 'first-clip',
            segments: [{ start: 0, end: 120, transition: null }],
            totalDuration: 120,
            outputPath: '/recordings/test/medium-clips/first-clip/media.mp4',
            description: 'First clip description',
            tags: ['test'],
          },
        ],
      })

      const clips = await asset.getMediumClips()

      expect(clips).toHaveLength(1)
      expect(clips[0].clip.id).toBe('clip-1')
    })
  })

  describe('getChapters()', () => {
    it('returns chapters from JSON file when exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        chapters: [
          { title: 'Introduction', startTime: 0 },
          { title: 'Main Content', startTime: 120 },
        ],
      })

      const chapters = await asset.getChapters()

      expect(chapters).toHaveLength(2)
      expect(chapters[0].title).toBe('Introduction')
    })
  })

  describe('getSummaryContent()', () => {
    it('returns summary content when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readTextFile).mockResolvedValue('# Video Summary\n\nThis is the summary.')

      const content = await asset.getSummaryContent()

      expect(content).toBe('# Video Summary\n\nThis is the summary.')
      const calledPath = vi.mocked(fileSystem.readTextFile).mock.calls[0][0]
      expect(calledPath).toMatch(/recordings[/\\]test[/\\]README\.md$/)
    })

    it('throws error when summary does not exist', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir
        .mockResolvedValueOnce(true) // load: video
        .mockResolvedValueOnce(false) // summary

      const asset = await MainVideoAsset.load('/recordings/test')

      await expect(asset.getSummaryContent()).rejects.toThrow('Summary not found')
    })
  })

  describe('getBlogContent()', () => {
    it('returns blog content when file exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readTextFile).mockResolvedValue('---\ntitle: Blog Post\n---\n\nContent')

      const content = await asset.getBlogContent()

      expect(content).toBe('---\ntitle: Blog Post\n---\n\nContent')
    })

    it('throws error when blog does not exist', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir
        .mockResolvedValueOnce(true) // load: video
        .mockResolvedValueOnce(false) // blog

      const asset = await MainVideoAsset.load('/recordings/test')

      await expect(asset.getBlogContent()).rejects.toThrow('Blog post not found')
    })
  })

  describe('getAdjustedTranscript()', () => {
    it('returns adjusted transcript when it exists', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Adjusted transcript',
        segments: [],
        words: [],
      })

      const transcript = await asset.getAdjustedTranscript()

      expect(transcript.text).toBe('Adjusted transcript')
    })

    it('falls back to original transcript when adjusted does not exist', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true) // load: dir
        .mockResolvedValueOnce(true) // load: video
        .mockResolvedValueOnce(false) // adjusted transcript
        .mockResolvedValueOnce(true) // original transcript

      const asset = await MainVideoAsset.load('/recordings/test')

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'Original transcript',
        segments: [],
        words: [],
      })

      const transcript = await asset.getAdjustedTranscript()

      expect(transcript.text).toBe('Original transcript')
    })
  })

  describe('toVideoFile()', () => {
    it('converts asset to VideoFile interface', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1024000,
        mtime: new Date('2024-01-01'),
        isFile: () => true,
        isDirectory: () => false,
      } as any)
      vi.mocked(ffmpeg.ffprobe).mockResolvedValue({
        format: { duration: 120, size: 1024000, filename: '', nb_streams: 1, format_name: 'mp4', format_long_name: '', start_time: 0, bit_rate: 0, tags: {} },
        streams: [{ codec_type: 'video', width: 1920, height: 1080, index: 0, codec_name: '', codec_long_name: '', profile: 0, codec_time_base: '', duration: '0', bit_rate: '0' }],
        chapters: [],
      })

      const asset = await MainVideoAsset.load('/recordings/test')
      const videoFile = await asset.toVideoFile()

      expect(videoFile.slug).toBe('test')
      expect(videoFile.videoDir).toMatch(/recordings[/\\]test$/)
      expect(videoFile.repoPath).toMatch(/recordings[/\\]test[/\\]test\.mp4$/)
      expect(videoFile.duration).toBe(120)
      expect(videoFile.size).toBe(1024000)
    })
  })

  describe('caching behavior', () => {
    it('caches shorts on subsequent calls', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({ shorts: [] })

      const asset = await MainVideoAsset.load('/recordings/test')

      await asset.getShorts()
      await asset.getShorts()

      // readJsonFile should only be called once for shorts (caching works)
      const shortsCalls = vi.mocked(fileSystem.readJsonFile).mock.calls.filter(
        (call) => (call[0] as string).includes('shorts.json'),
      )
      expect(shortsCalls).toHaveLength(1)
    })

    it('clearCache() clears all cached data', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({ shorts: [] })

      const asset = await MainVideoAsset.load('/recordings/test')

      await asset.getShorts()
      asset.clearCache()
      await asset.getShorts()

      const shortsCalls = vi.mocked(fileSystem.readJsonFile).mock.calls.filter(
        (call) => (call[0] as string).includes('shorts.json'),
      )
      expect(shortsCalls).toHaveLength(2)
    })
  })
})

/**
 * Unit tests for the MainVideoAsset class.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'
import * as fileSystem from '../../../L1-infra/fileSystem/fileSystem.js'
import * as videoServiceBridge from '../../../L4-agents/videoServiceBridge.js'
import * as environment from '../../../L1-infra/config/environment.js'
import * as analysisServiceBridge from '../../../L4-agents/analysisServiceBridge.js'
import * as SilenceRemovalAgent from '../../../L4-agents/SilenceRemovalAgent.js'
import * as captionGenerator from '../../../L0-pure/captions/captionGenerator.js'

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
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

vi.mock('../../../L4-agents/videoServiceBridge.js', () => ({
  ffprobe: vi.fn(),
  getFFmpegPath: vi.fn().mockReturnValue('/usr/bin/ffmpeg'),
  getFFprobePath: vi.fn().mockReturnValue('/usr/bin/ffprobe'),
  burnCaptions: vi.fn().mockResolvedValue('/recordings/test/test-captioned.mp4'),
  transcodeToMp4: vi.fn().mockResolvedValue('/recordings/test/test.mp4'),
  singlePassEditAndCaption: vi.fn().mockResolvedValue('/recordings/test/test-captioned.mp4'),
  extractCompositeClip: vi.fn(),
  compositeOverlays: vi.fn(),
  getVideoResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  detectWebcamRegion: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OUTPUT_DIR: '/recordings',
    WATCH_DIR: '/watch',
  }),
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))



vi.mock('../../../L0-pure/captions/captionGenerator.js', () => ({
  generateSRT: vi.fn().mockReturnValue('SRT'),
  generateVTT: vi.fn().mockReturnValue('VTT'),
  generateStyledASS: vi.fn().mockReturnValue('ASS'),
}))

// Mock L4 agents to prevent actual agent instantiation during tests
vi.mock('../../../L4-agents/analysisServiceBridge.js', () => ({
  transcribeVideo: vi.fn().mockResolvedValue({
    text: 'test transcript',
    segments: [],
    words: [],
    language: 'en',
    duration: 100,
  }),
  analyzeVideoClipDirection: vi.fn().mockResolvedValue(''),
  generateCaptions: vi.fn().mockResolvedValue({ srt: '', vtt: '', ass: '' }),
}))

vi.mock('../../../L4-agents/SilenceRemovalAgent.js', () => ({
  removeDeadSilence: vi.fn().mockResolvedValue({
    editedPath: '/recordings/test/test.mp4',
    removals: [],
    keepSegments: [],
    wasEdited: false,
  }),
}))

vi.mock('../../../L4-agents/ShortsAgent.js', () => ({
  generateShorts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L4-agents/MediumVideoAgent.js', () => ({
  generateMediumClips: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L4-agents/ChapterAgent.js', () => ({
  generateChapters: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L4-agents/ProducerAgent.js', () => ({
  ProducerAgent: vi.fn(),
}))

vi.mock('../../../L4-agents/SummaryAgent.js', () => ({
  generateSummary: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L4-agents/SocialMediaAgent.js', () => ({
  generateSocialPosts: vi.fn().mockResolvedValue([]),
  generateShortPosts: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L4-agents/BlogAgent.js', () => ({
  generateBlogPost: vi.fn().mockResolvedValue(''),
}))

vi.mock('../../../L4-agents/pipelineServiceBridge.js', () => ({
  buildPublishQueue: vi.fn().mockResolvedValue({ itemsCreated: 0, itemsSkipped: 0, errors: [] }),
  commitAndPush: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L5-assets/visualEnhancement.js', () => ({
  enhanceVideo: vi.fn().mockResolvedValue({
    enhancedVideoPath: '/recordings/test/test-enhanced.mp4',
    overlays: [{ imagePath: '/tmp/test.png', width: 1024, height: 1024, opportunity: {} }],
    report: 'test report',
  }),
}))

describe('MainVideoAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
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

  describe('ingest() — webm transcoding', () => {
    const mockProbeData = {
      format: { duration: 120, size: 5_000_000 },
      streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
    }

    const setupIngestMocks = (): void => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(false)
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue(mockProbeData as any)
    }

    it('transcodes .webm files to MP4 instead of copying', async () => {
      setupIngestMocks()
      vi.mocked(fileSystem.getFileStats)
        .mockRejectedValueOnce(new Error('missing destination'))
        .mockResolvedValueOnce({ size: 5_000_000 } as any)

      const asset = await MainVideoAsset.ingest('/watch/recording.webm')

      expect(videoServiceBridge.transcodeToMp4).toHaveBeenCalledWith(
        '/watch/recording.webm',
        expect.stringMatching(/recordings[/\\]recording[/\\]recording\.mp4$/),
      )
      expect(fileSystem.openReadStream).not.toHaveBeenCalled()
      expect(fileSystem.openWriteStream).not.toHaveBeenCalled()
      expect(asset.slug).toBe('recording')
    })

    it('copies .mp4 files without transcoding', async () => {
      setupIngestMocks()
      vi.mocked(fileSystem.getFileStats)
        .mockRejectedValueOnce(new Error('missing destination'))
        .mockResolvedValueOnce({ size: 5_000_000 } as any)

      const mockReadStream = {
        on: vi.fn().mockReturnThis(),
        pipe: vi.fn().mockReturnThis(),
      }
      const mockWriteStream = {
        on: vi.fn().mockImplementation((event: string, cb: () => void) => {
          if (event === 'finish') {
            setTimeout(() => cb(), 0)
          }
          return mockWriteStream
        }),
      }

      vi.mocked(fileSystem.openReadStream).mockReturnValue(mockReadStream as any)
      vi.mocked(fileSystem.openWriteStream).mockReturnValue(mockWriteStream as any)

      await MainVideoAsset.ingest('/watch/recording.mp4')

      expect(videoServiceBridge.transcodeToMp4).not.toHaveBeenCalled()
      expect(fileSystem.openReadStream).toHaveBeenCalledWith('/watch/recording.mp4')
      expect(fileSystem.openWriteStream).toHaveBeenCalledWith(
        expect.stringMatching(/recordings[/\\]recording[/\\]recording\.mp4$/),
      )
      expect(mockReadStream.pipe).toHaveBeenCalledWith(mockWriteStream)
    })

    it('skips transcode when transcoded MP4 already exists', async () => {
      setupIngestMocks()
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({ size: 5_000_000 } as any)

      await MainVideoAsset.ingest('/watch/recording.webm')

      expect(videoServiceBridge.transcodeToMp4).not.toHaveBeenCalled()
    })

    it('generates correct slug from .webm filename', async () => {
      setupIngestMocks()
      vi.mocked(fileSystem.getFileStats)
        .mockRejectedValueOnce(new Error('missing destination'))
        .mockResolvedValueOnce({ size: 5_000_000 } as any)

      const asset = await MainVideoAsset.ingest('/watch/my-screen-recording.webm')

      expect(videoServiceBridge.transcodeToMp4).toHaveBeenCalledWith(
        '/watch/my-screen-recording.webm',
        expect.stringMatching(/recordings[/\\]my-screen-recording[/\\]my-screen-recording\.mp4$/),
      )
      expect(asset.slug).toBe('my-screen-recording')
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

  describe('getTranscript()', () => {
    it('saves transcript to disk when generating via transcription service', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)   // load: dir
        .mockResolvedValueOnce(true)   // load: video
        .mockResolvedValueOnce(false)  // transcript.json does not exist — triggers generation

      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 100, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1000, mtime: new Date(),
      } as any)

      const asset = await MainVideoAsset.load('/recordings/test')
      const transcript = await asset.getTranscript()

      expect(transcript.text).toBe('test transcript')
      // Caller (MainVideoAsset) saves to transcriptPath
      expect(fileSystem.writeJsonFile).toHaveBeenCalledWith(
        expect.stringMatching(/recordings[/\\]test[/\\]transcript\.json$/),
        expect.objectContaining({ text: 'test transcript' }),
      )
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

      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
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

      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
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
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
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
    it('clearCache() clears all cached data', async () => {
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({ shorts: [] })

      const asset = await MainVideoAsset.load('/recordings/test')

      await asset.getShorts()
      asset.clearCache()
      await asset.getShorts()

      // With completion marker pattern, cache is internal to the asset
      // clearCache resets internal state, forcing reload
      const shortsCalls = vi.mocked(fileSystem.readJsonFile).mock.calls.filter(
        (call) => (call[0] as string).includes('shorts.json'),
      )
      expect(shortsCalls).toHaveLength(2)
    })
  })

  describe('getEditedVideo() transcript alignment', () => {
    it('re-transcribes the edited video and saves transcript-edited.json', async () => {
      const editedTranscript = {
        text: 'edited transcript',
        segments: [{ id: 0, start: 0, end: 5, text: 'edited', words: [] }],
        words: [{ word: 'edited', start: 0, end: 1 }],
        language: 'en',
        duration: 80,
      }

      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)  // load: dir exists
        .mockResolvedValueOnce(true)  // load: video exists
        .mockResolvedValueOnce(false) // edited video does not exist
        .mockResolvedValueOnce(true)  // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'original transcript',
        segments: [],
        words: [],
        language: 'en',
        duration: 100,
      })

      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 100, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1000,
        mtime: new Date(),
      } as any)

      vi.mocked(SilenceRemovalAgent.removeDeadSilence).mockResolvedValueOnce({
        editedPath: '/recordings/test/test-edited.mp4',
        removals: [{ start: 10, end: 30 }],
        keepSegments: [{ start: 0, end: 10 }, { start: 30, end: 100 }],
        wasEdited: true,
      })

      vi.mocked(analysisServiceBridge.transcribeVideo).mockResolvedValueOnce(editedTranscript)

      const asset = await MainVideoAsset.load('/recordings/test')
      const result = await asset.getEditedVideo()

      expect(result).toBe('/recordings/test/test-edited.mp4')
      expect(analysisServiceBridge.transcribeVideo).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: '/recordings/test/test-edited.mp4' }),
      )
      expect(fileSystem.writeJsonFile).toHaveBeenCalledWith(
        expect.stringMatching(/transcript-edited\.json$/),
        editedTranscript,
      )
    })

    it('does not re-transcribe when no silence was removed', async () => {
      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)  // load: dir exists
        .mockResolvedValueOnce(true)  // load: video exists
        .mockResolvedValueOnce(false) // edited video does not exist
        .mockResolvedValueOnce(true)  // transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'original',
        segments: [],
        words: [],
        language: 'en',
        duration: 100,
      })

      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 100, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({
        size: 1000,
        mtime: new Date(),
      } as any)

      vi.mocked(SilenceRemovalAgent.removeDeadSilence).mockResolvedValueOnce({
        editedPath: '/recordings/test/test.mp4',
        removals: [],
        keepSegments: [],
        wasEdited: false,
      })

      const asset = await MainVideoAsset.load('/recordings/test')
      await asset.getEditedVideo()

      expect(analysisServiceBridge.transcribeVideo).not.toHaveBeenCalled()
      expect(fileSystem.writeJsonFile).not.toHaveBeenCalled()
    })
  })

  describe('getCaptions() uses adjusted transcript', () => {
    it('uses adjusted transcript for caption generation when it exists', async () => {
      const adjustedTranscript = {
        text: 'adjusted text',
        segments: [{ id: 0, start: 0, end: 5, text: 'adjusted', words: [] }],
        words: [{ word: 'adjusted', start: 0, end: 1 }],
        language: 'en',
        duration: 80,
      }

      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)  // load: dir
        .mockResolvedValueOnce(true)  // load: video
        .mockResolvedValueOnce(false) // srt
        .mockResolvedValueOnce(false) // vtt
        .mockResolvedValueOnce(false) // ass
        .mockResolvedValueOnce(true)  // adjusted transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue(adjustedTranscript)

      const asset = await MainVideoAsset.load('/recordings/test')
      await asset.getCaptions()

      expect(captionGenerator.generateSRT).toHaveBeenCalledWith(adjustedTranscript)
      expect(captionGenerator.generateVTT).toHaveBeenCalledWith(adjustedTranscript)
      expect(captionGenerator.generateStyledASS).toHaveBeenCalledWith(adjustedTranscript)
    })

    it('falls back to original transcript when adjusted does not exist', async () => {
      const originalTranscript = {
        text: 'original text',
        segments: [],
        words: [],
        language: 'en',
        duration: 100,
      }

      vi.mocked(fileSystem.fileExists)
        .mockResolvedValueOnce(true)  // load: dir
        .mockResolvedValueOnce(true)  // load: video
        .mockResolvedValueOnce(false) // srt
        .mockResolvedValueOnce(false) // vtt
        .mockResolvedValueOnce(false) // ass
        .mockResolvedValueOnce(false) // adjusted transcript does NOT exist
        .mockResolvedValueOnce(true)  // original transcript exists

      vi.mocked(fileSystem.readJsonFile).mockResolvedValue(originalTranscript)

      const asset = await MainVideoAsset.load('/recordings/test')
      await asset.getCaptions()

      expect(captionGenerator.generateSRT).toHaveBeenCalledWith(originalTranscript)
    })
  })
  describe('buildQueue()', () => {
    it('passes linked idea IDs to buildPublishQueue', async () => {
      const pipelineBridge = await import('../../../L4-agents/pipelineServiceBridge.js')
      const mockBuildPublishQueue = vi.mocked(pipelineBridge.buildPublishQueue)
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({ size: 1000, mtime: Date.now() } as any)
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 120, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)

      const asset = await MainVideoAsset.load('/recordings/test')
      asset.setIdeas([
        {
          issueNumber: 1,
          issueUrl: 'https://github.com/htekdev/content-management/issues/1',
          repoFullName: 'htekdev/content-management',
          id: 'idea-1',
          topic: 'Topic 1',
          hook: 'Hook 1',
          audience: 'Developers',
          keyTakeaway: 'Takeaway 1',
          talkingPoints: ['Point 1'],
          platforms: [],
          status: 'recorded',
          tags: ['tag-1'],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishBy: '2026-02-01',
        },
      ])

      await asset.buildQueue([], [], [], '/recordings/test/test-captioned.mp4')

      expect(mockBuildPublishQueue).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        [],
        [],
        '/recordings/test/test-captioned.mp4',
        ['1'],
      )
    })
  })

  describe('generateShortPostsData() summary context', () => {
    it('passes summary to generateShortPosts when provided', async () => {
      const SocialMedia = await import('../../../L4-agents/SocialMediaAgent.js')
      const mockGenerateShortPosts = vi.mocked(SocialMedia.generateShortPosts)
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({ size: 1000, mtime: Date.now() } as any)
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 120, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      const asset = await MainVideoAsset.load('/recordings/test')
      const mockShort = {
        id: 's1', title: 'Test Short', slug: 'test-short',
        segments: [{ start: 0, end: 15, description: 'intro' }],
        totalDuration: 15, outputPath: '/tmp/short.mp4',
        description: 'A test', tags: ['test'],
      } as any
      const mockTranscript = { text: 'Hello', segments: [{ start: 0, end: 10, text: 'Hello' }], words: [] } as any
      const mockSummary = {
        title: 'Full Video', overview: 'A comprehensive overview',
        keyTopics: ['testing'], snapshots: [], markdownPath: '/tmp/README.md',
      }
      await asset.generateShortPostsData(mockShort, mockTranscript, undefined, mockSummary)
      expect(mockGenerateShortPosts).toHaveBeenCalledWith(
        expect.any(Object), mockShort, mockTranscript, undefined, mockSummary,
      )
    })
    it('works without summary (backward compatible)', async () => {
      const SocialMedia = await import('../../../L4-agents/SocialMediaAgent.js')
      const mockGenerateShortPosts = vi.mocked(SocialMedia.generateShortPosts)
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({ size: 1000, mtime: Date.now() } as any)
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 120, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      const asset = await MainVideoAsset.load('/recordings/test')
      const mockShort = {
        id: 's1', title: 'Test Short', slug: 'test-short',
        segments: [{ start: 0, end: 15, description: 'intro' }],
        totalDuration: 15, outputPath: '/tmp/short.mp4',
        description: 'A test', tags: ['test'],
      } as any
      const mockTranscript = { text: 'Hello', segments: [{ start: 0, end: 10, text: 'Hello' }], words: [] } as any
      await asset.generateShortPostsData(mockShort, mockTranscript)
      expect(mockGenerateShortPosts).toHaveBeenCalledWith(
        expect.any(Object), mockShort, mockTranscript, undefined, undefined,
      )
    })
    it('generateMediumClipPostsData passes summary through to generateShortPosts', async () => {
      const SocialMedia = await import('../../../L4-agents/SocialMediaAgent.js')
      const mockGenerateShortPosts = vi.mocked(SocialMedia.generateShortPosts)
      mockGenerateShortPosts.mockResolvedValue([])
      vi.mocked(fileSystem.fileExists).mockResolvedValue(true)
      vi.mocked(fileSystem.getFileStats).mockResolvedValue({ size: 1000, mtime: Date.now() } as any)
      vi.mocked(videoServiceBridge.ffprobe).mockResolvedValue({
        format: { duration: 120, size: 1000 },
        streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
      } as any)
      vi.mocked(fileSystem.readJsonFile).mockResolvedValue({
        text: 'adjusted', segments: [{ start: 0, end: 10, text: 'adjusted' }], words: [],
      })
      const asset = await MainVideoAsset.load('/recordings/test')
      const mockClip = {
        id: 'm1', title: 'Medium Clip', slug: 'medium-clip',
        segments: [{ start: 0, end: 90, description: 'main' }],
        totalDuration: 90, outputPath: '/tmp/medium.mp4',
        captionedPath: '/tmp/medium-captioned.mp4',
        description: 'A medium clip', tags: ['test'],
        hook: 'Test hook', topic: 'Testing',
      } as any
      const mockSummary = {
        title: 'Full Video', overview: 'Overview text',
        keyTopics: ['testing'], snapshots: [], markdownPath: '/tmp/README.md',
      }
      await asset.generateMediumClipPostsData(mockClip, undefined, mockSummary)
      expect(mockGenerateShortPosts).toHaveBeenCalledWith(
        expect.any(Object), expect.objectContaining({ title: 'Medium Clip' }),
        expect.any(Object), undefined, mockSummary,
      )
    })
  })
})

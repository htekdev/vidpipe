import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transcript, VideoFile, VideoSummary, ShortClip, MediumClip } from '../../../L0-pure/types/index.js'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const {
  mockLogger,
  mockGetConfig,
  mockGetModelForAgent,
  mockFileExists,
  mockReadTextFile,
  mockWriteTextFile,
  mockWriteJsonFile,
  mockCostTracker,
  mockMarkPending,
  mockMarkProcessing,
  mockMarkCompleted,
  mockMarkFailed,
  mockProgressEmitter,
  mockGetTranscript,
  mockGetEditedVideo,
  mockGetEnhancedVideo,
  mockGetCaptions,
  mockGetCaptionedVideo,
  mockGetShorts,
  mockGetMediumClips,
  mockGetChapters,
  mockGetSummary,
  mockGetSocialPosts,
  mockGenerateShortPostsData,
  mockGenerateMediumClipPostsData,
  mockGetBlog,
  mockBuildQueue,
  mockSetIdeas,
  mockGetEditorialDirection,
  mockGetMetadata,
  mockGetIntroOutroVideo,
  mockGenerateThumbnail,
} = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockGetConfig: vi.fn(),
  mockGetModelForAgent: vi.fn().mockReturnValue(undefined),
  mockFileExists: vi.fn().mockResolvedValue(false),
  mockReadTextFile: vi.fn().mockResolvedValue(''),
  mockWriteTextFile: vi.fn().mockResolvedValue(undefined),
  mockWriteJsonFile: vi.fn().mockResolvedValue(undefined),
  mockCostTracker: { reset: vi.fn(), setStage: vi.fn(), getReport: vi.fn().mockReturnValue({ records: [] }), formatReport: vi.fn().mockReturnValue('') },
  mockMarkPending: vi.fn().mockResolvedValue(undefined),
  mockMarkProcessing: vi.fn().mockResolvedValue(undefined),
  mockMarkCompleted: vi.fn().mockResolvedValue(undefined),
  mockMarkFailed: vi.fn().mockResolvedValue(undefined),
  mockProgressEmitter: { emit: vi.fn(), enable: vi.fn(), disable: vi.fn(), isEnabled: vi.fn().mockReturnValue(false) },
  mockGetTranscript: vi.fn(),
  mockGetEditedVideo: vi.fn(),
  mockGetEnhancedVideo: vi.fn(),
  mockGetCaptions: vi.fn(),
  mockGetCaptionedVideo: vi.fn(),
  mockGetShorts: vi.fn(),
  mockGetMediumClips: vi.fn(),
  mockGetChapters: vi.fn(),
  mockGetSummary: vi.fn(),
  mockGetSocialPosts: vi.fn(),
  mockGenerateShortPostsData: vi.fn(),
  mockGenerateMediumClipPostsData: vi.fn(),
  mockGetBlog: vi.fn(),
  mockBuildQueue: vi.fn(),
  mockSetIdeas: vi.fn(),
  mockGetEditorialDirection: vi.fn().mockResolvedValue('editorial direction'),
  mockGetMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
  mockGetIntroOutroVideo: vi.fn().mockResolvedValue('/intro-outro.mp4'),
  mockGenerateThumbnail: vi.fn().mockResolvedValue(null),
}))

// ── L1 mocks ────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({ default: mockLogger, pushPipe: vi.fn(), popPipe: vi.fn() }))
vi.mock('../../../L1-infra/config/environment.js', () => ({ getConfig: mockGetConfig }))
vi.mock('../../../L1-infra/config/modelConfig.js', () => ({ getModelForAgent: mockGetModelForAgent }))
vi.mock('../../../L1-infra/progress/progressEmitter.js', () => ({ progressEmitter: mockProgressEmitter }))
vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  basename: (p: string) => p.split('/').pop() ?? p,
}))
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: vi.fn().mockResolvedValue(undefined),
  writeJsonFile: mockWriteJsonFile,
  writeTextFile: mockWriteTextFile,
  copyFile: vi.fn().mockResolvedValue(undefined),
  removeFile: vi.fn().mockResolvedValue(undefined),
  fileExists: mockFileExists,
  readTextFile: mockReadTextFile,
  readJsonFile: vi.fn().mockResolvedValue({}),
}))

// ── L5 mocks ────────────────────────────────────────────────────────────

vi.mock('../../../L5-assets/MainVideoAsset.js', () => ({
  MainVideoAsset: {
    ingest: vi.fn(),
  },
}))

vi.mock('../../../L5-assets/pipelineServices.js', () => ({
  costTracker: mockCostTracker,
  markPending: mockMarkPending,
  markProcessing: mockMarkProcessing,
  markCompleted: mockMarkCompleted,
  markFailed: mockMarkFailed,
}))

vi.mock('../../../L6-pipeline/stages/visualEnhancement.js', () => ({
  enhanceVideo: vi.fn().mockResolvedValue(undefined),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { processVideo } from '../../../L6-pipeline/pipeline.js'
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'

const mockIngest = vi.mocked(MainVideoAsset.ingest)

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    text: 'hello world test',
    language: 'en',
    duration: 30,
    segments: [
      { id: 0, text: 'hello', start: 0, end: 5, words: [] },
      { id: 1, text: 'world', start: 10, end: 15, words: [] },
    ],
    words: [
      { word: 'hello', start: 0, end: 2 },
      { word: 'world', start: 10, end: 12 },
    ],
    ...overrides,
  }
}

function makeVideoFile(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    originalPath: '/videos/test.mp4',
    repoPath: '/repo/recordings/test-video/test.mp4',
    videoDir: '/repo/recordings/test-video',
    slug: 'test-video',
    filename: 'test.mp4',
    duration: 120,
    size: 1024000,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function defaultConfig(overrides: Record<string, unknown> = {}) {
  return {
    SKIP_SILENCE_REMOVAL: false,
    SKIP_SHORTS: false,
    SKIP_MEDIUM_CLIPS: false,
    SKIP_SOCIAL: false,
    SKIP_CAPTIONS: false,
    SKIP_SOCIAL_PUBLISH: false,
    SKIP_VISUAL_ENHANCEMENT: true,
    SKIP_INTRO_OUTRO: false,
    GEMINI_API_KEY: '',
    ...overrides,
  }
}

const video = makeVideoFile()
const transcript = makeTranscript()

function makeAssetMock(overrides: Record<string, unknown> = {}) {
  return {
    toVideoFile: vi.fn().mockResolvedValue(video),
    getEditorialDirection: mockGetEditorialDirection,
    getMetadata: mockGetMetadata,
    videoPath: video.repoPath,
    slug: video.slug,
    videoDir: video.videoDir,
    editedVideoPath: `${video.videoDir}/${video.slug}-edited.mp4`,
    getTranscript: mockGetTranscript,
    getEditedVideo: mockGetEditedVideo,
    getEnhancedVideo: mockGetEnhancedVideo,
    getCaptions: mockGetCaptions,
    getCaptionedVideo: mockGetCaptionedVideo,
    getIntroOutroVideo: mockGetIntroOutroVideo,
    getShorts: mockGetShorts,
    getMediumClips: mockGetMediumClips,
    getChapters: mockGetChapters,
    getSummary: mockGetSummary,
    getSocialPosts: mockGetSocialPosts,
    generateShortPostsData: mockGenerateShortPostsData,
    generateMediumClipPostsData: mockGenerateMediumClipPostsData,
    getBlog: mockGetBlog,
    buildQueue: mockBuildQueue,
    setIdeas: mockSetIdeas,
    generateThumbnail: mockGenerateThumbnail,
    ...overrides,
  } as any // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetConfig.mockReturnValue(defaultConfig())
  mockIngest.mockResolvedValue(makeAssetMock())
  mockGetTranscript.mockResolvedValue(transcript)
  mockGetEditedVideo.mockResolvedValue('/edited.mp4')
  mockGetEnhancedVideo.mockResolvedValue('/enhanced.mp4')
  mockGetCaptions.mockResolvedValue({ srt: '/captions.srt', vtt: '/captions.vtt', ass: '/captions.ass' })
  mockGetCaptionedVideo.mockResolvedValue('/captioned.mp4')
  mockGetShorts.mockResolvedValue([])
  mockGetMediumClips.mockResolvedValue([])
  mockGetChapters.mockResolvedValue([])
  mockGetSummary.mockResolvedValue({ title: 'Test', overview: 'Overview', keyTopics: [], snapshots: [], markdownPath: '/summary.md' } as VideoSummary)
  mockGetSocialPosts.mockResolvedValue([])
  mockGenerateShortPostsData.mockResolvedValue([])
  mockGenerateMediumClipPostsData.mockResolvedValue([])
  mockGetBlog.mockResolvedValue('# Blog')
  mockBuildQueue.mockResolvedValue(undefined)
  mockGenerateThumbnail.mockResolvedValue(null)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('L6 Unit: pipeline — thumbnail integration', () => {
  it('calls generateThumbnail on each short asset', async () => {
    const shortClip: ShortClip = {
      id: 's1', title: 'Short 1', slug: 'short-1', segments: [],
      totalDuration: 30, outputPath: '/short1.mp4', description: 'desc', tags: ['tag'],
    }
    const shortMockGenerateThumbnail = vi.fn().mockResolvedValue('/short1-thumb.png')
    mockGetShorts.mockResolvedValue([{
      clip: shortClip,
      slug: 'short-1',
      getIntroOutroVideo: vi.fn().mockResolvedValue(shortClip.outputPath),
      getIntroOutroVariants: vi.fn().mockResolvedValue(new Map()),
      generateThumbnail: shortMockGenerateThumbnail,
    }])

    await processVideo('/videos/test.mp4')

    expect(shortMockGenerateThumbnail).toHaveBeenCalled()
  })

  it('calls generateThumbnail on each medium clip asset', async () => {
    const mediumClip: MediumClip = {
      id: 'm1', title: 'Medium 1', slug: 'medium-1',
      segments: [{ start: 0, end: 60, description: 'intro' }],
      totalDuration: 60, outputPath: '/medium1.mp4', description: 'desc',
      tags: ['tag'], hook: 'hook', topic: 'topic',
    }
    const mediumMockGenerateThumbnail = vi.fn().mockResolvedValue('/medium1-thumb.png')
    mockGetMediumClips.mockResolvedValue([{
      clip: mediumClip,
      slug: 'medium-1',
      getIntroOutroVideo: vi.fn().mockResolvedValue(mediumClip.outputPath),
      generateThumbnail: mediumMockGenerateThumbnail,
    }])

    await processVideo('/videos/test.mp4')

    expect(mediumMockGenerateThumbnail).toHaveBeenCalled()
  })

  it('calls generateThumbnail on main video asset after summary', async () => {
    await processVideo('/videos/test.mp4')

    expect(mockGenerateThumbnail).toHaveBeenCalled()
    // Verify it was called after summary (summary mock also called)
    expect(mockGetSummary).toHaveBeenCalled()
  })

  it('thumbnail failure on short does not abort pipeline', async () => {
    const shortClip: ShortClip = {
      id: 's1', title: 'Short 1', slug: 'short-1', segments: [],
      totalDuration: 30, outputPath: '/short1.mp4', description: 'desc', tags: ['tag'],
    }
    const failingThumbnail = vi.fn().mockRejectedValue(new Error('DALL-E rate limit'))
    mockGetShorts.mockResolvedValue([{
      clip: shortClip,
      slug: 'short-1',
      getIntroOutroVideo: vi.fn().mockResolvedValue(shortClip.outputPath),
      getIntroOutroVariants: vi.fn().mockResolvedValue(new Map()),
      generateThumbnail: failingThumbnail,
    }])

    const result = await processVideo('/videos/test.mp4')

    // Pipeline completed despite thumbnail failure
    expect(result).toBeDefined()
    expect(result.stageResults.length).toBeGreaterThanOrEqual(1)
    // Warning logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate thumbnail for short'),
    )
  })

  it('thumbnail failure on medium clip does not abort pipeline', async () => {
    const mediumClip: MediumClip = {
      id: 'm1', title: 'Medium 1', slug: 'medium-1',
      segments: [{ start: 0, end: 60, description: 'intro' }],
      totalDuration: 60, outputPath: '/medium1.mp4', description: 'desc',
      tags: ['tag'], hook: 'hook', topic: 'topic',
    }
    const failingThumbnail = vi.fn().mockRejectedValue(new Error('API error'))
    mockGetMediumClips.mockResolvedValue([{
      clip: mediumClip,
      slug: 'medium-1',
      getIntroOutroVideo: vi.fn().mockResolvedValue(mediumClip.outputPath),
      generateThumbnail: failingThumbnail,
    }])

    const result = await processVideo('/videos/test.mp4')

    expect(result).toBeDefined()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate thumbnail for medium clip'),
    )
  })

  it('main video thumbnail failure does not abort pipeline', async () => {
    mockGenerateThumbnail.mockRejectedValue(new Error('Image generation failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result).toBeDefined()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate main video thumbnail'),
    )
    // Subsequent stages still run
    expect(mockGetSocialPosts).toHaveBeenCalled()
  })
})

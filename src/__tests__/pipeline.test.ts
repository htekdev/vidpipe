import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transcript, VideoFile, StageResult, VideoSummary, ShortClip, MediumClip, SocialPost, Chapter } from '../types/index.js'
import type { ProduceResult } from '../agents/ProducerAgent.js'
import { PipelineStage } from '../types/index.js'

// ---- Hoisted mock variables (vi.mock is hoisted above imports) ----

const {
  mockLogger,
  mockGetConfig,
  mockTranscribeVideo,
  mockGenerateCaptions,
  mockGenerateSummary,
  mockGenerateShorts,
  mockGenerateMediumClips,
  mockGenerateSocialPosts,
  mockGenerateShortPosts,
  mockGenerateBlogPost,
  mockGenerateChapters,
  mockCommitAndPush,
  mockProducerProduce,
  mockBurnCaptions,
  mockSinglePassEditAndCaption,
  mockBuildPublishQueue,
  mockGetModelForAgent,
  mockFileExists,
  mockReadTextFile,
  mockWriteTextFile,
  mockWriteJsonFile,
} = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  mockGetConfig: vi.fn(),
  mockTranscribeVideo: vi.fn(),
  mockGenerateCaptions: vi.fn(),
  mockGenerateSummary: vi.fn(),
  mockGenerateShorts: vi.fn(),
  mockGenerateMediumClips: vi.fn(),
  mockGenerateSocialPosts: vi.fn(),
  mockGenerateShortPosts: vi.fn(),
  mockGenerateBlogPost: vi.fn(),
  mockGenerateChapters: vi.fn(),
  mockCommitAndPush: vi.fn(),
  mockProducerProduce: vi.fn(),
  mockBurnCaptions: vi.fn(),
  mockSinglePassEditAndCaption: vi.fn(),
  mockBuildPublishQueue: vi.fn(),
  mockGetModelForAgent: vi.fn().mockReturnValue(undefined),
  mockFileExists: vi.fn().mockResolvedValue(false),
  mockReadTextFile: vi.fn().mockResolvedValue(''),
  mockWriteTextFile: vi.fn().mockResolvedValue(undefined),
  mockWriteJsonFile: vi.fn().mockResolvedValue(undefined),
}))

// ---- Mock all external dependencies ----

vi.mock('../config/logger.js', () => ({ default: mockLogger }))
vi.mock('../config/environment.js', () => ({ getConfig: mockGetConfig }))
vi.mock('../services/transcription.js', () => ({ transcribeVideo: mockTranscribeVideo }))
vi.mock('../services/captionGeneration.js', () => ({ generateCaptions: mockGenerateCaptions }))
vi.mock('../agents/SummaryAgent.js', () => ({ generateSummary: mockGenerateSummary }))
vi.mock('../agents/ShortsAgent.js', () => ({ generateShorts: mockGenerateShorts }))
vi.mock('../agents/MediumVideoAgent.js', () => ({ generateMediumClips: mockGenerateMediumClips }))
vi.mock('../agents/SocialMediaAgent.js', () => ({
  generateSocialPosts: mockGenerateSocialPosts,
  generateShortPosts: mockGenerateShortPosts,
}))
vi.mock('../agents/BlogAgent.js', () => ({ generateBlogPost: mockGenerateBlogPost }))
vi.mock('../agents/ChapterAgent.js', () => ({ generateChapters: mockGenerateChapters }))
vi.mock('../services/gitOperations.js', () => ({ commitAndPush: mockCommitAndPush }))
vi.mock('../agents/ProducerAgent.js', () => {
  const MockProducerAgent = function() {
    return {
      produce: mockProducerProduce,
      destroy: async () => {},
    }
  }
  return { ProducerAgent: MockProducerAgent }
})
vi.mock('../tools/ffmpeg/captionBurning.js', () => ({ burnCaptions: mockBurnCaptions }))
vi.mock('../tools/ffmpeg/singlePassEdit.js', () => ({ singlePassEditAndCaption: mockSinglePassEditAndCaption }))
vi.mock('../services/queueBuilder.js', () => ({ buildPublishQueue: mockBuildPublishQueue }))
vi.mock('../config/modelConfig.js', () => ({ getModelForAgent: mockGetModelForAgent }))
vi.mock('../services/costTracker.js', () => ({
  costTracker: { reset: vi.fn(), setStage: vi.fn(), getReport: vi.fn().mockReturnValue({ records: [] }), formatReport: vi.fn().mockReturnValue('') },
}))
vi.mock('../core/paths.js', () => ({
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  basename: (p: string) => p.split('/').pop() ?? p,
}))
vi.mock('../core/fileSystem.js', () => ({
  ensureDirectory: vi.fn().mockResolvedValue(undefined),
  writeJsonFile: mockWriteJsonFile,
  writeTextFile: mockWriteTextFile,
  copyFile: vi.fn().mockResolvedValue(undefined),
  removeFile: vi.fn().mockResolvedValue(undefined),
  fileExists: mockFileExists,
  readTextFile: mockReadTextFile,
}))
vi.mock('../tools/gemini/geminiClient.js', () => ({
  analyzeVideoClipDirection: vi.fn().mockResolvedValue('## Clip Direction\nSome suggestions'),
}))

// Mock MainVideoAsset to avoid loading faceDetection at module load time
vi.mock('../assets/MainVideoAsset.js', () => {
  return {
    MainVideoAsset: {
      ingest: vi.fn(),
    },
  }
})

// ---- Import after mocks ----

import { adjustTranscript, runStage, processVideo, processVideoSafe } from '../pipeline.js'
import { MainVideoAsset } from '../assets/MainVideoAsset.js'

// Get reference to mocked ingest for use in tests
const mockMainVideoAssetIngest = vi.mocked(MainVideoAsset.ingest)

// ---- Helpers ----

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    text: 'hello world test',
    language: 'en',
    duration: 30,
    segments: [
      { id: 0, text: 'hello', start: 0, end: 5, words: [] },
      { id: 1, text: 'world', start: 10, end: 15, words: [] },
      { id: 2, text: 'test', start: 20, end: 25, words: [] },
    ],
    words: [
      { word: 'hello', start: 0, end: 2 },
      { word: 'world', start: 10, end: 12 },
      { word: 'test', start: 20, end: 22 },
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
    SKIP_GIT: false,
    SKIP_SOCIAL_PUBLISH: false,
    GEMINI_API_KEY: '',
    ...overrides,
  }
}

// ---- Tests ----

describe('adjustTranscript', () => {
  it('empty removals = no change', () => {
    const transcript = makeTranscript()
    const result = adjustTranscript(transcript, [])

    expect(result.duration).toBe(30)
    expect(result.segments).toHaveLength(3)
    expect(result.words).toHaveLength(3)
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[1].start).toBe(10)
    expect(result.segments[2].start).toBe(20)
  })

  it('correctly shifts word timestamps based on removal regions', () => {
    const transcript = makeTranscript()
    // Remove silence from 5-10 (5 seconds gap between seg 0 and seg 1)
    const result = adjustTranscript(transcript, [{ start: 5, end: 10 }])

    // Segments after removal should be shifted by 5s
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[0].end).toBe(5)
    // segment at 10-15 shifts to 5-10
    expect(result.segments[1].start).toBe(5)
    expect(result.segments[1].end).toBe(10)
    // segment at 20-25 shifts to 15-20
    expect(result.segments[2].start).toBe(15)
    expect(result.segments[2].end).toBe(20)

    // Words should also shift
    expect(result.words[1].start).toBe(5)
    expect(result.words[2].start).toBe(15)
  })

  it('multiple removals accumulate', () => {
    const transcript = makeTranscript()
    // Remove 5-10 (5s) and 15-20 (5s) — total 10s removed
    const result = adjustTranscript(transcript, [
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ])

    // seg 0 (0-5) → no shift
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[0].end).toBe(5)
    // seg 1 (10-15) → shifted by first removal (5s) → 5-10
    expect(result.segments[1].start).toBe(5)
    expect(result.segments[1].end).toBe(10)
    // seg 2 (20-25) → shifted by both removals (10s) → 10-15
    expect(result.segments[2].start).toBe(10)
    expect(result.segments[2].end).toBe(15)

    // Duration 30 → shifted by 10s total removed
    expect(result.duration).toBe(20)
  })

  it('filters out segments entirely within a removal region', () => {
    const transcript = makeTranscript()
    // Remove 10-15 — this encompasses segment 1 entirely
    const result = adjustTranscript(transcript, [{ start: 10, end: 15 }])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].text).toBe('hello')
    expect(result.segments[1].text).toBe('test')
  })

  it('filters out words entirely within a removal region', () => {
    const transcript = makeTranscript()
    // Remove 10-15 — encompasses word "world" (10-12)
    const result = adjustTranscript(transcript, [{ start: 10, end: 15 }])

    expect(result.words).toHaveLength(2)
    expect(result.words[0].word).toBe('hello')
    expect(result.words[1].word).toBe('test')
  })
})

// ============================================================================
// runStage tests
// ============================================================================

describe('runStage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns result and records timing on success', async () => {
    const stageResults: StageResult[] = []
    const result = await runStage(PipelineStage.Ingestion, async () => 'ok', stageResults)

    expect(result).toBe('ok')
    expect(stageResults).toHaveLength(1)
    expect(stageResults[0].stage).toBe(PipelineStage.Ingestion)
    expect(stageResults[0].success).toBe(true)
    expect(stageResults[0].duration).toBeGreaterThanOrEqual(0)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('ingestion'))
  })

  it('catches errors, logs, and returns undefined (does not throw)', async () => {
    const stageResults: StageResult[] = []
    const result = await runStage(
      PipelineStage.Transcription,
      async () => { throw new Error('boom') },
      stageResults,
    )

    expect(result).toBeUndefined()
    expect(stageResults).toHaveLength(1)
    expect(stageResults[0].stage).toBe(PipelineStage.Transcription)
    expect(stageResults[0].success).toBe(false)
    expect(stageResults[0].error).toBe('boom')
    expect(stageResults[0].duration).toBeGreaterThanOrEqual(0)
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })

  it('handles non-Error throws', async () => {
    const stageResults: StageResult[] = []
    const result = await runStage(
      PipelineStage.Summary,
      async () => { throw 'string-error' },
      stageResults,
    )

    expect(result).toBeUndefined()
    expect(stageResults[0].error).toBe('string-error')
  })

  it('stage name is logged on success', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Shorts, async () => 42, stageResults)

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('shorts'))
  })

  it('stage name is logged on failure', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Blog, async () => { throw new Error('fail') }, stageResults)

    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('blog'))
  })
})

// ============================================================================
// processVideo orchestration tests
// ============================================================================

describe('processVideo', () => {
  const video = makeVideoFile()
  const transcript = makeTranscript()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockMainVideoAssetIngest.mockResolvedValue({
      toVideoFile: () => video,
      getEditorialDirection: vi.fn().mockResolvedValue('editorial direction text'),
      getMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
      videoPath: video.repoPath,
    } as any)
    mockTranscribeVideo.mockResolvedValue(transcript)
    mockProducerProduce.mockResolvedValue({ summary: 'Clean', outputPath: undefined, success: true, editCount: 0, removals: [], keepSegments: [] } as ProduceResult)
    mockGenerateCaptions.mockResolvedValue(['/captions.ass'])
    mockBurnCaptions.mockResolvedValue('/captioned.mp4')
    mockSinglePassEditAndCaption.mockResolvedValue('/captioned.mp4')
    mockGenerateShorts.mockResolvedValue([])
    mockGenerateMediumClips.mockResolvedValue([])
    mockGenerateChapters.mockResolvedValue([])
    mockGenerateSummary.mockResolvedValue({ title: 'Test', overview: 'Overview', keyTopics: [], snapshots: [], markdownPath: '/summary.md' } as VideoSummary)
    mockGenerateSocialPosts.mockResolvedValue([])
    mockGenerateShortPosts.mockResolvedValue([])
    mockGenerateBlogPost.mockResolvedValue('# Blog')
    mockCommitAndPush.mockResolvedValue(undefined)
    mockBuildPublishQueue.mockResolvedValue({ itemsCreated: 0, itemsSkipped: 0, errors: [] })
  })

  it('returns a PipelineResult with all stages recorded', async () => {
    const result = await processVideo('/videos/test.mp4')

    expect(result.video).toEqual(video)
    expect(result.transcript).toEqual(transcript)
    expect(result.stageResults.length).toBeGreaterThanOrEqual(1)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })

  it('calls stages in correct order', async () => {
    const callOrder: string[] = []
    mockMainVideoAssetIngest.mockImplementation(async () => { callOrder.push('ingest'); return { toVideoFile: () => video, getEditorialDirection: vi.fn().mockResolvedValue(''), getMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }), videoPath: video.repoPath } as any })
    mockTranscribeVideo.mockImplementation(async () => { callOrder.push('transcribe'); return transcript })
    mockProducerProduce.mockImplementation(async () => { callOrder.push('cleaning'); return { summary: '', success: true, editCount: 0, removals: [], keepSegments: [] } })
    mockGenerateCaptions.mockImplementation(async () => { callOrder.push('captions'); return ['/captions.ass'] })
    mockGenerateShorts.mockImplementation(async () => { callOrder.push('shorts'); return [] })
    mockGenerateMediumClips.mockImplementation(async () => { callOrder.push('mediumClips'); return [] })
    mockGenerateChapters.mockImplementation(async () => { callOrder.push('chapters'); return [] })
    mockGenerateSummary.mockImplementation(async () => { callOrder.push('summary'); return { title: '', overview: '', keyTopics: [], snapshots: [], markdownPath: '' } })
    mockGenerateBlogPost.mockImplementation(async () => { callOrder.push('blog'); return '# Blog' })
    mockCommitAndPush.mockImplementation(async () => { callOrder.push('git') })

    await processVideo('/videos/test.mp4')

    expect(callOrder.indexOf('ingest')).toBeLessThan(callOrder.indexOf('transcribe'))
    expect(callOrder.indexOf('transcribe')).toBeLessThan(callOrder.indexOf('cleaning'))
    expect(callOrder.indexOf('cleaning')).toBeLessThan(callOrder.indexOf('captions'))
    expect(callOrder.indexOf('captions')).toBeLessThan(callOrder.indexOf('shorts'))
    expect(callOrder.indexOf('shorts')).toBeLessThan(callOrder.indexOf('summary'))
    expect(callOrder.indexOf('summary')).toBeLessThan(callOrder.indexOf('blog'))
    expect(callOrder.indexOf('blog')).toBeLessThan(callOrder.indexOf('git'))
  })

  it('aborts early when ingestion fails', async () => {
    mockMainVideoAssetIngest.mockRejectedValue(new Error('ingest failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.video.originalPath).toBe('/videos/test.mp4')
    expect(result.transcript).toBeUndefined()
    expect(mockTranscribeVideo).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('cannot proceed'))
  })

  it('continues pipeline when a mid-stage fails', async () => {
    mockGenerateShorts.mockRejectedValue(new Error('shorts failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.shorts).toEqual([])
    // Summary should still be called
    expect(mockGenerateSummary).toHaveBeenCalled()
    // stageResults should contain a failure for shorts
    const shortsResult = result.stageResults.find(s => s.stage === PipelineStage.Shorts)
    expect(shortsResult?.success).toBe(false)
    expect(shortsResult?.error).toBe('shorts failed')
  })

  it('calls ProducerAgent for video cleaning', async () => {
    await processVideo('/videos/test.mp4')

    expect(mockProducerProduce).toHaveBeenCalled()
  })

  it('uses adjusted transcript for captions after video cleaning', async () => {
    const removals = [{ start: 5, end: 10 }]
    const keepSegments = [{ start: 0, end: 5 }, { start: 10, end: 30 }]
    mockProducerProduce.mockResolvedValue({
      summary: 'Cleaned',
      outputPath: '/edited.mp4',
      success: true,
      editCount: 1,
      removals,
      keepSegments,
    } as ProduceResult)

    await processVideo('/videos/test.mp4')

    // generateCaptions should be called with the adjusted transcript (shifted timestamps)
    const captionCall = mockGenerateCaptions.mock.calls[0]
    const captionTranscript = captionCall[1] as Transcript
    // The adjusted transcript should have shifted segment 1 from 10→5
    expect(captionTranscript.segments[1].start).toBe(5)
  })

  it('uses singlePassEditAndCaption when keepSegments are available', async () => {
    const keepSegments = [{ start: 0, end: 5 }, { start: 10, end: 30 }]
    mockProducerProduce.mockResolvedValue({
      summary: 'Cleaned',
      outputPath: '/edited.mp4',
      success: true,
      editCount: 1,
      removals: [{ start: 5, end: 10 }],
      keepSegments,
    } as ProduceResult)
    mockGenerateCaptions.mockResolvedValue(['/captions.ass'])

    await processVideo('/videos/test.mp4')

    expect(mockSinglePassEditAndCaption).toHaveBeenCalledWith(
      video.repoPath,
      keepSegments,
      '/captions.ass',
      expect.stringContaining('captioned.mp4'),
    )
    expect(mockBurnCaptions).not.toHaveBeenCalled()
  })

  it('uses burnCaptions when no keepSegments (no video cleaning)', async () => {
    mockProducerProduce.mockResolvedValue({
      summary: 'Clean',
      success: true,
      editCount: 0,
      removals: [],
      keepSegments: [],
    } as ProduceResult)
    mockGenerateCaptions.mockResolvedValue(['/captions.ass'])

    await processVideo('/videos/test.mp4')

    expect(mockBurnCaptions).toHaveBeenCalledWith(
      video.repoPath,
      '/captions.ass',
      expect.stringContaining('captioned.mp4'),
    )
    expect(mockSinglePassEditAndCaption).not.toHaveBeenCalled()
  })

  // ---- Skip flag tests ----

  it('skips video cleaning when SKIP_SILENCE_REMOVAL is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SILENCE_REMOVAL: true }))

    const result = await processVideo('/videos/test.mp4')

    expect(mockProducerProduce).not.toHaveBeenCalled()
    expect(result.editedVideoPath).toBeUndefined()
  })

  it('skips shorts when SKIP_SHORTS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SHORTS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGenerateShorts).not.toHaveBeenCalled()
  })

  it('skips medium clips when SKIP_MEDIUM_CLIPS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_MEDIUM_CLIPS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGenerateMediumClips).not.toHaveBeenCalled()
  })

  it('skips captions when SKIP_CAPTIONS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_CAPTIONS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGenerateCaptions).not.toHaveBeenCalled()
  })

  it('skips social posts when SKIP_SOCIAL is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SOCIAL: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGenerateSocialPosts).not.toHaveBeenCalled()
    expect(mockGenerateShortPosts).not.toHaveBeenCalled()
  })

  it('skips git when SKIP_GIT is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_GIT: true }))

    await processVideo('/videos/test.mp4')

    expect(mockCommitAndPush).not.toHaveBeenCalled()
  })

  // ---- Transcription failure blocks downstream ----

  it('skips all transcript-dependent stages when transcription fails', async () => {
    mockTranscribeVideo.mockRejectedValue(new Error('whisper failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.transcript).toBeUndefined()
    expect(mockProducerProduce).not.toHaveBeenCalled()
    expect(mockGenerateCaptions).not.toHaveBeenCalled()
    expect(mockGenerateShorts).not.toHaveBeenCalled()
    expect(mockGenerateSummary).not.toHaveBeenCalled()
    expect(mockGenerateBlogPost).not.toHaveBeenCalled()
    // Git should still be attempted
    expect(mockCommitAndPush).toHaveBeenCalled()
  })

  // ---- Social posts require summary ----

  it('skips social posts when summary fails', async () => {
    mockGenerateSummary.mockRejectedValue(new Error('summary failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.summary).toBeUndefined()
    expect(mockGenerateSocialPosts).not.toHaveBeenCalled()
    expect(mockGenerateBlogPost).not.toHaveBeenCalled()
  })

  // ---- Short posts integration ----

  it('generates short posts when shorts are available', async () => {
    const shorts: ShortClip[] = [
      { id: 's1', title: 'Short 1', slug: 'short-1', segments: [], totalDuration: 30, outputPath: '/short1.mp4', description: 'desc', tags: ['tag'] },
    ]
    mockGenerateShorts.mockResolvedValue(shorts)
    mockGenerateShortPosts.mockResolvedValue([{ platform: 'x', content: 'post', hashtags: [], links: [], characterCount: 4, outputPath: '/post.md' }])

    const result = await processVideo('/videos/test.mp4')

    expect(mockGenerateShortPosts).toHaveBeenCalledWith(video, shorts[0], transcript, undefined)
    expect(result.socialPosts.length).toBeGreaterThanOrEqual(1)
  })

  it('generates medium clip posts and moves files when medium clips exist', async () => {
    const clips: MediumClip[] = [
      { id: 'm1', title: 'Medium 1', slug: 'medium-1', segments: [{ start: 0, end: 60, description: 'intro' }], totalDuration: 60, outputPath: '/medium1.mp4', description: 'desc', tags: ['tag'], hook: 'hook', topic: 'topic' },
    ]
    mockGenerateMediumClips.mockResolvedValue(clips)
    mockGenerateShortPosts.mockResolvedValue([{ platform: 'x', content: 'clip post', hashtags: [], links: [], characterCount: 9, outputPath: '/clip-post.md' }])

    const result = await processVideo('/videos/test.mp4')

    // generateShortPosts called with MediumClip cast to ShortClip
    expect(mockGenerateShortPosts).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ id: 'm1', title: 'Medium 1', slug: 'medium-1' }),
      transcript,
      undefined,
    )
    expect(result.socialPosts.length).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// processVideoSafe tests
// ============================================================================

describe('processVideoSafe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockMainVideoAssetIngest.mockResolvedValue({
      toVideoFile: () => makeVideoFile(),
      getEditorialDirection: vi.fn().mockResolvedValue(''),
      getMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
      videoPath: '/repo/recordings/test-video/test.mp4',
    } as any)
    mockTranscribeVideo.mockResolvedValue(makeTranscript())
    mockProducerProduce.mockResolvedValue({ summary: '', success: true, editCount: 0, removals: [], keepSegments: [] })
    mockGenerateCaptions.mockResolvedValue([])
    mockGenerateShorts.mockResolvedValue([])
    mockGenerateMediumClips.mockResolvedValue([])
    mockGenerateChapters.mockResolvedValue([])
    mockGenerateSummary.mockResolvedValue({ title: '', overview: '', keyTopics: [], snapshots: [], markdownPath: '' })
    mockGenerateSocialPosts.mockResolvedValue([])
    mockGenerateBlogPost.mockResolvedValue('')
    mockCommitAndPush.mockResolvedValue(undefined)
  })

  it('returns PipelineResult on success', async () => {
    const result = await processVideoSafe('/videos/test.mp4')
    expect(result).not.toBeNull()
    expect(result!.video).toBeDefined()
  })

  it('returns null and logs on uncaught error', async () => {
    // Force an uncaught error by making getConfig throw (happens outside runStage)
    mockGetConfig.mockImplementation(() => { throw new Error('config explosion') })

    const result = await processVideoSafe('/videos/test.mp4')

    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('config explosion'))
  })
})

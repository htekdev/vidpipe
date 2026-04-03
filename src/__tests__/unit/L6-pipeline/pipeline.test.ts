import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transcript, VideoFile, StageResult, VideoSummary, ShortClip, MediumClip, SocialPost, Chapter, Idea } from '../../../L0-pure/types/index.js'
import { PipelineStage, Platform } from '../../../L0-pure/types/index.js'

// Fix: pipeline updates captionedPath so queue builder uses intro/outro version

// ---- Hoisted mock variables (vi.mock is hoisted above imports) ----

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
  // MainVideoAsset method mocks
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
  mockSetSpec,
  mockGetEditorialDirection,
  mockGetMetadata,
  mockGetIntroOutroVideo,
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
  // MainVideoAsset method mocks
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
  mockSetSpec: vi.fn(),
  mockGetEditorialDirection: vi.fn().mockResolvedValue('editorial direction text'),
  mockGetMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
  mockGetIntroOutroVideo: vi.fn().mockResolvedValue('/intro-outro.mp4'),
}))

// ---- Mock L1 dependencies ----

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

// ---- Mock L5 dependencies (MainVideoAsset + pipelineServices) ----

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

// Mock visual enhancement (L6-internal) to prevent eager module loading
vi.mock('../../../L6-pipeline/stages/visualEnhancement.js', () => ({
  enhanceVideo: vi.fn().mockResolvedValue(undefined),
}))

// ---- Import after mocks ----

import { adjustTranscript, runStage, processVideo, processVideoSafe } from '../../../L6-pipeline/pipeline.js'
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'

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
    SKIP_SOCIAL_PUBLISH: false,
    SKIP_VISUAL_ENHANCEMENT: true,
    SKIP_INTRO_OUTRO: false,
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

  it('adjusts nested segment.words timestamps (regression: was previously unadjusted)', () => {
    const transcript = makeTranscript({
      segments: [
        { id: 0, text: 'hello world', start: 0, end: 5, words: [
          { word: 'hello', start: 0, end: 2 },
          { word: 'world', start: 3, end: 5 },
        ]},
        { id: 1, text: 'foo bar', start: 10, end: 15, words: [
          { word: 'foo', start: 10, end: 12 },
          { word: 'bar', start: 13, end: 15 },
        ]},
        { id: 2, text: 'baz', start: 20, end: 25, words: [
          { word: 'baz', start: 20, end: 22 },
        ]},
      ],
    })

    // Remove 5-10 (5s gap between seg 0 and seg 1)
    const result = adjustTranscript(transcript, [{ start: 5, end: 10 }])

    // Segment-level timestamps shift correctly
    expect(result.segments[1].start).toBe(5)
    expect(result.segments[1].end).toBe(10)

    // Nested word timestamps must also shift by the same amount
    expect(result.segments[1].words[0].start).toBe(5)  // was 10, shifted by 5
    expect(result.segments[1].words[0].end).toBe(7)     // was 12, shifted by 5
    expect(result.segments[1].words[1].start).toBe(8)   // was 13, shifted by 5
    expect(result.segments[1].words[1].end).toBe(10)    // was 15, shifted by 5

    // Third segment words also shift
    expect(result.segments[2].words[0].start).toBe(15)  // was 20, shifted by 5
    expect(result.segments[2].words[0].end).toBe(17)    // was 22, shifted by 5
  })

  it('filters nested words inside removal regions', () => {
    const transcript = makeTranscript({
      segments: [
        { id: 0, text: 'a b c', start: 0, end: 20, words: [
          { word: 'a', start: 0, end: 3 },
          { word: 'b', start: 8, end: 12 },  // inside removal 5-15
          { word: 'c', start: 16, end: 20 },
        ]},
      ],
    })

    const result = adjustTranscript(transcript, [{ start: 5, end: 15 }])

    // Segment survives (not entirely within removal)
    expect(result.segments).toHaveLength(1)
    // Word 'b' (8-12) is entirely within removal 5-15, should be filtered
    expect(result.segments[0].words).toHaveLength(2)
    expect(result.segments[0].words[0].word).toBe('a')
    expect(result.segments[0].words[1].word).toBe('c')
    // 'c' was at 16-20, shifted by 10s removal → 6-10
    expect(result.segments[0].words[1].start).toBe(6)
    expect(result.segments[0].words[1].end).toBe(10)
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
      setSpec: mockSetSpec,
      ...overrides,
    } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockMainVideoAssetIngest.mockResolvedValue(makeAssetMock())
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
  })

  it('returns a PipelineResult with all stages recorded', async () => {
    const result = await processVideo('/videos/test.mp4')

    expect(result.video).toEqual(video)
    expect(result.transcript).toEqual(transcript)
    expect(result.stageResults.length).toBeGreaterThanOrEqual(1)
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })

  it('sets ideas on the asset when provided', async () => {
    const ideas: Idea[] = [{
      issueNumber: 1,
      issueUrl: 'https://github.com/htekdev/content-management/issues/1',
      repoFullName: 'htekdev/content-management',
      id: 'idea-1',
      topic: 'Hook-first clip',
      hook: 'Lead with the strongest payoff',
      audience: 'Developers watching workflow demos',
      keyTakeaway: 'Open with the result before walking through the steps.',
      talkingPoints: ['Show the payoff', 'Explain how to reproduce it'],
      platforms: [Platform.YouTube],
      status: 'ready',
      tags: ['workflow'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishBy: '2026-02-01',
    }]

    await processVideo('/videos/test.mp4', ideas)

    expect(mockSetIdeas).toHaveBeenCalledWith(ideas)
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Pipeline using 1 idea(s)'))
  })

  it('calls stages in correct order', async () => {
    const callOrder: string[] = []
    mockMainVideoAssetIngest.mockImplementation(async () => { callOrder.push('ingest'); return makeAssetMock() })
    mockGetTranscript.mockImplementation(async () => { callOrder.push('transcribe'); return transcript })
    mockGetEditedVideo.mockImplementation(async () => { callOrder.push('editing'); return '/edited.mp4' })
    mockGetCaptions.mockImplementation(async () => { callOrder.push('captions'); return { srt: '/captions.srt', vtt: '/captions.vtt', ass: '/captions.ass' } })
    mockGetShorts.mockImplementation(async () => { callOrder.push('shorts'); return [] })
    mockGetMediumClips.mockImplementation(async () => { callOrder.push('mediumClips'); return [] })
    mockGetChapters.mockImplementation(async () => { callOrder.push('chapters'); return [] })
    mockGetSummary.mockImplementation(async () => { callOrder.push('summary'); return { title: '', overview: '', keyTopics: [], snapshots: [], markdownPath: '' } })
    mockGetBlog.mockImplementation(async () => { callOrder.push('blog'); return '# Blog' })

    await processVideo('/videos/test.mp4')

    expect(callOrder.indexOf('ingest')).toBeLessThan(callOrder.indexOf('transcribe'))
    expect(callOrder.indexOf('transcribe')).toBeLessThan(callOrder.indexOf('editing'))
    expect(callOrder.indexOf('editing')).toBeLessThan(callOrder.indexOf('captions'))
    expect(callOrder.indexOf('captions')).toBeLessThan(callOrder.indexOf('shorts'))
    expect(callOrder.indexOf('shorts')).toBeLessThan(callOrder.indexOf('summary'))
    expect(callOrder.indexOf('summary')).toBeLessThan(callOrder.indexOf('blog'))
  })

  it('aborts early when ingestion fails', async () => {
    mockMainVideoAssetIngest.mockRejectedValue(new Error('ingest failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.video.originalPath).toBe('/videos/test.mp4')
    expect(result.transcript).toBeUndefined()
    expect(mockGetTranscript).not.toHaveBeenCalled()
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('cannot proceed'))
  })

  it('continues pipeline when a mid-stage fails', async () => {
    mockGetShorts.mockRejectedValue(new Error('shorts failed'))

    const result = await processVideo('/videos/test.mp4')

    expect(result.shorts).toEqual([])
    // Summary should still be called
    expect(mockGetSummary).toHaveBeenCalled()
    // stageResults should contain a failure for shorts
    const shortsResult = result.stageResults.find(s => s.stage === PipelineStage.Shorts)
    expect(shortsResult?.success).toBe(false)
    expect(shortsResult?.error).toBe('shorts failed')
  })

  it('calls getEditedVideo for video editing', async () => {
    await processVideo('/videos/test.mp4')

    expect(mockGetEditedVideo).toHaveBeenCalled()
  })

  it('calls getCaptionedVideo for caption burning', async () => {
    await processVideo('/videos/test.mp4')

    // Pipeline calls getCaptionedVideo which handles the burning internally
    expect(mockGetCaptionedVideo).toHaveBeenCalled()
  })

  it('calls getCaptionedVideo even without video edits', async () => {
    mockGetEditedVideo.mockResolvedValue(undefined)

    await processVideo('/videos/test.mp4')

    // Pipeline calls getCaptionedVideo regardless of silence removal results
    expect(mockGetCaptionedVideo).toHaveBeenCalled()
  })

  // ---- Skip flag tests ----

  it('skips video editing when SKIP_SILENCE_REMOVAL is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SILENCE_REMOVAL: true }))

    const result = await processVideo('/videos/test.mp4')

    expect(mockGetEditedVideo).not.toHaveBeenCalled()
    expect(result.editedVideoPath).toBeUndefined()
  })

  it('skips shorts when SKIP_SHORTS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SHORTS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGetShorts).not.toHaveBeenCalled()
  })

  it('skips medium clips when SKIP_MEDIUM_CLIPS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_MEDIUM_CLIPS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGetMediumClips).not.toHaveBeenCalled()
  })

  it('skips captions when SKIP_CAPTIONS is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_CAPTIONS: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGetCaptions).not.toHaveBeenCalled()
  })

  it('skips social posts when SKIP_SOCIAL is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SOCIAL: true }))

    await processVideo('/videos/test.mp4')

    expect(mockGetSocialPosts).not.toHaveBeenCalled()
    expect(mockGenerateShortPostsData).not.toHaveBeenCalled()
  })

  // ---- Transcription failure behavior ----

  it('continues pipeline when transcription fails (stages are independent)', async () => {
    mockGetTranscript.mockRejectedValue(new Error('whisper failed'))

    const result = await processVideo('/videos/test.mp4')

    // Transcript is undefined due to the error
    expect(result.transcript).toBeUndefined()
    // Other stages still get called because trackStage catches errors and continues
    // The get* methods on the asset handle their own error scenarios
    expect(mockGetBlog).toHaveBeenCalled()
  })

  // ---- Summary failure behavior ----

  it('continues pipeline when summary fails (stages are independent)', async () => {
    mockGetSummary.mockRejectedValue(new Error('summary failed'))

    const result = await processVideo('/videos/test.mp4')

    // Summary is undefined due to the error
    expect(result.summary).toBeUndefined()
    // Social posts stage still runs (trackStage catches and continues)
    expect(mockGetSocialPosts).toHaveBeenCalled()
    // Blog still runs
    expect(mockGetBlog).toHaveBeenCalled()
  })

  // ---- Short posts integration ----

  it('generates short posts when shorts are available', async () => {
    const shorts: ShortClip[] = [
      { id: 's1', title: 'Short 1', slug: 'short-1', segments: [], totalDuration: 30, outputPath: '/short1.mp4', description: 'desc', tags: ['tag'] },
    ]
    // Mock getShorts to return mock assets with clip property
    mockGetShorts.mockResolvedValue(shorts.map(s => ({ clip: s, getIntroOutroVideo: vi.fn().mockResolvedValue(s.outputPath), getIntroOutroVariants: vi.fn().mockResolvedValue(new Map()) })))
    mockGenerateShortPostsData.mockResolvedValue([{ platform: 'x', content: 'post', hashtags: [], links: [], characterCount: 4, outputPath: '/post.md' }])

    const result = await processVideo('/videos/test.mp4')

    expect(mockGenerateShortPostsData).toHaveBeenCalledWith(shorts[0], transcript, undefined, expect.objectContaining({ title: 'Test' }))
    expect(result.socialPosts.length).toBeGreaterThanOrEqual(1)
  })

  it('generates medium clip posts when medium clips exist', async () => {
    const clips: MediumClip[] = [
      { id: 'm1', title: 'Medium 1', slug: 'medium-1', segments: [{ start: 0, end: 60, description: 'intro' }], totalDuration: 60, outputPath: '/medium1.mp4', description: 'desc', tags: ['tag'], hook: 'hook', topic: 'topic' },
    ]
    // Mock getMediumClips to return mock assets with clip property
    mockGetMediumClips.mockResolvedValue(clips.map(c => ({ clip: c, getIntroOutroVideo: vi.fn().mockResolvedValue(c.outputPath) })))
    mockGenerateMediumClipPostsData.mockResolvedValue([{ platform: 'x', content: 'clip post', hashtags: [], links: [], characterCount: 9, outputPath: '/clip-post.md' }])

    const result = await processVideo('/videos/test.mp4')

    // generateMediumClipPostsData called for each medium clip
    expect(mockGenerateMediumClipPostsData).toHaveBeenCalledWith(clips[0], undefined, expect.objectContaining({ title: 'Test' }))
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
      toVideoFile: vi.fn().mockResolvedValue(makeVideoFile()),
      getEditorialDirection: vi.fn().mockResolvedValue(''),
      getMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
      videoPath: '/repo/recordings/test-video/test.mp4',
      slug: 'test-video',
      videoDir: '/repo/recordings/test-video',
      editedVideoPath: '/repo/recordings/test-video/test-video-edited.mp4',
      getTranscript: vi.fn().mockResolvedValue(makeTranscript()),
      getEditedVideo: vi.fn().mockResolvedValue('/edited.mp4'),
      getEnhancedVideo: vi.fn().mockResolvedValue('/enhanced.mp4'),
      getCaptions: vi.fn().mockResolvedValue({ srt: '', vtt: '', ass: '' }),
      getCaptionedVideo: vi.fn().mockResolvedValue(''),
      getShorts: vi.fn().mockResolvedValue([]),
      getMediumClips: vi.fn().mockResolvedValue([]),
      getChapters: vi.fn().mockResolvedValue([]),
      getSummary: vi.fn().mockResolvedValue({ title: '', overview: '', keyTopics: [], snapshots: [], markdownPath: '' }),
      getSocialPosts: vi.fn().mockResolvedValue([]),
      generateShortPostsData: vi.fn().mockResolvedValue([]),
      generateMediumClipPostsData: vi.fn().mockResolvedValue([]),
      getBlog: vi.fn().mockResolvedValue(''),
      buildQueue: vi.fn().mockResolvedValue(undefined),
      setIdeas: vi.fn(),
      setSpec: vi.fn(),
    } as any)
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

// ============================================================================
// Progress event tests
// ============================================================================

describe('progress events', () => {
  const video = makeVideoFile()
  const transcript = makeTranscript()

  function makeAssetMockForProgress(overrides: Record<string, unknown> = {}) {
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
      setSpec: mockSetSpec,
      ...overrides,
    } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockProgressEmitter.isEnabled.mockReturnValue(true)
    mockGetTranscript.mockResolvedValue(transcript)
    mockGetEditedVideo.mockResolvedValue('/edited.mp4')
    mockGetEnhancedVideo.mockResolvedValue('/enhanced.mp4')
    mockGetCaptions.mockResolvedValue({ srt: 'srt', vtt: 'vtt', ass: 'ass' })
    mockGetCaptionedVideo.mockResolvedValue('/captioned.mp4')
    mockGetShorts.mockResolvedValue([])
    mockGetMediumClips.mockResolvedValue([])
    mockGetChapters.mockResolvedValue([])
    mockGetSummary.mockResolvedValue({ title: 'Test' })
    mockGetSocialPosts.mockResolvedValue([])
    mockGetBlog.mockResolvedValue('blog content')
    mockMainVideoAssetIngest.mockResolvedValue(makeAssetMockForProgress())
  })

  describe('progressEvents.REQ-004: pipeline:start emitted', () => {
    it('progressEvents.REQ-004 - emits pipeline:start before first stage', async () => {
      await processVideo('/videos/test.mp4')

      const startCalls = mockProgressEmitter.emit.mock.calls.filter(
        (c: unknown[]) => (c[0] as { event: string }).event === 'pipeline:start'
      )
      expect(startCalls).toHaveLength(1)
      expect(startCalls[0][0]).toMatchObject({
        event: 'pipeline:start',
        videoPath: '/videos/test.mp4',
        totalStages: 18,
      })
    })
  })

  describe('progressEvents.REQ-005: stage:start emitted', () => {
    it('progressEvents.REQ-005 - emits stage:start for each executed stage', async () => {
      await processVideo('/videos/test.mp4')

      const startEvents = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string })
        .filter((e: { event: string }) => e.event === 'stage:start')

      // At minimum, ingestion and transcription should have start events
      expect(startEvents.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('progressEvents.REQ-006: stage:complete emitted', () => {
    it('progressEvents.REQ-006 - emits stage:complete with duration for successful stages', async () => {
      await processVideo('/videos/test.mp4')

      const completeEvents = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string; duration?: number; success?: boolean })
        .filter((e) => e.event === 'stage:complete')

      expect(completeEvents.length).toBeGreaterThan(0)
      for (const event of completeEvents) {
        expect(event.duration).toBeGreaterThanOrEqual(0)
        expect(event.success).toBe(true)
      }
    })
  })

  describe('progressEvents.REQ-007: stage:error emitted on failure', () => {
    it('progressEvents.REQ-007 - emits stage:error when a stage fails', async () => {
      mockGetTranscript.mockRejectedValue(new Error('Whisper timeout'))
      await processVideo('/videos/test.mp4')

      const errorEvents = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string; error?: string; stage?: string })
        .filter((e) => e.event === 'stage:error')

      expect(errorEvents).toHaveLength(1)
      expect(errorEvents[0].error).toBe('Whisper timeout')
      expect(errorEvents[0].stage).toBe(PipelineStage.Transcription)
    })
  })

  describe('progressEvents.REQ-008: stage:skip emitted', () => {
    it('progressEvents.REQ-008 - emits stage:skip when config disables a stage', async () => {
      mockGetConfig.mockReturnValue(defaultConfig({
        SKIP_SHORTS: true,
        SKIP_SILENCE_REMOVAL: true,
      }))
      await processVideo('/videos/test.mp4')

      const skipEvents = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string; stage?: string; reason?: string })
        .filter((e) => e.event === 'stage:skip')

      const skipStages = skipEvents.map(e => e.stage)
      expect(skipStages).toContain(PipelineStage.SilenceRemoval)
      expect(skipStages).toContain(PipelineStage.Shorts)

      const silenceSkip = skipEvents.find(e => e.stage === PipelineStage.SilenceRemoval)
      expect(silenceSkip?.reason).toBe('SPEC_DISABLED')
    })
  })

  describe('progressEvents.REQ-009: pipeline:complete emitted', () => {
    it('progressEvents.REQ-009 - emits pipeline:complete with summary counts', async () => {
      await processVideo('/videos/test.mp4')

      const completeCalls = mockProgressEmitter.emit.mock.calls.filter(
        (c: unknown[]) => (c[0] as { event: string }).event === 'pipeline:complete'
      )
      expect(completeCalls).toHaveLength(1)

      const event = completeCalls[0][0] as {
        event: string;
        totalDuration: number;
        stagesCompleted: number;
        stagesFailed: number;
        stagesSkipped: number;
      }
      expect(event.totalDuration).toBeGreaterThanOrEqual(0)
      expect(event.stagesCompleted).toBeGreaterThan(0)
      expect(event.stagesFailed).toBe(0)
      // Visual enhancement (config), IdeaDiscovery (NO_CLIPS), ShortPosts (NO_SHORTS), MediumClipPosts (NO_MEDIUM_CLIPS), QueueBuild (NO_SOCIAL_POSTS)
      expect(event.stagesSkipped).toBe(5)
    })

    it('progressEvents.REQ-009 - counts failed and skipped stages', async () => {
      mockGetConfig.mockReturnValue(defaultConfig({ SKIP_SHORTS: true }))
      mockGetTranscript.mockRejectedValue(new Error('fail'))
      await processVideo('/videos/test.mp4')

      const event = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string; stagesFailed?: number; stagesSkipped?: number })
        .find(e => e.event === 'pipeline:complete')

      expect(event?.stagesFailed).toBeGreaterThanOrEqual(1)
      expect(event?.stagesSkipped).toBeGreaterThanOrEqual(1)
    })
  })

  describe('progressEvents.REQ-010: timestamps present', () => {
    it('progressEvents.REQ-010 - all events include ISO timestamp', async () => {
      await processVideo('/videos/test.mp4')

      for (const call of mockProgressEmitter.emit.mock.calls) {
        const event = call[0] as { timestamp: string }
        expect(event.timestamp).toBeDefined()
        expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp)
      }
    })
  })

  describe('progressEvents.REQ-011: stage metadata in events', () => {
    it('progressEvents.REQ-011 - stage events include stageNumber, totalStages, name', async () => {
      await processVideo('/videos/test.mp4')

      const stageEvents = mockProgressEmitter.emit.mock.calls
        .map((c: unknown[]) => c[0] as { event: string; stageNumber?: number; totalStages?: number; name?: string })
        .filter((e) => e.event.startsWith('stage:'))

      for (const event of stageEvents) {
        expect(event.stageNumber).toBeGreaterThan(0)
        expect(event.totalStages).toBe(18)
        expect(event.name).toBeTruthy()
      }
    })
  })
})

describe('runStage progress events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProgressEmitter.isEnabled.mockReturnValue(true)
  })

  it('progressEvents.REQ-005 - emits stage:start before execution', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Ingestion, async () => 'ok', stageResults)

    const firstEmitCall = mockProgressEmitter.emit.mock.calls[0]?.[0] as { event: string; stage?: string }
    expect(firstEmitCall.event).toBe('stage:start')
    expect(firstEmitCall.stage).toBe(PipelineStage.Ingestion)
  })

  it('progressEvents.REQ-006 - emits stage:complete on success', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Ingestion, async () => 'ok', stageResults)

    const completeCall = mockProgressEmitter.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { event: string }).event === 'stage:complete'
    )
    expect(completeCall).toBeDefined()
    expect((completeCall![0] as { success: boolean }).success).toBe(true)
  })

  it('progressEvents.REQ-007 - emits stage:error on failure', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Transcription, async () => { throw new Error('boom') }, stageResults)

    const errorCall = mockProgressEmitter.emit.mock.calls.find(
      (c: unknown[]) => (c[0] as { event: string }).event === 'stage:error'
    )
    expect(errorCall).toBeDefined()
    expect((errorCall![0] as { error: string }).error).toBe('boom')
  })
})

describe('progress zero-overhead guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProgressEmitter.isEnabled.mockReturnValue(false)
  })

  it('progressEvents.ARCH-004 - runStage emits nothing when progress is disabled', async () => {
    const stageResults: StageResult[] = []
    await runStage(PipelineStage.Ingestion, async () => 'ok', stageResults)

    expect(mockProgressEmitter.emit).not.toHaveBeenCalled()
    expect(stageResults).toHaveLength(1)
    expect(stageResults[0].success).toBe(true)
  })

  it('progressEvents.ARCH-004 - processVideo emits nothing when progress is disabled', async () => {
    const video = makeVideoFile()
    const transcript = makeTranscript()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockGetTranscript.mockResolvedValue(transcript)
    mockGetEditedVideo.mockResolvedValue('/edited.mp4')
    mockGetEnhancedVideo.mockResolvedValue('/enhanced.mp4')
    mockGetCaptions.mockResolvedValue({ srt: 'srt', vtt: 'vtt', ass: 'ass' })
    mockGetCaptionedVideo.mockResolvedValue('/captioned.mp4')
    mockGetShorts.mockResolvedValue([])
    mockGetMediumClips.mockResolvedValue([])
    mockGetChapters.mockResolvedValue([])
    mockGetSummary.mockResolvedValue({ title: 'Test' })
    mockGetSocialPosts.mockResolvedValue([])
    mockGetBlog.mockResolvedValue('blog')
    mockMainVideoAssetIngest.mockResolvedValue({
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
      setSpec: mockSetSpec,
    } as any)

    await processVideo('/videos/test.mp4')
    expect(mockProgressEmitter.emit).not.toHaveBeenCalled()
  })
})

describe('data-dependent stage skips', () => {
  const video = makeVideoFile()
  const transcript = makeTranscript()

  function makeAssetMockForSkips(overrides: Record<string, unknown> = {}) {
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
      setSpec: mockSetSpec,
      ...overrides,
    } as any
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockProgressEmitter.isEnabled.mockReturnValue(true)
    mockGetTranscript.mockResolvedValue(transcript)
    mockGetEditedVideo.mockResolvedValue('/edited.mp4')
    mockGetEnhancedVideo.mockResolvedValue('/enhanced.mp4')
    mockGetCaptions.mockResolvedValue({ srt: 'srt', vtt: 'vtt', ass: 'ass' })
    mockGetCaptionedVideo.mockResolvedValue('/captioned.mp4')
    mockGetShorts.mockResolvedValue([])
    mockGetMediumClips.mockResolvedValue([])
    mockGetChapters.mockResolvedValue([])
    mockGetSummary.mockResolvedValue({ title: 'Test' })
    mockGetSocialPosts.mockResolvedValue([])
    mockGetBlog.mockResolvedValue('blog')
    mockMainVideoAssetIngest.mockResolvedValue(makeAssetMockForSkips())
  })

  it('progressEvents.REQ-008 - emits stage:skip for ShortPosts when no shorts', async () => {
    mockGetShorts.mockResolvedValue([])
    await processVideo('/videos/test.mp4')

    const skipEvents = mockProgressEmitter.emit.mock.calls
      .map((c: unknown[]) => c[0] as { event: string; stage?: string; reason?: string })
      .filter((e) => e.event === 'stage:skip')

    const shortPostsSkip = skipEvents.find(e => e.stage === PipelineStage.ShortPosts)
    expect(shortPostsSkip).toBeDefined()
    expect(shortPostsSkip?.reason).toBe('NO_SHORTS')
  })

  it('progressEvents.REQ-008 - emits stage:skip for MediumClipPosts when no medium clips', async () => {
    mockGetMediumClips.mockResolvedValue([])
    await processVideo('/videos/test.mp4')

    const skipEvents = mockProgressEmitter.emit.mock.calls
      .map((c: unknown[]) => c[0] as { event: string; stage?: string; reason?: string })
      .filter((e) => e.event === 'stage:skip')

    const mediumSkip = skipEvents.find(e => e.stage === PipelineStage.MediumClipPosts)
    expect(mediumSkip).toBeDefined()
    expect(mediumSkip?.reason).toBe('NO_MEDIUM_CLIPS')
  })

  it('progressEvents.REQ-008 - emits stage:skip for QueueBuild when no social posts', async () => {
    mockGetSocialPosts.mockResolvedValue([])
    await processVideo('/videos/test.mp4')

    const skipEvents = mockProgressEmitter.emit.mock.calls
      .map((c: unknown[]) => c[0] as { event: string; stage?: string; reason?: string })
      .filter((e) => e.event === 'stage:skip')

    const queueSkip = skipEvents.find(e => e.stage === PipelineStage.QueueBuild)
    expect(queueSkip).toBeDefined()
    expect(queueSkip?.reason).toBe('NO_SOCIAL_POSTS')
  })

  it('progressEvents.REQ-009 - data-dependent skips are counted in stagesSkipped', async () => {
    await processVideo('/videos/test.mp4')

    const completeEvent = mockProgressEmitter.emit.mock.calls
      .map((c: unknown[]) => c[0] as { event: string; stagesSkipped?: number })
      .find(e => e.event === 'pipeline:complete')

    // 1 config (visual enhancement) + 4 data-dependent (idea discovery, short posts, medium clip posts, queue build)
    expect(completeEvent?.stagesSkipped).toBe(5)
  })
})

describe('pipeline:complete on ingestion failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue(defaultConfig())
    mockProgressEmitter.isEnabled.mockReturnValue(true)
  })

  it('progressEvents.REQ-009 - emits pipeline:complete when ingestion fails', async () => {
    mockMainVideoAssetIngest.mockResolvedValue(undefined as unknown as MainVideoAsset)
    await processVideo('/videos/test.mp4')

    const completeCalls = mockProgressEmitter.emit.mock.calls.filter(
      (c: unknown[]) => (c[0] as { event: string }).event === 'pipeline:complete'
    )
    expect(completeCalls).toHaveLength(1)

    const event = completeCalls[0][0] as {
      event: string;
      totalDuration: number;
      stagesCompleted: number;
      stagesFailed: number;
      stagesSkipped: number;
    }
    expect(event.stagesCompleted).toBe(0)
    expect(event.stagesFailed).toBe(1)
    expect(event.stagesSkipped).toBe(0)
    expect(event.totalDuration).toBeGreaterThanOrEqual(0)
  })
})

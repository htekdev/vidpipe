import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transcript, VideoFile, StageResult, VideoSummary, ShortClip, MediumClip, SocialPost, Chapter } from '../../../L0-pure/types/index.js'
import { PipelineStage } from '../../../L0-pure/types/index.js'

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
  mockCommitAndPushChanges,
  mockGetEditorialDirection,
  mockGetMetadata,
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
  mockCommitAndPushChanges: vi.fn(),
  mockGetEditorialDirection: vi.fn().mockResolvedValue('editorial direction text'),
  mockGetMetadata: vi.fn().mockResolvedValue({ width: 1920, height: 1080, duration: 120 }),
}))

// ---- Mock L1 dependencies ----

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({ default: mockLogger, pushPipe: vi.fn(), popPipe: vi.fn() }))
vi.mock('../../../L1-infra/config/environment.js', () => ({ getConfig: mockGetConfig }))
vi.mock('../../../L1-infra/config/modelConfig.js', () => ({ getModelForAgent: mockGetModelForAgent }))
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
    SKIP_GIT: false,
    SKIP_SOCIAL_PUBLISH: false,
    SKIP_VISUAL_ENHANCEMENT: true,
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
      getShorts: mockGetShorts,
      getMediumClips: mockGetMediumClips,
      getChapters: mockGetChapters,
      getSummary: mockGetSummary,
      getSocialPosts: mockGetSocialPosts,
      generateShortPostsData: mockGenerateShortPostsData,
      generateMediumClipPostsData: mockGenerateMediumClipPostsData,
      getBlog: mockGetBlog,
      buildQueue: mockBuildQueue,
      commitAndPushChanges: mockCommitAndPushChanges,
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
    mockCommitAndPushChanges.mockResolvedValue(undefined)
    mockBuildQueue.mockResolvedValue(undefined)
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
    mockMainVideoAssetIngest.mockImplementation(async () => { callOrder.push('ingest'); return makeAssetMock() })
    mockGetTranscript.mockImplementation(async () => { callOrder.push('transcribe'); return transcript })
    mockGetEditedVideo.mockImplementation(async () => { callOrder.push('editing'); return '/edited.mp4' })
    mockGetCaptions.mockImplementation(async () => { callOrder.push('captions'); return { srt: '/captions.srt', vtt: '/captions.vtt', ass: '/captions.ass' } })
    mockGetShorts.mockImplementation(async () => { callOrder.push('shorts'); return [] })
    mockGetMediumClips.mockImplementation(async () => { callOrder.push('mediumClips'); return [] })
    mockGetChapters.mockImplementation(async () => { callOrder.push('chapters'); return [] })
    mockGetSummary.mockImplementation(async () => { callOrder.push('summary'); return { title: '', overview: '', keyTopics: [], snapshots: [], markdownPath: '' } })
    mockGetBlog.mockImplementation(async () => { callOrder.push('blog'); return '# Blog' })
    mockCommitAndPushChanges.mockImplementation(async () => { callOrder.push('git') })

    await processVideo('/videos/test.mp4')

    expect(callOrder.indexOf('ingest')).toBeLessThan(callOrder.indexOf('transcribe'))
    expect(callOrder.indexOf('transcribe')).toBeLessThan(callOrder.indexOf('editing'))
    expect(callOrder.indexOf('editing')).toBeLessThan(callOrder.indexOf('captions'))
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

  it('skips git when SKIP_GIT is true', async () => {
    mockGetConfig.mockReturnValue(defaultConfig({ SKIP_GIT: true }))

    await processVideo('/videos/test.mp4')

    expect(mockCommitAndPushChanges).not.toHaveBeenCalled()
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
    expect(mockCommitAndPushChanges).toHaveBeenCalled()
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
    mockGetShorts.mockResolvedValue(shorts.map(s => ({ clip: s })))
    mockGenerateShortPostsData.mockResolvedValue([{ platform: 'x', content: 'post', hashtags: [], links: [], characterCount: 4, outputPath: '/post.md' }])

    const result = await processVideo('/videos/test.mp4')

    expect(mockGenerateShortPostsData).toHaveBeenCalledWith(shorts[0], transcript)
    expect(result.socialPosts.length).toBeGreaterThanOrEqual(1)
  })

  it('generates medium clip posts when medium clips exist', async () => {
    const clips: MediumClip[] = [
      { id: 'm1', title: 'Medium 1', slug: 'medium-1', segments: [{ start: 0, end: 60, description: 'intro' }], totalDuration: 60, outputPath: '/medium1.mp4', description: 'desc', tags: ['tag'], hook: 'hook', topic: 'topic' },
    ]
    // Mock getMediumClips to return mock assets with clip property
    mockGetMediumClips.mockResolvedValue(clips.map(c => ({ clip: c })))
    mockGenerateMediumClipPostsData.mockResolvedValue([{ platform: 'x', content: 'clip post', hashtags: [], links: [], characterCount: 9, outputPath: '/clip-post.md' }])

    const result = await processVideo('/videos/test.mp4')

    // generateMediumClipPostsData called for each medium clip
    expect(mockGenerateMediumClipPostsData).toHaveBeenCalledWith(clips[0])
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
      commitAndPushChanges: vi.fn().mockResolvedValue(undefined),
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

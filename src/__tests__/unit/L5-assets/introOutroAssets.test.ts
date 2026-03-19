/**
 * L5 Unit Test — intro/outro support in ShortVideoAsset, MediumClipAsset, MainVideoAsset
 *
 * Mocks: L4 videoServiceBridge + L1 infra (foundation layer).
 * Tests introOutroVideoPath getter, getIntroOutroVideo, and getIntroOutroVariants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShortClip, MediumClip, ShortClipVariant } from '../../../L0-pure/types/index.js'

const mockApplyIntroOutro = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockExtractCompositeClip = vi.hoisted(() => vi.fn())

vi.mock('../../../L4-agents/videoServiceBridge.js', () => ({
  applyIntroOutro: mockApplyIntroOutro,
  extractCompositeClip: mockExtractCompositeClip,
  ffprobe: vi.fn(),
  burnCaptions: vi.fn().mockResolvedValue('/recordings/test/test-captioned.mp4'),
  transcodeToMp4: vi.fn(),
  compositeOverlays: vi.fn(),
  getVideoResolution: vi.fn().mockResolvedValue({ width: 1920, height: 1080 }),
  detectWebcamRegion: vi.fn().mockResolvedValue(null),
  singlePassEditAndCaption: vi.fn(),
  getFFmpegPath: vi.fn(),
  getFFprobePath: vi.fn(),
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  ensureDirectory: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn(),
  getFileStats: vi.fn(),
  listDirectory: vi.fn().mockResolvedValue([]),
  readTextFile: vi.fn().mockResolvedValue(''),
  readJsonFile: vi.fn().mockResolvedValue({}),
  writeJsonFile: vi.fn().mockResolvedValue(undefined),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  openReadStream: vi.fn(),
  openWriteStream: vi.fn(),
  removeDirectory: vi.fn(),
  removeFile: vi.fn(),
  fileExistsSync: vi.fn().mockReturnValue(false),
  readTextFileSync: vi.fn(),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...args: string[]) => args.join('/'),
  basename: (p: string) => p.split('/').pop() ?? '',
  extname: (p: string) => '.' + (p.split('.').pop() ?? ''),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  resolve: (...args: string[]) => args.join('/'),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    OUTPUT_DIR: '/recordings',
    WATCH_DIR: '/watch',
  }),
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// L4 agent mocks required for MainVideoAsset's transitive imports
vi.mock('../../../L4-agents/analysisServiceBridge.js', () => ({
  transcribeVideo: vi.fn().mockResolvedValue({
    text: 'test', segments: [], words: [], language: 'en', duration: 100,
  }),
  analyzeVideoClipDirection: vi.fn().mockResolvedValue(''),
  generateCaptions: vi.fn().mockResolvedValue({ srt: '', vtt: '', ass: '' }),
}))

vi.mock('../../../L4-agents/SilenceRemovalAgent.js', () => ({
  removeDeadSilence: vi.fn().mockResolvedValue({
    editedPath: '/recordings/test/test.mp4', removals: [], keepSegments: [], wasEdited: false,
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
}))

vi.mock('../../../L5-assets/visualEnhancement.js', () => ({
  enhanceVideo: vi.fn().mockResolvedValue({
    enhancedVideoPath: '/recordings/test/test-enhanced.mp4',
    overlays: [],
    report: '',
  }),
}))

vi.mock('../../../L0-pure/captions/captionGenerator.js', () => ({
  generateSRT: vi.fn().mockReturnValue('SRT'),
  generateVTT: vi.fn().mockReturnValue('VTT'),
  generateStyledASS: vi.fn().mockReturnValue('ASS'),
}))

import { ShortVideoAsset } from '../../../L5-assets/ShortVideoAsset.js'
import { MediumClipAsset } from '../../../L5-assets/MediumClipAsset.js'
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'

function makeShortClip(slug: string, variants?: ShortClipVariant[]): ShortClip {
  return {
    id: `s-${slug}`,
    title: 'Test Short',
    slug,
    segments: [{ start: 0, end: 30, description: 'test segment' }],
    totalDuration: 30,
    outputPath: `/shorts/${slug}/media.mp4`,
    description: 'A test short clip',
    tags: ['test'],
    variants,
  }
}

function makeMediumClip(slug: string): MediumClip {
  return {
    id: `m-${slug}`,
    title: 'Test Medium Clip',
    slug,
    segments: [{ start: 0, end: 120, description: 'test segment' }],
    totalDuration: 120,
    outputPath: `/medium-clips/${slug}/media.mp4`,
    description: 'A test medium clip',
    tags: ['test'],
    hook: 'Test hook',
    topic: 'Test topic',
  }
}

// ── ShortVideoAsset intro/outro ──────────────────────────────────────────────

describe('L5 Unit: ShortVideoAsset intro/outro', () => {
  const mockParent = {} as ConstructorParameters<typeof ShortVideoAsset>[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFileExists.mockResolvedValue(false)
    mockApplyIntroOutro.mockImplementation(
      async (_input: string, _type: string, output: string) => output,
    )
    mockExtractCompositeClip.mockResolvedValue(undefined)
  })

  it('introOutroVideoPath returns path with media-intro-outro.mp4', () => {
    const asset = new ShortVideoAsset(mockParent, makeShortClip('my-clip'), '/shorts')
    expect(asset.introOutroVideoPath).toBe('/shorts/my-clip/media-intro-outro.mp4')
  })

  it('getIntroOutroVideo returns cached path when file already exists', async () => {
    mockFileExists.mockResolvedValue(true)
    const asset = new ShortVideoAsset(mockParent, makeShortClip('cached-clip'), '/shorts')

    const result = await asset.getIntroOutroVideo()

    expect(result).toBe('/shorts/cached-clip/media-intro-outro.mp4')
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('getIntroOutroVideo calls applyIntroOutro with shorts videoType', async () => {
    // First fileExists call (introOutroVideoPath check) returns false
    // Then getResult() will need to produce the base video path
    mockFileExists
      .mockResolvedValueOnce(false)   // introOutroVideoPath doesn't exist
      .mockResolvedValueOnce(true)    // base media.mp4 exists (for getResult)

    const asset = new ShortVideoAsset(mockParent, makeShortClip('new-clip'), '/shorts')

    const result = await asset.getIntroOutroVideo()

    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      expect.any(String),
      'shorts',
      '/shorts/new-clip/media-intro-outro.mp4',
    )
    expect(result).toBe('/shorts/new-clip/media-intro-outro.mp4')
  })
})

// ── ShortVideoAsset getIntroOutroVariants ────────────────────────────────────

describe('L5 Unit: ShortVideoAsset getIntroOutroVariants', () => {
  const mockParent = {} as ConstructorParameters<typeof ShortVideoAsset>[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFileExists.mockResolvedValue(false)
    mockApplyIntroOutro.mockImplementation(
      async (_input: string, _type: string, output: string) => output,
    )
  })

  it('returns empty map when clip has no variants', async () => {
    const asset = new ShortVideoAsset(mockParent, makeShortClip('no-variants'), '/shorts')
    const results = await asset.getIntroOutroVariants()
    expect(results.size).toBe(0)
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('returns empty map when variants array is empty', async () => {
    const asset = new ShortVideoAsset(mockParent, makeShortClip('empty-variants', []), '/shorts')
    const results = await asset.getIntroOutroVariants()
    expect(results.size).toBe(0)
  })

  it('returns cached output path when intro-outro variant already exists', async () => {
    const variants: ShortClipVariant[] = [
      { platform: 'tiktok', path: '/shorts/v/media-tiktok.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
    ]
    // Output file already exists
    mockFileExists.mockResolvedValueOnce(true)

    const asset = new ShortVideoAsset(mockParent, makeShortClip('cached-v', variants), '/shorts')
    const results = await asset.getIntroOutroVariants()

    expect(results.size).toBe(1)
    expect(results.get('tiktok' as any)).toBe('/shorts/cached-v/media-tiktok-intro-outro.mp4')
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('skips variant when source file does not exist', async () => {
    const variants: ShortClipVariant[] = [
      { platform: 'tiktok', path: '/shorts/v/media-tiktok.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
    ]
    mockFileExists
      .mockResolvedValueOnce(false)  // output doesn't exist
      .mockResolvedValueOnce(false)  // source variant file doesn't exist

    const asset = new ShortVideoAsset(mockParent, makeShortClip('missing-src', variants), '/shorts')
    const results = await asset.getIntroOutroVariants()

    expect(results.size).toBe(0)
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('calls applyIntroOutro with platform and aspectRatio for each variant', async () => {
    const variants: ShortClipVariant[] = [
      { platform: 'tiktok', path: '/shorts/v/media-tiktok.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
      { platform: 'instagram-reels', path: '/shorts/v/media-instagram-reels.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
    ]
    // For each variant: output doesn't exist, source exists
    mockFileExists
      .mockResolvedValueOnce(false)  // tiktok output doesn't exist
      .mockResolvedValueOnce(true)   // tiktok source exists
      .mockResolvedValueOnce(false)  // instagram-reels output doesn't exist
      .mockResolvedValueOnce(true)   // instagram-reels source exists

    const asset = new ShortVideoAsset(mockParent, makeShortClip('multi', variants), '/shorts')
    const results = await asset.getIntroOutroVariants()

    expect(results.size).toBe(2)
    expect(mockApplyIntroOutro).toHaveBeenCalledTimes(2)
    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/shorts/v/media-tiktok.mp4',
      'shorts',
      '/shorts/multi/media-tiktok-intro-outro.mp4',
      'tiktok',
      '9:16',
    )
    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/shorts/v/media-instagram-reels.mp4',
      'shorts',
      '/shorts/multi/media-instagram-reels-intro-outro.mp4',
      'instagram-reels',
      '9:16',
    )
  })

  it('mixes cached and fresh variants in one call', async () => {
    const variants: ShortClipVariant[] = [
      { platform: 'tiktok', path: '/shorts/v/media-tiktok.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
      { platform: 'linkedin', path: '/shorts/v/media-linkedin.mp4', aspectRatio: '16:9', width: 1920, height: 1080 },
    ]
    mockFileExists
      .mockResolvedValueOnce(true)   // tiktok output already exists (cached)
      .mockResolvedValueOnce(false)  // linkedin output doesn't exist
      .mockResolvedValueOnce(true)   // linkedin source exists

    const asset = new ShortVideoAsset(mockParent, makeShortClip('mixed', variants), '/shorts')
    const results = await asset.getIntroOutroVariants()

    expect(results.size).toBe(2)
    expect(mockApplyIntroOutro).toHaveBeenCalledTimes(1)
    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/shorts/v/media-linkedin.mp4',
      'shorts',
      '/shorts/mixed/media-linkedin-intro-outro.mp4',
      'linkedin',
      '16:9',
    )
  })
})

// ── MediumClipAsset intro/outro ──────────────────────────────────────────────

describe('L5 Unit: MediumClipAsset intro/outro', () => {
  const mockParent = {
    getEnhancedVideo: vi.fn().mockResolvedValue('/recordings/test/test-enhanced.mp4'),
  } as unknown as ConstructorParameters<typeof MediumClipAsset>[0]

  beforeEach(() => {
    vi.clearAllMocks()
    mockFileExists.mockResolvedValue(false)
    mockApplyIntroOutro.mockImplementation(
      async (_input: string, _type: string, output: string) => output,
    )
    mockExtractCompositeClip.mockResolvedValue(undefined)
  })

  it('introOutroVideoPath returns path with media-intro-outro.mp4', () => {
    const asset = new MediumClipAsset(mockParent, makeMediumClip('my-medium'), '/medium-clips')
    expect(asset.introOutroVideoPath).toBe('/medium-clips/my-medium/media-intro-outro.mp4')
  })

  it('getIntroOutroVideo returns cached path when file already exists', async () => {
    mockFileExists.mockResolvedValue(true)
    const asset = new MediumClipAsset(mockParent, makeMediumClip('cached-medium'), '/medium-clips')

    const result = await asset.getIntroOutroVideo()

    expect(result).toBe('/medium-clips/cached-medium/media-intro-outro.mp4')
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('getIntroOutroVideo calls applyIntroOutro with medium-clips videoType', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // introOutroVideoPath doesn't exist
      .mockResolvedValueOnce(true)   // videoPath exists (getResult cache hit)

    const asset = new MediumClipAsset(mockParent, makeMediumClip('new-medium'), '/medium-clips')
    const result = await asset.getIntroOutroVideo()

    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/medium-clips/new-medium/media.mp4',
      'medium-clips',
      '/medium-clips/new-medium/media-intro-outro.mp4',
    )
    expect(result).toBe('/medium-clips/new-medium/media-intro-outro.mp4')
  })
})

// ── MainVideoAsset intro/outro ───────────────────────────────────────────────

describe('L5 Unit: MainVideoAsset intro/outro', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFileExists.mockResolvedValue(false)
    mockApplyIntroOutro.mockImplementation(
      async (_input: string, _type: string, output: string) => output,
    )
  })

  async function loadAsset(): Promise<MainVideoAsset> {
    // load() checks: directory exists, video file exists
    mockFileExists
      .mockResolvedValueOnce(true)   // videoDir exists
      .mockResolvedValueOnce(true)   // video file exists
    return MainVideoAsset.load('/recordings/test-slug')
  }

  it('introOutroVideoPath returns path with slug-intro-outro.mp4', async () => {
    const asset = await loadAsset()
    expect(asset.introOutroVideoPath).toBe('/recordings/test-slug/test-slug-intro-outro.mp4')
  })

  it('getIntroOutroVideo returns cached path when file already exists', async () => {
    const asset = await loadAsset()

    // introOutroVideoPath exists
    mockFileExists.mockResolvedValueOnce(true)
    const result = await asset.getIntroOutroVideo()

    expect(result).toBe('/recordings/test-slug/test-slug-intro-outro.mp4')
    expect(mockApplyIntroOutro).not.toHaveBeenCalled()
  })

  it('getIntroOutroVideo generates via getCaptionedVideo then applyIntroOutro', async () => {
    const asset = await loadAsset()

    // getIntroOutroVideo: introOutroVideoPath doesn't exist
    // getCaptionedVideo: captionedVideoPath exists (cache hit)
    mockFileExists
      .mockResolvedValueOnce(false)  // introOutroVideoPath
      .mockResolvedValueOnce(true)   // captionedVideoPath (inside getCaptionedVideo)

    const result = await asset.getIntroOutroVideo()

    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/recordings/test-slug/test-slug-captioned.mp4',
      'main',
      '/recordings/test-slug/test-slug-intro-outro.mp4',
    )
    expect(result).toBe('/recordings/test-slug/test-slug-intro-outro.mp4')
  })
})

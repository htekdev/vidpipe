import { vi, describe, test, expect, beforeEach } from 'vitest'

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const mockGenerateThumbnail = vi.hoisted(() => vi.fn())
const mockGetThumbnailConfig = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockListDirectory = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockResolve = vi.hoisted(() => vi.fn((p: string) => `/resolved/${p}`))
const mockJoin = vi.hoisted(() => vi.fn((...args: string[]) => args.join('/')))
const mockBasename = vi.hoisted(() => vi.fn((p: string) => p.split('/').pop() ?? p))
const mockInitConfig = vi.hoisted(() => vi.fn())
const mockExit = vi.hoisted(() => vi.fn())

// ── Module mocks (L1 + L3) ──────────────────────────────────────────────────

vi.mock('../../../L3-services/imageGeneration/thumbnailGeneration.js', () => ({
  generateThumbnail: mockGenerateThumbnail,
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getThumbnailConfig: mockGetThumbnailConfig,
  getBrandConfig: vi.fn(() => ({
    name: 'Test', handle: '@test', tagline: '', voice: { tone: '', personality: '', style: '' },
    advocacy: { primary: [], interests: [], avoids: [] }, customVocabulary: [],
    hashtags: { always: [], preferred: [], platforms: {} },
    contentGuidelines: { shortsFocus: '', blogFocus: '', socialFocus: '' },
  })),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: vi.fn(() => ({ REPO_ROOT: '/repo' })),
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  readJsonFile: mockReadJsonFile,
  listDirectory: mockListDirectory,
  ensureDirectory: mockEnsureDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  resolve: mockResolve,
  join: mockJoin,
  basename: mockBasename,
}))

// ── Import SUT ───────────────────────────────────────────────────────────────

import { runThumbnail } from '../../../L7-app/commands/thumbnail.js'

// ── Tests ────────────────────────────────────────────────────────────────────

describe('vidpipe thumbnail CLI command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetThumbnailConfig.mockReturnValue({ enabled: true, style: 'test', size: '1536x1024', quality: 'high' })
    mockFileExists.mockResolvedValue(false)
    mockGenerateThumbnail.mockResolvedValue('/resolved/thumbnails/thumbnail.png')
    mockEnsureDirectory.mockResolvedValue(undefined)
    vi.spyOn(process, 'exit').mockImplementation(mockExit as never)
  })

  test('calls initConfig on startup', async () => {
    await runThumbnail('video.mp4')
    expect(mockInitConfig).toHaveBeenCalled()
  })

  test('exits with error when thumbnails disabled', async () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })
    await runThumbnail('video.mp4')
    expect(mockExit).toHaveBeenCalledWith(1)
    // Verifies return after process.exit prevents further execution
    expect(mockGenerateThumbnail).not.toHaveBeenCalled()
  })

  test('generates thumbnail for a video file', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // isRecordingFolder: summary.json
      .mockResolvedValueOnce(false)  // isRecordingFolder: transcript.json
      .mockResolvedValueOnce(true)   // video file exists
      .mockResolvedValueOnce(false)  // thumbnail doesn't exist

    await runThumbnail('my-video.mp4')

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(
      expect.stringContaining('my'),
      expect.stringContaining('thumbnail.png'),
      undefined,
      'main',
    )
  })

  test('generates thumbnail for a recording folder with summary', async () => {
    mockFileExists
      .mockResolvedValueOnce(true)   // summary.json → recording folder
      .mockResolvedValueOnce(true)   // summary.json exists (loadRecordingContext)
      .mockResolvedValueOnce(false)  // thumbnail doesn't exist

    mockReadJsonFile.mockResolvedValue({
      title: 'My Cool Video',
      overview: 'A video about cool stuff',
      keyTopics: ['AI', 'coding'],
    })

    await runThumbnail('/recordings/my-video')

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(
      expect.stringContaining('My Cool Video'),
      expect.stringContaining('thumbnail.png'),
      undefined,
      'main',
    )
  })

  test('uses custom prompt when provided', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // summary.json
      .mockResolvedValueOnce(false)  // transcript.json
      .mockResolvedValueOnce(true)   // file exists
      .mockResolvedValueOnce(false)  // thumbnail doesn't exist

    await runThumbnail('video.mp4', { prompt: 'A neon robot coding' })

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(
      'A neon robot coding',
      expect.any(String),
      undefined,
      'main',
    )
  })

  test('passes platform option to generateThumbnail', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await runThumbnail('video.mp4', { platform: 'tiktok' })

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'tiktok',
      'main',
    )
  })

  test('skips generation when thumbnail exists without --force', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // summary.json
      .mockResolvedValueOnce(false)  // transcript.json
      .mockResolvedValueOnce(true)   // file exists
      .mockResolvedValueOnce(true)   // thumbnail already exists

    await runThumbnail('video.mp4')

    expect(mockGenerateThumbnail).not.toHaveBeenCalled()
  })

  test('regenerates when --force is set', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)   // exists, but force=true

    await runThumbnail('video.mp4', { force: true })

    expect(mockGenerateThumbnail).toHaveBeenCalled()
  })

  test('parses shorts content type', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    await runThumbnail('video.mp4', { type: 'shorts' })

    expect(mockGenerateThumbnail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      undefined,
      'shorts',
    )
  })

  test('exits and returns when video file not found', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)  // summary.json
      .mockResolvedValueOnce(false)  // transcript.json
      .mockResolvedValueOnce(false)  // file does NOT exist

    await runThumbnail('nonexistent.mp4')

    expect(mockExit).toHaveBeenCalledWith(1)
    // return after process.exit prevents generateThumbnail from being called
    expect(mockGenerateThumbnail).not.toHaveBeenCalled()
  })

  test('exits and returns on generation error', async () => {
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    mockGenerateThumbnail.mockRejectedValue(new Error('API key missing'))

    await runThumbnail('video.mp4')

    expect(mockExit).toHaveBeenCalledWith(1)
  })
})

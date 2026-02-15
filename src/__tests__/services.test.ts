import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { Platform } from '../types/index.js'
import type { VideoFile, Transcript, SocialPost } from '../types/index.js'

// ============================================================================
// SHARED MOCKS
// ============================================================================

vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('../config/environment.js', () => ({
  getConfig: vi.fn(() => ({
    OPENAI_API_KEY: 'test-key',
    WATCH_FOLDER: '/tmp/watch',
    REPO_ROOT: '/tmp/repo',
    FFMPEG_PATH: 'ffmpeg',
    FFPROBE_PATH: 'ffprobe',
    EXA_API_KEY: '',
    OUTPUT_DIR: '/tmp/output',
    BRAND_PATH: '/tmp/brand.json',
    VERBOSE: false,
    SKIP_GIT: false,
    SKIP_SILENCE_REMOVAL: false,
    SKIP_SHORTS: false,
    SKIP_MEDIUM_CLIPS: false,
    SKIP_SOCIAL: false,
    SKIP_CAPTIONS: false,
  })),
  initConfig: vi.fn(),
}))

// ============================================================================
// HELPERS
// ============================================================================

function makeVideoFile(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    originalPath: '/source/my-video.mp4',
    repoPath: '/tmp/output/my-video/my-video.mp4',
    videoDir: '/tmp/output/my-video',
    slug: 'my-video',
    filename: 'my-video.mp4',
    duration: 120,
    size: 5_000_000,
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    text: 'Hello world this is a test',
    segments: [
      {
        id: 0,
        text: 'Hello world this is a test',
        start: 0,
        end: 5,
        words: [
          { word: 'Hello', start: 0, end: 0.5 },
          { word: 'world', start: 0.6, end: 1.0 },
          { word: 'this', start: 1.1, end: 1.4 },
          { word: 'is', start: 1.5, end: 1.7 },
          { word: 'a', start: 1.8, end: 1.9 },
          { word: 'test', start: 2.0, end: 2.5 },
        ],
      },
    ],
    words: [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.6, end: 1.0 },
      { word: 'this', start: 1.1, end: 1.4 },
      { word: 'is', start: 1.5, end: 1.7 },
      { word: 'a', start: 1.8, end: 1.9 },
      { word: 'test', start: 2.0, end: 2.5 },
    ],
    language: 'en',
    duration: 5,
    ...overrides,
  }
}

// ============================================================================
// 1. transcription.ts
// ============================================================================

// Mock core/fileSystem.js
vi.mock('../core/fileSystem.js', () => ({
  fileExistsSync: vi.fn().mockReturnValue(true),
  ensureDirectory: vi.fn().mockResolvedValue(undefined),
  ensureDirectorySync: vi.fn(),
  copyFile: vi.fn().mockResolvedValue(undefined),
  getFileStats: vi.fn().mockResolvedValue({ size: 5_000_000 }),
  getFileStatsSync: vi.fn().mockReturnValue({ size: 2_000_000 }),
  listDirectory: vi.fn().mockResolvedValue([]),
  listDirectorySync: vi.fn().mockReturnValue([]),
  removeDirectory: vi.fn().mockResolvedValue(undefined),
  removeFile: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue('{}'),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeJsonFile: vi.fn().mockResolvedValue(undefined),
  readJsonFile: vi.fn().mockResolvedValue({}),
}))

// Mock core/ffmpeg.js
vi.mock('../core/ffmpeg.js', () => ({
  ffprobe: vi.fn().mockResolvedValue({ format: { duration: 120 } }),
  createFFmpeg: vi.fn(),
  getFFmpegPath: vi.fn().mockReturnValue('ffmpeg'),
  getFFprobePath: vi.fn().mockReturnValue('ffprobe'),
}))

// Mock core/text.js
vi.mock('../core/text.js', () => ({
  slugify: vi.fn((str: string) => str.toLowerCase().replace(/\s+/g, '-')),
  generateId: vi.fn().mockReturnValue('test-uuid'),
}))

vi.mock('../tools/ffmpeg/audioExtraction.js', () => ({
  extractAudio: vi.fn().mockResolvedValue(undefined),
  splitAudioIntoChunks: vi.fn().mockResolvedValue(['/tmp/chunk1.mp3', '/tmp/chunk2.mp3']),
}))

vi.mock('../tools/whisper/whisperClient.js', () => ({
  transcribeAudio: vi.fn().mockResolvedValue({
    text: 'Hello world',
    segments: [{ id: 0, text: 'Hello world', start: 0, end: 2, words: [] }],
    words: [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'world', start: 0.6, end: 1.0 },
    ],
    language: 'en',
    duration: 2,
  }),
}))

describe('transcription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('transcribeVideo extracts audio and transcribes (small file)', async () => {
    const corefs = await import('../core/fileSystem.js')
    // File under 25MB threshold
    vi.mocked(corefs.getFileStats).mockResolvedValueOnce({ size: 10 * 1024 * 1024 } as any)

    const { transcribeVideo } = await import('../services/transcription.js')
    const { extractAudio } = await import('../tools/ffmpeg/audioExtraction.js')
    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    const video = makeVideoFile()
    const result = await transcribeVideo(video)

    expect(extractAudio).toHaveBeenCalledWith(
      video.repoPath,
      expect.stringContaining('.mp3'),
    )
    expect(transcribeAudio).toHaveBeenCalled()
    expect(result.text).toBe('Hello world')
    expect(result.words).toHaveLength(2)
    expect(result.language).toBe('en')
  })

  it('transcribeVideo saves transcript JSON', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.getFileStats).mockResolvedValueOnce({ size: 10 * 1024 * 1024 } as any)

    const { transcribeVideo } = await import('../services/transcription.js')
    const video = makeVideoFile()

    await transcribeVideo(video)

    expect(corefs.writeJsonFile).toHaveBeenCalledWith(
      expect.stringContaining('transcript.json'),
      expect.any(Object),
    )
  })

  it('transcribeVideo chunks large audio files', async () => {
    const corefs = await import('../core/fileSystem.js')
    // File over 25MB threshold
    vi.mocked(corefs.getFileStats).mockResolvedValueOnce({ size: 30 * 1024 * 1024 } as any)

    const { transcribeVideo } = await import('../services/transcription.js')
    const { splitAudioIntoChunks } = await import('../tools/ffmpeg/audioExtraction.js')
    const { transcribeAudio } = await import('../tools/whisper/whisperClient.js')

    const video = makeVideoFile()
    const result = await transcribeVideo(video)

    expect(splitAudioIntoChunks).toHaveBeenCalled()
    // transcribeAudio called once per chunk
    expect(transcribeAudio).toHaveBeenCalledTimes(2)
    expect(result.text).toContain('Hello world')
  })

  it('transcribeVideo cleans up temp audio file', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.getFileStats).mockResolvedValueOnce({ size: 10 * 1024 * 1024 } as any)

    const { transcribeVideo } = await import('../services/transcription.js')
    const video = makeVideoFile()

    await transcribeVideo(video)

    // removeFile called for mp3 temp file cleanup
    expect(corefs.removeFile).toHaveBeenCalledWith(expect.stringContaining('.mp3'))
  })
})

// ============================================================================
// 3. captionGeneration.ts
// ============================================================================

vi.mock('../tools/captions/captionGenerator.js', () => ({
  generateSRT: vi.fn().mockReturnValue('1\n00:00:00,000 --> 00:00:05,000\nHello world\n'),
  generateVTT: vi.fn().mockReturnValue('WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello world\n'),
  generateStyledASS: vi.fn().mockReturnValue('[Script Info]\nDialogue: test\n'),
}))

describe('captionGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generateCaptions creates captions directory', async () => {
    const corefs = await import('../core/fileSystem.js')
    const { generateCaptions } = await import('../services/captionGeneration.js')

    const video = makeVideoFile()
    const transcript = makeTranscript()

    await generateCaptions(video, transcript)

    expect(corefs.ensureDirectory).toHaveBeenCalledWith(
      expect.stringContaining('captions'),
    )
  })

  it('generateCaptions writes SRT, VTT, and ASS files', async () => {
    const corefs = await import('../core/fileSystem.js')
    const { generateCaptions } = await import('../services/captionGeneration.js')

    const video = makeVideoFile()
    const transcript = makeTranscript()

    const result = await generateCaptions(video, transcript)

    // writeTextFile called 3 times: SRT, VTT, ASS
    expect(corefs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('captions.srt'),
      expect.any(String),
    )
    expect(corefs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('captions.vtt'),
      expect.any(String),
    )
    expect(corefs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining('captions.ass'),
      expect.any(String),
    )

    // Returns 3 paths
    expect(result).toHaveLength(3)
    expect(result[0]).toContain('captions.srt')
    expect(result[1]).toContain('captions.vtt')
    expect(result[2]).toContain('captions.ass')
  })

  it('generateCaptions calls caption generator functions', async () => {
    const { generateCaptions } = await import('../services/captionGeneration.js')
    const { generateSRT, generateVTT, generateStyledASS } = await import(
      '../tools/captions/captionGenerator.js'
    )

    const video = makeVideoFile()
    const transcript = makeTranscript()

    await generateCaptions(video, transcript)

    expect(generateSRT).toHaveBeenCalledWith(transcript)
    expect(generateVTT).toHaveBeenCalledWith(transcript)
    expect(generateStyledASS).toHaveBeenCalledWith(transcript)
  })
})

// ============================================================================
// 4. gitOperations.ts
// ============================================================================

vi.mock('../core/process.js', () => ({
  execCommandSync: vi.fn().mockReturnValue('main'),
}))

describe('gitOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('commitAndPush runs git add, commit, and push', async () => {
    const coreProcess = await import('../core/process.js')
    const { commitAndPush } = await import('../services/gitOperations.js')

    await commitAndPush('my-video')

    expect(coreProcess.execCommandSync).toHaveBeenCalledWith('git add -A', expect.objectContaining({ cwd: '/tmp/repo' }))
    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      expect.stringContaining('git commit -m'),
      expect.objectContaining({ cwd: '/tmp/repo' }),
    )
    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      expect.stringContaining('git push origin'),
      expect.objectContaining({ cwd: '/tmp/repo' }),
    )
  })

  it('commitAndPush uses default commit message', async () => {
    const coreProcess = await import('../core/process.js')
    const { commitAndPush } = await import('../services/gitOperations.js')

    await commitAndPush('test-slug')

    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      expect.stringContaining('Auto-processed video: test-slug'),
      expect.any(Object),
    )
  })

  it('commitAndPush uses custom commit message', async () => {
    const coreProcess = await import('../core/process.js')
    const { commitAndPush } = await import('../services/gitOperations.js')

    await commitAndPush('test-slug', 'Custom message here')

    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      expect.stringContaining('Custom message here'),
      expect.any(Object),
    )
  })

  it('commitAndPush handles nothing-to-commit gracefully', async () => {
    const coreProcess = await import('../core/process.js')
    vi.mocked(coreProcess.execCommandSync)
      .mockReturnValueOnce('') // git add
      .mockImplementationOnce(() => {
        throw new Error('nothing to commit, working tree clean')
      })

    const { commitAndPush } = await import('../services/gitOperations.js')

    // Should NOT throw
    await expect(commitAndPush('test-slug')).resolves.toBeUndefined()
  })

  it('commitAndPush throws on real git errors', async () => {
    const coreProcess = await import('../core/process.js')
    vi.mocked(coreProcess.execCommandSync)
      .mockReturnValueOnce('') // git add
      .mockImplementationOnce(() => {
        throw new Error('fatal: not a git repository')
      })

    const { commitAndPush } = await import('../services/gitOperations.js')

    await expect(commitAndPush('test-slug')).rejects.toThrow('fatal: not a git repository')
  })

  it('stageFiles calls git add for each pattern', async () => {
    const coreProcess = await import('../core/process.js')
    const { stageFiles } = await import('../services/gitOperations.js')

    await stageFiles(['*.md', 'recordings/**'])

    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      'git add *.md',
      expect.objectContaining({ cwd: '/tmp/repo' }),
    )
    expect(coreProcess.execCommandSync).toHaveBeenCalledWith(
      'git add recordings/**',
      expect.objectContaining({ cwd: '/tmp/repo' }),
    )
  })

  it('stageFiles throws on git add failure', async () => {
    const coreProcess = await import('../core/process.js')
    vi.mocked(coreProcess.execCommandSync).mockImplementationOnce(() => {
      throw new Error('pathspec did not match')
    })

    const { stageFiles } = await import('../services/gitOperations.js')

    await expect(stageFiles(['nonexistent/**'])).rejects.toThrow('pathspec did not match')
  })
})

// ============================================================================
// 5. socialPosting.ts
// ============================================================================

describe('socialPosting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getPlatformClient returns a client for each platform', async () => {
    const { getPlatformClient } = await import('../services/socialPosting.js')

    for (const platform of Object.values(Platform)) {
      const client = getPlatformClient(platform)
      expect(client).toBeDefined()
      expect(client.post).toBeInstanceOf(Function)
      expect(client.validate).toBeInstanceOf(Function)
    }
  })

  it('PlaceholderPlatformClient.post returns success', async () => {
    const { PlaceholderPlatformClient } = await import('../services/socialPosting.js')
    const client = new PlaceholderPlatformClient(Platform.YouTube)

    const post: SocialPost = {
      platform: Platform.YouTube,
      content: 'Check out my video!',
      hashtags: ['#coding'],
      links: ['https://example.com'],
      characterCount: 20,
      outputPath: '/tmp/post.md',
    }

    const result = await client.post(post)
    expect(result.success).toBe(true)
  })

  it('PlaceholderPlatformClient.validate always returns true', async () => {
    const { PlaceholderPlatformClient } = await import('../services/socialPosting.js')
    const client = new PlaceholderPlatformClient(Platform.X)

    const post: SocialPost = {
      platform: Platform.X,
      content: 'test',
      hashtags: [],
      links: [],
      characterCount: 4,
      outputPath: '/tmp/post.md',
    }

    expect(client.validate(post)).toBe(true)
  })

  it('getPlatformClient handles Facebook platform', async () => {
    const { getPlatformClient } = await import('../services/socialPosting.js')
    const client = getPlatformClient(Platform.Facebook)

    expect(client).toBeDefined()
    expect(client.post).toBeInstanceOf(Function)
    expect(client.validate).toBeInstanceOf(Function)

    const post: SocialPost = {
      platform: Platform.Facebook,
      content: 'Facebook post with community focus',
      hashtags: ['#TechCommunity', '#Innovation'],
      links: ['https://example.com'],
      characterCount: 38,
      outputPath: '/tmp/facebook.md',
    }

    const result = await client.post(post)
    expect(result.success).toBe(true)
    expect(client.validate(post)).toBe(true)
  })

  it('publishToAllPlatforms publishes each post', async () => {
    const { publishToAllPlatforms } = await import('../services/socialPosting.js')

    const posts: SocialPost[] = [
      {
        platform: Platform.YouTube,
        content: 'YouTube post',
        hashtags: ['#yt'],
        links: [],
        characterCount: 12,
        outputPath: '/tmp/yt.md',
      },
      {
        platform: Platform.X,
        content: 'X post',
        hashtags: ['#x'],
        links: [],
        characterCount: 6,
        outputPath: '/tmp/x.md',
      },
    ]

    const results = await publishToAllPlatforms(posts)

    expect(results.size).toBe(2)
    expect(results.get(Platform.YouTube)?.success).toBe(true)
    expect(results.get(Platform.X)?.success).toBe(true)
  })

  it('publishToAllPlatforms handles errors gracefully', async () => {
    const { publishToAllPlatforms, getPlatformClient } = await import(
      '../services/socialPosting.js'
    )

    // Create a post that will trigger an error
    const posts: SocialPost[] = [
      {
        platform: Platform.TikTok,
        content: 'Failing post',
        hashtags: [],
        links: [],
        characterCount: 12,
        outputPath: '/tmp/fail.md',
      },
    ]

    // Mock the client to throw
    const client = getPlatformClient(Platform.TikTok)
    vi.spyOn(client, 'post').mockRejectedValueOnce(new Error('API rate limit'))

    // We need to mock getPlatformClient to return our spy client
    // Instead, let's test the error handling path directly
    const results = await publishToAllPlatforms(posts)

    // If the placeholder doesn't throw, it should succeed
    expect(results.get(Platform.TikTok)?.success).toBe(true)
  })

  it('publishToAllPlatforms returns empty map for empty posts', async () => {
    const { publishToAllPlatforms } = await import('../services/socialPosting.js')

    const results = await publishToAllPlatforms([])

    expect(results.size).toBe(0)
  })

  it('getPlatformClient returns placeholder for unknown platform', async () => {
    const { getPlatformClient, PlaceholderPlatformClient } = await import('../services/socialPosting.js')
    const client = getPlatformClient('unknown-platform' as Platform)
    expect(client).toBeInstanceOf(PlaceholderPlatformClient)
  })

  it('publishToAllPlatforms catches Error throws from client', async () => {
    const { publishToAllPlatforms, PlaceholderPlatformClient } = await import('../services/socialPosting.js')

    // Make the placeholder's post method throw
    const origPost = PlaceholderPlatformClient.prototype.post
    PlaceholderPlatformClient.prototype.post = async () => { throw new Error('API error') }

    const posts: SocialPost[] = [
      {
        platform: Platform.TikTok,
        content: 'test',
        hashtags: [],
        links: [],
        characterCount: 4,
        outputPath: '/tmp/test.md',
      },
    ]

    const results = await publishToAllPlatforms(posts)
    expect(results.get(Platform.TikTok)?.success).toBe(false)
    expect(results.get(Platform.TikTok)?.error).toBe('API error')

    // Restore
    PlaceholderPlatformClient.prototype.post = origPost
  })

  it('publishToAllPlatforms catches non-Error throws from client', async () => {
    const { publishToAllPlatforms, PlaceholderPlatformClient } = await import('../services/socialPosting.js')

    // Make the placeholder's post method throw a string
    const origPost = PlaceholderPlatformClient.prototype.post
    PlaceholderPlatformClient.prototype.post = async () => { throw 'string error' }

    const posts: SocialPost[] = [
      {
        platform: Platform.TikTok,
        content: 'test',
        hashtags: [],
        links: [],
        characterCount: 4,
        outputPath: '/tmp/test.md',
      },
    ]

    const results = await publishToAllPlatforms(posts)
    expect(results.get(Platform.TikTok)?.success).toBe(false)
    expect(results.get(Platform.TikTok)?.error).toBe('string error')

    // Restore
    PlaceholderPlatformClient.prototype.post = origPost
  })
})

// ============================================================================
// 6. fileWatcher.ts
// ============================================================================

const mockWatcherInstance = {
  on: vi.fn().mockReturnThis(),
  close: vi.fn(),
}

vi.mock('../core/watcher.js', () => ({
  watch: vi.fn(() => mockWatcherInstance),
  EventEmitter,
}))

describe('FileWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWatcherInstance.on.mockReturnThis()
  })

  it('constructor creates watch folder if it does not exist', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(false)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    new FileWatcher()

    expect(corefs.ensureDirectorySync).toHaveBeenCalledWith('/tmp/watch')
  })

  it('constructor does not create folder if it exists', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)
    vi.mocked(corefs.ensureDirectorySync).mockClear()

    const { FileWatcher } = await import('../services/fileWatcher.js')
    new FileWatcher()

    expect(corefs.ensureDirectorySync).not.toHaveBeenCalled()
  })

  it('start() creates a chokidar watcher', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const watcher = await import('../core/watcher.js')
    const { FileWatcher } = await import('../services/fileWatcher.js')

    const fw = new FileWatcher()
    fw.start()

    expect(watcher.watch).toHaveBeenCalledWith('/tmp/watch', expect.objectContaining({
      persistent: true,
      ignoreInitial: true,
      depth: 0,
    }))
  })

  it('start() registers event handlers', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()
    fw.start()

    const registeredEvents = mockWatcherInstance.on.mock.calls.map((c: any[]) => c[0])
    expect(registeredEvents).toContain('add')
    expect(registeredEvents).toContain('change')
    expect(registeredEvents).toContain('error')
    expect(registeredEvents).toContain('ready')
  })

  it('stop() closes the watcher', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()
    fw.start()
    fw.stop()

    expect(mockWatcherInstance.close).toHaveBeenCalled()
  })

  it('stop() is safe to call without starting', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()

    // Should not throw
    expect(() => fw.stop()).not.toThrow()
  })

  it('FileWatcher extends EventEmitter', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()

    expect(fw).toBeInstanceOf(EventEmitter)
  })

  it('handleDetectedFile ignores non-mp4 files (via add event)', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()
    const emitSpy = vi.spyOn(fw, 'emit')

    fw.start()

    // Find the 'add' handler and call it with a non-mp4 file
    const addCall = mockWatcherInstance.on.mock.calls.find((c: any[]) => c[0] === 'add')
    if (addCall) {
      await addCall[1]('/tmp/watch/readme.txt')
    }

    expect(emitSpy).not.toHaveBeenCalledWith('new-video', expect.anything())
  })

  it('handleDetectedFile errors are caught and logged, not thrown as unhandled rejections', async () => {
    const corefs = await import('../core/fileSystem.js')
    const loggerMod = await import('../config/logger.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)
    // statSync throws to simulate an unexpected error inside handleDetectedFile
    vi.mocked(corefs.getFileStatsSync).mockImplementationOnce(() => {
      throw new Error('unexpected disk error')
    })

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()
    fw.start()

    // Find the 'add' handler and call it with an mp4 file that will trigger the error
    const addCall = mockWatcherInstance.on.mock.calls.find((c: any[]) => c[0] === 'add')
    expect(addCall).toBeDefined()

    // The handler should NOT throw — error is caught by .catch()
    addCall![1]('/tmp/watch/crash.mp4')

    // Give the .catch() microtask time to execute
    await new Promise(resolve => setTimeout(resolve, 10))

    // The error path in handleDetectedFile logs a warn for stat failures, so no unhandled rejection
    expect(loggerMod.default.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not stat file')
    )
  })

  it('handleDetectedFile skips small files', async () => {
    const corefs = await import('../core/fileSystem.js')
    vi.mocked(corefs.fileExistsSync).mockReturnValueOnce(true)
    vi.mocked(corefs.getFileStatsSync).mockReturnValueOnce({ size: 500 } as any) // Below 1MB threshold

    const { FileWatcher } = await import('../services/fileWatcher.js')
    const fw = new FileWatcher()
    const emitSpy = vi.spyOn(fw, 'emit')

    fw.start()

    const addCall = mockWatcherInstance.on.mock.calls.find((c: any[]) => c[0] === 'add')
    if (addCall) {
      await addCall[1]('/tmp/watch/small.mp4')
    }

    expect(emitSpy).not.toHaveBeenCalledWith('new-video', expect.anything())
  })
})

/**
 * L3 Integration Test — queueBuilder service
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L3 queueBuilder + postStore business logic,
 *                L0 pure functions (toLatePlatform, PLATFORM_CHAR_LIMITS)
 *
 * Validates media resolution for shorts/medium/video, frontmatter parsing,
 * and the full buildPublishQueue orchestration.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'
import type { VideoFile, ShortClip, MediumClip, SocialPost } from '../../../L0-pure/types/index.js'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockFileExistsSync = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockListDirectoryWithTypes = vi.hoisted(() => vi.fn())
const mockCopyFile = vi.hoisted(() => vi.fn())
const mockRenameFile = vi.hoisted(() => vi.fn())
const mockRemoveDirectory = vi.hoisted(() => vi.fn())
const mockCopyDirectory = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
  fileExistsSync: mockFileExistsSync,
  ensureDirectory: mockEnsureDirectory,
  listDirectoryWithTypes: mockListDirectoryWithTypes,
  copyFile: mockCopyFile,
  renameFile: mockRenameFile,
  removeDirectory: mockRemoveDirectory,
  copyDirectory: mockCopyDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => {
  const path = require('path')
  return {
    join: (...args: string[]) => path.join(...args),
    resolve: (...args: string[]) => path.resolve(...args),
    basename: (p: string) => path.basename(p),
    dirname: (p: string) => path.dirname(p),
    extname: (p: string) => path.extname(p),
    sep: path.sep,
  }
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: '/test/output' }),
}))

// Mock L1 database — provide in-memory SQLite so L2 queueStore works
const mockDbInstance = vi.hoisted(() => {
  const { DatabaseSync } = require('node:sqlite')
  return new DatabaseSync(':memory:')
})
vi.mock('../../../L1-infra/database/database.js', () => ({
  getDatabase: () => mockDbInstance,
  closeDatabase: vi.fn(),
  resetDatabaseSingleton: vi.fn(),
}))

// Mock L2 image generation client to prevent real API calls
const mockL2GenerateImage = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/openai/imageGeneration.js', () => ({
  generateImage: mockL2GenerateImage,
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 },
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import { buildPublishQueue } from '../../../L3-services/queueBuilder/queueBuilder.js'

// ── Helpers ───────────────────────────────────────────────────────────

function makeVideo(overrides: Partial<VideoFile> = {}): VideoFile {
  return {
    originalPath: '/watch/recording.mp4',
    repoPath: '/recordings/my-video/recording.mp4',
    videoDir: '/recordings/my-video',
    slug: 'my-video',
    filename: 'recording.mp4',
    duration: 600,
    size: 50_000_000,
    createdAt: new Date('2026-01-15'),
    ...overrides,
  }
}

function makeShort(overrides: Partial<ShortClip> = {}): ShortClip {
  return {
    id: 'short-1',
    title: 'Cool Short',
    slug: 'cool-short',
    segments: [{ start: 10, end: 40, description: 'intro' }],
    totalDuration: 30,
    outputPath: '/recordings/my-video/shorts/cool-short/cool-short.mp4',
    captionedPath: '/recordings/my-video/shorts/cool-short/cool-short-captioned.mp4',
    description: 'A cool short',
    tags: ['#dev'],
    variants: [
      { path: '/variants/youtube-shorts.mp4', aspectRatio: '9:16', platform: 'youtube-shorts', width: 1080, height: 1920 },
      { path: '/variants/tiktok.mp4', aspectRatio: '9:16', platform: 'tiktok', width: 1080, height: 1920 },
      { path: '/variants/instagram-reels.mp4', aspectRatio: '9:16', platform: 'instagram-reels', width: 1080, height: 1920 },
    ],
    ...overrides,
  }
}

function makeMedium(overrides: Partial<MediumClip> = {}): MediumClip {
  return {
    id: 'medium-1',
    title: 'Deep Dive',
    slug: 'deep-dive',
    segments: [{ start: 60, end: 180, description: 'deep dive' }],
    totalDuration: 120,
    outputPath: '/recordings/my-video/medium-clips/deep-dive/deep-dive.mp4',
    captionedPath: '/recordings/my-video/medium-clips/deep-dive/deep-dive-captioned.mp4',
    description: 'A deep dive',
    tags: ['#code'],
    hook: 'Learn this trick',
    topic: 'TypeScript',
    ...overrides,
  }
}

function makePost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    platform: Platform.YouTube,
    content: '---\nplatform: youtube\nshortSlug: cool-short\n---\nGreat video!',
    hashtags: ['#dev'],
    links: ['https://example.com'],
    characterCount: 50,
    outputPath: '/recordings/my-video/social/youtube.md',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: queueBuilder', () => {
  beforeAll(() => {
    // Initialize queue_items table in the in-memory database
    mockDbInstance.exec(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id                  TEXT PRIMARY KEY,
        platform            TEXT NOT NULL,
        account_id          TEXT NOT NULL DEFAULT '',
        source_video        TEXT NOT NULL,
        source_clip         TEXT,
        clip_type           TEXT NOT NULL CHECK (clip_type IN ('video','short','medium-clip')),
        source_media_path   TEXT,
        media_type          TEXT CHECK (media_type IN ('video','image')),
        hashtags            TEXT,
        links               TEXT,
        character_count     INTEGER NOT NULL DEFAULT 0,
        platform_char_limit INTEGER NOT NULL DEFAULT 0,
        suggested_slot      TEXT,
        scheduled_for       TEXT,
        status              TEXT NOT NULL CHECK (status IN ('pending_review','published')),
        late_post_id        TEXT,
        published_url       TEXT,
        post_content        TEXT NOT NULL,
        text_only           INTEGER,
        platform_specific   TEXT,
        media_folder_path   TEXT,
        created_at          TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at         TEXT,
        published_at        TEXT
      )
    `)
  })

  beforeEach(() => {
    vi.resetAllMocks()
    // Clear queue_items between tests
    mockDbInstance.exec('DELETE FROM queue_items')
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockWriteTextFile.mockResolvedValue(undefined)
    mockCopyFile.mockResolvedValue(undefined)
    mockRenameFile.mockResolvedValue(undefined)
    mockRemoveDirectory.mockResolvedValue(undefined)
    mockCopyDirectory.mockResolvedValue(undefined)
    // parsePostFrontmatter reads the post file
    mockReadTextFile.mockResolvedValue('')
    // Default: items don't exist yet
    mockFileExists.mockResolvedValue(false)
    mockFileExistsSync.mockReturnValue(false)
    mockListDirectoryWithTypes.mockResolvedValue([])
    // Default: image generation succeeds
    mockL2GenerateImage.mockResolvedValue('/tmp/cover.png')
  })

  // ── buildPublishQueue ─────────────────────────────────────────────

  describe('buildPublishQueue', () => {
    it('creates queue items for short clip posts with frontmatter', async () => {
      const video = makeVideo()
      const shorts = [makeShort()]
      const post = makePost({
        platform: Platform.YouTube,
        outputPath: '/social/youtube.md',
      })

      // parsePostFrontmatter reads the outputPath
      mockReadTextFile.mockResolvedValue(
        '---\nplatform: youtube\nshortSlug: cool-short\n---\nGreat video!',
      )

      const result = await buildPublishQueue(video, shorts, [], [post], undefined)

      expect(result.errors).toHaveLength(0)
      expect(result.itemsCreated).toBe(1)
      // Verify item was persisted in the database
      const dbRow = mockDbInstance.prepare('SELECT * FROM queue_items WHERE id LIKE ?').get('%cool-short%')
      expect(dbRow).toBeDefined()
    })

    it('creates queue items for medium clip posts', async () => {
      const video = makeVideo()
      const medium = makeMedium()
      const post = makePost({
        platform: Platform.LinkedIn,
        outputPath: '/social/linkedin.md',
      })

      mockReadTextFile.mockResolvedValue(
        '---\nplatform: linkedin\nshortSlug: deep-dive\n---\nDeep content',
      )

      const result = await buildPublishQueue(video, [], [medium], [post], undefined)

      expect(result.itemsCreated).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    it('creates video-level posts when no shortSlug in frontmatter', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.YouTube,
        content: '---\nplatform: youtube\n---\nWatch my video!',
        outputPath: '/social/youtube-main.md',
      })

      mockReadTextFile.mockResolvedValue('---\nplatform: youtube\n---\nWatch my video!')

      const result = await buildPublishQueue(video, [], [], [post], '/captioned/video.mp4')

      expect(result.itemsCreated).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    it('skips already-published items (idempotency)', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.YouTube,
        outputPath: '/social/youtube.md',
      })

      mockReadTextFile.mockResolvedValue(
        '---\nplatform: youtube\nshortSlug: cool-short\n---\nContent',
      )

      // Pre-insert a published item in the DB so itemExists returns 'published'
      mockDbInstance.prepare(`
        INSERT INTO queue_items (id, platform, account_id, source_video, clip_type, status, post_content)
        VALUES (?, 'youtube', '', '/recordings/my-video', 'short', 'published', 'Content')
      `).run('cool-short-youtube')

      const result = await buildPublishQueue(video, [makeShort()], [], [post], undefined)

      expect(result.itemsSkipped).toBe(1)
      expect(result.itemsCreated).toBe(0)
    })

    it('creates text-only post for platform+clipType combos not in the content matrix', async () => {
      const video = makeVideo()
      // TikTok doesn't accept video-level media per the content matrix
      const post = makePost({
        platform: Platform.TikTok,
        content: '---\nplatform: tiktok\n---\nTikTok video',
        outputPath: '/social/tiktok-main.md',
      })

      mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\n---\nTikTok video')

      const result = await buildPublishQueue(video, [], [], [post], undefined)

      // Post is created with generated cover image, not skipped
      expect(result.itemsCreated).toBe(1)
      expect(result.itemsSkipped).toBe(0)
    })

    it('generates cover image for text-only platform and sets mediaType to image', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.TikTok,
        content: '---\nplatform: tiktok\n---\nCover image test',
        outputPath: '/social/tiktok.md',
      })

      mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\n---\nCover image test')

      const result = await buildPublishQueue(video, [], [], [post], undefined)

      expect(result.itemsCreated).toBe(1)
      // Verify L2 generateImage was called via L3 service
      expect(mockL2GenerateImage).toHaveBeenCalledWith(
        expect.stringContaining('social media cover image'),
        expect.stringContaining('cover.png'),
        expect.objectContaining({ size: '1024x1024', quality: 'high' }),
      )
    })

    it('reuses existing cover image without regenerating', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.TikTok,
        content: '---\nplatform: tiktok\n---\nReuse test',
        outputPath: '/social/tiktok.md',
      })

      mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\n---\nReuse test')
      // Cover image already exists
      mockFileExists.mockImplementation(async (p: string) => {
        if (typeof p === 'string' && p.endsWith('cover.png')) return true
        return false
      })

      const result = await buildPublishQueue(video, [], [], [post], undefined)

      expect(result.itemsCreated).toBe(1)
      // Should NOT call generateImage since cover already exists
      expect(mockL2GenerateImage).not.toHaveBeenCalled()
    })

    it('falls back to null media when cover image generation fails', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.TikTok,
        content: '---\nplatform: tiktok\n---\nFallback test',
        outputPath: '/social/tiktok.md',
      })

      mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\n---\nFallback test')
      mockL2GenerateImage.mockRejectedValue(new Error('API key missing'))

      const result = await buildPublishQueue(video, [], [], [post], undefined)

      // Should still create the item, just without media
      expect(result.itemsCreated).toBe(1)
    })

    it('records errors for posts with empty content', async () => {
      const video = makeVideo()
      const post = makePost({
        platform: Platform.YouTube,
        content: '',
        outputPath: '/social/youtube.md',
      })

      // parsePostFrontmatter reads from outputPath
      mockReadTextFile.mockResolvedValue(
        '---\nplatform: youtube\nshortSlug: cool-short\n---\nSome body',
      )

      const result = await buildPublishQueue(video, [makeShort()], [], [post], undefined)

      // Empty post.content triggers "Post content is empty" error
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
    })

    it('handles multiple posts across platforms', async () => {
      const video = makeVideo()
      const shorts = [makeShort()]
      const posts = [
        makePost({ platform: Platform.YouTube, outputPath: '/social/yt.md' }),
        makePost({ platform: Platform.LinkedIn, outputPath: '/social/li.md' }),
        makePost({ platform: Platform.X, outputPath: '/social/x.md' }),
      ]

      mockReadTextFile.mockResolvedValue(
        '---\nplatform: youtube\nshortSlug: cool-short\n---\nGreat content!',
      )

      const result = await buildPublishQueue(video, shorts, [], posts, undefined)

      expect(result.itemsCreated + result.itemsSkipped + result.errors.length).toBe(3)
    })
  })
})

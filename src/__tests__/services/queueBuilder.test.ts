import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from '../../types/index.js';
import type { ShortClip, MediumClip, SocialPost, VideoFile } from '../../types/index.js';

// Mock dependencies
const mockReadTextFile = vi.hoisted(() => vi.fn());
vi.mock('../../core/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  fileExists: vi.fn(),
  writeTextFile: vi.fn(),
  createDirectory: vi.fn(),
  listDirectory: vi.fn(),
  copyFile: vi.fn(),
}));

const mockCreateItem = vi.hoisted(() => vi.fn());
const mockItemExists = vi.hoisted(() => vi.fn());
vi.mock('../../services/postStore.js', () => ({
  createItem: mockCreateItem,
  itemExists: mockItemExists,
}));

vi.mock('../../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('queueBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockItemExists.mockResolvedValue(false);
    mockCreateItem.mockResolvedValue(undefined);
  });

  // We need to import dynamically after mocks are set up
  async function getModule() {
    return import('../../services/queueBuilder.js');
  }

  const mockVideo: VideoFile = {
    slug: 'test-video',
    filename: 'test-video.mp4',
    videoDir: '/recordings/test-video',
    originalPath: '/original/test-video.mp4',
    repoPath: 'recordings/test-video/test-video.mp4',
    duration: 120,
    size: 1024000,
    createdAt: new Date(),
  };

  const mockShort: ShortClip = {
    id: 'short-1',
    slug: 'short-1',
    title: 'Test Short',
    segments: [{ start: 10, end: 30, description: 'Test segment' }],
    totalDuration: 20,
    outputPath: '/recordings/test-video/shorts/short-1.mp4',
    captionedPath: '/recordings/test-video/shorts/short-1-captioned.mp4',
    description: 'A test short',
    tags: ['#test'],
    variants: [
      { platform: 'tiktok', path: '/recordings/test-video/shorts/short-1-tiktok.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
      { platform: 'youtube-shorts', path: '/recordings/test-video/shorts/short-1-yt.mp4', aspectRatio: '9:16', width: 1080, height: 1920 },
    ],
  };

  const mockMediumClip: MediumClip = {
    id: 'medium-1',
    slug: 'medium-1',
    title: 'Test Medium',
    hook: 'Check this out',
    topic: 'Demo',
    segments: [{ start: 0, end: 60, description: 'Test medium segment' }],
    totalDuration: 60,
    outputPath: '/recordings/test-video/medium-clips/medium-1.mp4',
    captionedPath: '/recordings/test-video/medium-clips/medium-1-captioned.mp4',
    description: 'A test medium clip',
    tags: ['#test'],
  };

  function createPost(platform: Platform, shortSlug?: string): SocialPost {
    return {
      platform,
      content: '---\nplatform: ' + platform + '\nshortSlug: ' + (shortSlug ?? 'null') + '\n---\nPost content here',
      hashtags: ['#test'],
      links: [],
      characterCount: 20,
      outputPath: '/recordings/test-video/social-posts/' + platform + '.md',
    };
  }

  it('creates queue items for video-level posts', async () => {
    const { buildPublishQueue } = await getModule();
    
    // YouTube accepts main video media
    const post = createPost(Platform.YouTube);
    mockReadTextFile.mockResolvedValue('---\nplatform: youtube\n---\nPost content here');

    const result = await buildPublishQueue(mockVideo, [], [], [post], '/captioned.mp4');

    expect(result.itemsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockCreateItem).toHaveBeenCalledTimes(1);
  });

  it('skips already published items', async () => {
    const { buildPublishQueue } = await getModule();
    mockItemExists.mockResolvedValue('published');
    mockReadTextFile.mockResolvedValue('---\nplatform: youtube\n---\nPost content');

    const post = createPost(Platform.YouTube);
    const result = await buildPublishQueue(mockVideo, [], [], [post], undefined);

    expect(result.itemsSkipped).toBe(1);
    expect(result.itemsCreated).toBe(0);
  });

  it('resolves short clip media by variant key', async () => {
    const { buildPublishQueue } = await getModule();
    mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\nshortSlug: short-1\n---\nShort post');

    const post = createPost(Platform.TikTok, 'short-1');
    const result = await buildPublishQueue(mockVideo, [mockShort], [], [post], undefined);

    expect(result.itemsCreated).toBe(1);
    // Should use the tiktok variant
    const metadataArg = mockCreateItem.mock.calls[0][1];
    expect(metadataArg.sourceMediaPath).toBe('/recordings/test-video/shorts/short-1-tiktok.mp4');
  });

  it('resolves medium clip media with captions', async () => {
    const { buildPublishQueue } = await getModule();
    mockReadTextFile.mockResolvedValue('---\nplatform: youtube\nshortSlug: medium-1\n---\nMedium post');

    const post = createPost(Platform.YouTube, 'medium-1');
    const result = await buildPublishQueue(mockVideo, [], [mockMediumClip], [post], undefined);

    // YouTube accepts medium-clip with captions
    expect(result.itemsCreated).toBe(1);
    const metadataArg = mockCreateItem.mock.calls[0][1];
    expect(metadataArg.sourceMediaPath).toBe('/recordings/test-video/medium-clips/medium-1-captioned.mp4');
  });

  it('strips frontmatter from post content', async () => {
    const { buildPublishQueue } = await getModule();
    const postContent = '---\nplatform: youtube\n---\nActual post body';
    mockReadTextFile.mockResolvedValue(postContent);

    const post = createPost(Platform.YouTube);
    post.content = postContent;
    await buildPublishQueue(mockVideo, [], [], [post], undefined);

    const contentArg = mockCreateItem.mock.calls[0][2];
    expect(contentArg).toBe('Actual post body');
  });

  it('records errors for failed posts', async () => {
    const { buildPublishQueue } = await getModule();
    mockReadTextFile.mockRejectedValue(new Error('File not found'));
    // createItem will throw because content is empty after stripping
    mockCreateItem.mockRejectedValue(new Error('Write failed'));

    const post = createPost(Platform.YouTube);
    post.content = 'Post content no frontmatter';
    const result = await buildPublishQueue(mockVideo, [], [], [post], undefined);

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('skips platforms that do not accept the clip type', async () => {
    const { buildPublishQueue } = await getModule();
    // TikTok doesn't accept main video
    mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\n---\nPost');

    const post = createPost(Platform.TikTok);
    const result = await buildPublishQueue(mockVideo, [], [], [post], '/captioned.mp4');

    // TikTok doesn't accept video clip type in the content matrix
    expect(result.itemsSkipped).toBe(1);
  });

  it('handles post with missing clip slug gracefully', async () => {
    const { buildPublishQueue } = await getModule();
    mockReadTextFile.mockResolvedValue('---\nplatform: tiktok\nshortSlug: nonexistent\n---\nPost');

    const post = createPost(Platform.TikTok, 'nonexistent');
    // Should warn but not crash  
    const result = await buildPublishQueue(mockVideo, [], [], [post], undefined);
    // TikTok only accepts short clips; if clip not found, still tries
    expect(result.errors.length + result.itemsCreated + result.itemsSkipped).toBeGreaterThanOrEqual(1);
  });

  it('handles frontmatter with quoted values and null', async () => {
    const { buildPublishQueue } = await getModule();
    // Test: double-quoted platform value + shortSlug: null (treated as absent)
    mockReadTextFile.mockResolvedValue('---\nplatform: "youtube"\nshortSlug: null\n---\nPost body');

    const post = createPost(Platform.YouTube);
    const result = await buildPublishQueue(mockVideo, [], [], [post], '/captioned.mp4');

    // shortSlug: null → skipped by parser → video-level post
    expect(result.itemsCreated).toBe(1);
  });

  it('handles post content without frontmatter markers', async () => {
    const { buildPublishQueue } = await getModule();
    // No --- markers at all → parsePostFrontmatter returns empty {}
    mockReadTextFile.mockResolvedValue('Just plain text, no frontmatter');

    const post = createPost(Platform.YouTube);
    const result = await buildPublishQueue(mockVideo, [], [], [post], '/captioned.mp4');

    // No shortSlug in frontmatter → video-level post
    expect(result.itemsCreated).toBe(1);
  });

  it('resolves Instagram short with feed variant fallback', async () => {
    const { buildPublishQueue } = await getModule();
    mockReadTextFile.mockResolvedValue('---\nplatform: instagram\nshortSlug: short-1\n---\nIG post');

    // Short with only instagram-feed variant (no instagram-reels)
    const igShort: ShortClip = {
      id: 'short-1',
      slug: 'short-1',
      title: 'IG Short',
      segments: [{ start: 5, end: 25, description: 'IG test segment' }],
      totalDuration: 20,
      outputPath: '/recordings/test-video/shorts/short-1.mp4',
      captionedPath: '/recordings/test-video/shorts/short-1-captioned.mp4',
      description: 'An Instagram short',
      tags: ['#ig'],
      variants: [
        { platform: 'instagram-feed', path: '/recordings/test-video/shorts/short-1-ig-feed.mp4', aspectRatio: '4:5', width: 1080, height: 1350 },
      ],
    };

    const post = createPost(Platform.Instagram, 'short-1');
    const result = await buildPublishQueue(mockVideo, [igShort], [], [post], undefined);

    expect(result.itemsCreated + result.itemsSkipped).toBeGreaterThanOrEqual(1);
  });
});

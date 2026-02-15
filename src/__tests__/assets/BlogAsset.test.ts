import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BlogAsset } from '../../assets/BlogAsset.js';
import type { MainVideoAsset } from '../../assets/MainVideoAsset.js';

// Mock fileSystem
const mockFileExists = vi.hoisted(() => vi.fn());
const mockReadTextFile = vi.hoisted(() => vi.fn());
vi.mock('../../core/fileSystem.js', () => ({
  fileExists: mockFileExists,
  readTextFile: mockReadTextFile,
  writeTextFile: vi.fn(),
}));

describe('BlogAsset', () => {
  let asset: BlogAsset;
  const mockParent = {
    videoDir: '/recordings/test-video',
  } as MainVideoAsset;

  beforeEach(() => {
    vi.clearAllMocks();
    asset = new BlogAsset(mockParent);
  });

  it('sets filePath relative to parent videoDir', () => {
    expect(asset.filePath).toContain('test-video');
    expect(asset.filePath).toContain('blog-post.md');
  });

  describe('getFrontmatter()', () => {
    it('parses valid frontmatter', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        '---\ntitle: "My Blog Post"\ndescription: "A great post"\ntags: dev, tutorial\npublished: true\ndate: 2025-01-01\n---\n\n# Content here',
      );

      const fm = await asset.getFrontmatter();
      expect(fm).toEqual({
        title: 'My Blog Post',
        description: 'A great post',
        tags: ['dev', 'tutorial'],
        published: true,
        date: '2025-01-01',
      });
    });

    it('returns null when file does not exist', async () => {
      mockFileExists.mockResolvedValue(false);

      const fm = await asset.getFrontmatter();
      expect(fm).toBeNull();
    });

    it('returns null when content has no frontmatter', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('# Just a regular markdown file');

      const fm = await asset.getFrontmatter();
      expect(fm).toBeNull();
    });

    it('returns null when frontmatter is missing closing delimiter', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('---\ntitle: "Test"\n\nNo closing delimiter');

      const fm = await asset.getFrontmatter();
      expect(fm).toBeNull();
    });

    it('returns null when frontmatter is empty', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('---\n---\nContent');

      const fm = await asset.getFrontmatter();
      expect(fm).toBeNull();
    });

    it('returns null when required fields are missing', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        '---\ntags: dev\npublished: false\n---\nContent',
      );

      const fm = await asset.getFrontmatter();
      expect(fm).toBeNull();
    });

    it('handles single-quoted values', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        "---\ntitle: 'Single Quoted'\ndescription: 'Also quoted'\n---\nContent",
      );

      const fm = await asset.getFrontmatter();
      expect(fm!.title).toBe('Single Quoted');
      expect(fm!.description).toBe('Also quoted');
    });

    it('handles unquoted values', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        '---\ntitle: Unquoted Title\ndescription: No quotes here\n---\nContent',
      );

      const fm = await asset.getFrontmatter();
      expect(fm!.title).toBe('Unquoted Title');
      expect(fm!.description).toBe('No quotes here');
    });

    it('defaults published to false', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        '---\ntitle: Test\ndescription: Desc\n---\nContent',
      );

      const fm = await asset.getFrontmatter();
      expect(fm!.published).toBe(false);
    });

    it('defaults tags to empty array', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue(
        '---\ntitle: Test\ndescription: Desc\n---\nContent',
      );

      const fm = await asset.getFrontmatter();
      expect(fm!.tags).toEqual([]);
    });
  });

  describe('getResult()', () => {
    it('loads content from disk', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('# Blog Post Content');

      const result = await asset.getResult();
      expect(result).toBe('# Blog Post Content');
    });

    it('caches and returns cached content on subsequent calls', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('# Blog Post Content');

      await asset.getResult();
      const result = await asset.getResult();
      expect(result).toBe('# Blog Post Content');
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it('throws when blog post does not exist', async () => {
      mockFileExists.mockResolvedValue(false);

      await expect(asset.getResult()).rejects.toThrow('Blog post not found');
    });

    it('reloads when force option is set', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValueOnce('Original content');
      mockReadTextFile.mockResolvedValueOnce('Updated content');

      await asset.getResult();
      const result = await asset.getResult({ force: true });
      expect(result).toBe('Updated content');
      expect(mockReadTextFile).toHaveBeenCalledTimes(2);
    });
  });
});

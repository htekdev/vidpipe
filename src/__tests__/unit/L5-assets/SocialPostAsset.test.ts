import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocialPostAsset } from '../../../L5-assets/SocialPostAsset.js';
import type { VideoAsset } from '../../../L5-assets/VideoAsset.js';
import { Platform } from '../../../L0-pure/types/index.js';

// Mock fileSystem
const mockFileExists = vi.hoisted(() => vi.fn());
const mockReadTextFile = vi.hoisted(() => vi.fn());
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  readTextFile: mockReadTextFile,
  writeTextFile: vi.fn(),
}));

describe('SocialPostAsset', () => {
  const mockParent = {} as VideoAsset;
  let asset: SocialPostAsset;

  beforeEach(() => {
    vi.clearAllMocks();
    asset = new SocialPostAsset(mockParent, Platform.TikTok, '/posts');
  });

  it('sets the platform', () => {
    expect(asset.platform).toBe('tiktok');
  });

  it('builds the file path from platform', () => {
    expect(asset.filePath).toContain('tiktok.md');
  });

  describe('getResult()', () => {
    it('loads content from disk when file exists', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('Post content');

      const result = await asset.getResult();
      expect(result).toBe('Post content');
    });

    it('throws when file does not exist', async () => {
      mockFileExists.mockResolvedValue(false);

      await expect(asset.getResult()).rejects.toThrow('Social post not found');
    });

    it('caches content on subsequent calls', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('Cached content');

      await asset.getResult();
      await asset.getResult();
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });

    it('reloads when force is set', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValueOnce('Original');
      mockReadTextFile.mockResolvedValueOnce('Updated');

      await asset.getResult();
      const result = await asset.getResult({ force: true });
      expect(result).toBe('Updated');
    });
  });
});

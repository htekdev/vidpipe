import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SummaryAsset } from '../../assets/SummaryAsset.js';
import type { MainVideoAsset } from '../../assets/MainVideoAsset.js';

// Mock fileSystem
const mockFileExists = vi.hoisted(() => vi.fn());
const mockReadTextFile = vi.hoisted(() => vi.fn());
vi.mock('../../core/fileSystem.js', () => ({
  fileExists: mockFileExists,
  readTextFile: mockReadTextFile,
  writeTextFile: vi.fn(),
}));

// Mock loaders so we don't need real agents
vi.mock('../../assets/loaders.js', () => ({
  loadSummaryAgent: vi.fn(),
}));

describe('SummaryAsset', () => {
  const mockParent = {
    videoDir: '/recordings/my-video',
  } as MainVideoAsset;

  let asset: SummaryAsset;

  beforeEach(() => {
    vi.clearAllMocks();
    asset = new SummaryAsset(mockParent);
  });

  it('sets filePath to README.md in parent videoDir', () => {
    expect(asset.filePath).toContain('my-video');
    expect(asset.filePath).toContain('README.md');
  });

  describe('getResult()', () => {
    it('loads content from disk when it exists', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('# Video Summary');

      const result = await asset.getResult();
      expect(result).toBe('# Video Summary');
    });

    it('caches content on subsequent calls', async () => {
      mockFileExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('# Video Summary');

      await asset.getResult();
      await asset.getResult();
      // Should use cache (cached() in Asset)
      expect(mockReadTextFile).toHaveBeenCalledTimes(1);
    });
  });
});

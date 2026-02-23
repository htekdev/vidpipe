/**
 * Unit tests for the base Asset class.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Asset, AssetOptions } from '../../../L5-assets/Asset.js'

// Hoist mock variables so they're available before vi.mock runs
const { mockFileExists, mockWriteTextFile, mockRemoveFile } = vi.hoisted(() => ({
  mockFileExists: vi.fn(),
  mockWriteTextFile: vi.fn(),
  mockRemoveFile: vi.fn(),
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  writeTextFile: mockWriteTextFile,
  removeFile: mockRemoveFile,
}))

/**
 * Concrete implementation of Asset for testing.
 * Follows the idempotent completion marker pattern.
 */
class TestAsset extends Asset<string> {
  private _exists: boolean
  private generateCount = 0
  private _completionMarkerPath: string

  constructor(exists: boolean, result: string, completionMarkerPath = '/test/asset.complete') {
    super()
    this._exists = exists
    this._result = result
    this._completionMarkerPath = completionMarkerPath
  }

  getCompletionMarkerPath(): string {
    return this._completionMarkerPath
  }

  async exists(): Promise<boolean> {
    return this._exists
  }

  async getResult(opts?: AssetOptions): Promise<string> {
    if (opts?.force) {
      await this.clearCompletion()
    }
    if (await this.isComplete()) {
      return this._result!
    }
    this.generateCount++
    await this.markComplete()
    return this._result!
  }

  getGenerateCount(): number {
    return this.generateCount
  }

  setExists(exists: boolean): void {
    this._exists = exists
  }

  // Expose protected methods for testing
  async testCached<V>(key: string, fn: () => Promise<V>): Promise<V> {
    return this.cached(key, fn)
  }

  async testMarkComplete(): Promise<void> {
    return this.markComplete()
  }

  async testClearCompletion(): Promise<void> {
    return this.clearCompletion()
  }
}

describe('Asset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('exists()', () => {
    it('returns true when asset exists', async () => {
      const asset = new TestAsset(true, 'test-result')
      expect(await asset.exists()).toBe(true)
    })

    it('returns false when asset does not exist', async () => {
      const asset = new TestAsset(false, 'test-result')
      expect(await asset.exists()).toBe(false)
    })
  })

  describe('completion marker pattern', () => {
    describe('isComplete()', () => {
      it('returns true when marker file exists', async () => {
        mockFileExists.mockResolvedValue(true)
        const asset = new TestAsset(true, 'test-result')
        
        expect(await asset.isComplete()).toBe(true)
        expect(mockFileExists).toHaveBeenCalledWith('/test/asset.complete')
      })

      it('returns false when marker file does not exist', async () => {
        mockFileExists.mockResolvedValue(false)
        const asset = new TestAsset(true, 'test-result')
        
        expect(await asset.isComplete()).toBe(false)
      })
    })

    describe('markComplete()', () => {
      it('writes timestamp to marker file', async () => {
        const asset = new TestAsset(true, 'test-result')
        
        await asset.testMarkComplete()
        
        expect(mockWriteTextFile).toHaveBeenCalledWith(
          '/test/asset.complete',
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)  // ISO timestamp
        )
      })
    })

    describe('clearCompletion()', () => {
      it('deletes marker file', async () => {
        const asset = new TestAsset(true, 'test-result')
        
        await asset.testClearCompletion()
        
        expect(mockRemoveFile).toHaveBeenCalledWith('/test/asset.complete')
      })
    })

    describe('getCompletionMarkerPath()', () => {
      it('returns configured completion marker path', () => {
        const asset = new TestAsset(true, 'result', '/custom/path.complete')
        expect(asset.getCompletionMarkerPath()).toBe('/custom/path.complete')
      })
    })
  })

  describe('idempotent getResult()', () => {
    it('returns cached result on second call (when complete)', async () => {
      // First call: not complete, generates
      mockFileExists.mockResolvedValueOnce(false)
      const asset = new TestAsset(true, 'my-result')
      
      await asset.getResult()
      expect(asset.getGenerateCount()).toBe(1)
      
      // Second call: complete marker exists (mocked)
      mockFileExists.mockResolvedValueOnce(true)
      await asset.getResult()
      expect(asset.getGenerateCount()).toBe(1)  // Still 1, not regenerated
    })

    it('skips generation when complete marker exists', async () => {
      mockFileExists.mockResolvedValue(true)  // Already complete
      const asset = new TestAsset(true, 'cached-result')
      
      const result = await asset.getResult()
      
      expect(result).toBe('cached-result')
      expect(asset.getGenerateCount()).toBe(0)  // Never called generate
    })

    it('force regenerates when { force: true } passed', async () => {
      // Already complete
      mockFileExists.mockResolvedValue(true)
      const asset = new TestAsset(true, 'test')
      expect(asset.getGenerateCount()).toBe(0)

      // Force bypasses completion check after clearing
      mockFileExists.mockResolvedValueOnce(false)  // After clear, isComplete returns false
      await asset.getResult({ force: true })
      
      expect(mockRemoveFile).toHaveBeenCalledWith('/test/asset.complete')
      expect(asset.getGenerateCount()).toBe(1)
    })

    it('generates and marks complete when marker missing', async () => {
      mockFileExists.mockResolvedValue(false)  // Not complete
      const asset = new TestAsset(true, 'generated-result')
      
      const result = await asset.getResult()
      
      expect(result).toBe('generated-result')
      expect(asset.getGenerateCount()).toBe(1)
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        '/test/asset.complete',
        expect.any(String)
      )
    })
  })

  describe('generate()', () => {
    it('calls getResult with force: true', async () => {
      mockFileExists.mockResolvedValue(false)  // After clear
      const asset = new TestAsset(true, 'generated')
      const result = await asset.generate()

      expect(result).toBe('generated')
      expect(asset.getGenerateCount()).toBe(1)
      expect(mockRemoveFile).toHaveBeenCalled()  // clearCompletion called
    })

    it('passes additional options through', async () => {
      mockFileExists.mockResolvedValue(false)
      const asset = new TestAsset(true, 'test')
      await asset.generate({ model: 'gpt-4' })
      expect(asset.getGenerateCount()).toBe(1)
    })
  })

  describe('cached()', () => {
    it('caches the result of a computation', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new TestAsset(true, 'test')
      let callCount = 0

      const fn = async () => {
        callCount++
        return 'computed-value'
      }

      const result1 = await asset.testCached('key1', fn)
      const result2 = await asset.testCached('key1', fn)

      expect(result1).toBe('computed-value')
      expect(result2).toBe('computed-value')
      expect(callCount).toBe(1)
    })

    it('uses different cache keys independently', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new TestAsset(true, 'test')
      let callCount = 0

      const fn = async () => {
        callCount++
        return `value-${callCount}`
      }

      const result1 = await asset.testCached('key1', fn)
      const result2 = await asset.testCached('key2', fn)

      expect(result1).toBe('value-1')
      expect(result2).toBe('value-2')
      expect(callCount).toBe(2)
    })
  })

  describe('clearCache()', () => {
    it('clears the in-memory cache', async () => {
      mockFileExists.mockResolvedValue(true)
      const asset = new TestAsset(true, 'test')
      let callCount = 0

      const fn = async () => {
        callCount++
        return 'computed'
      }

      await asset.testCached('key', fn)
      expect(callCount).toBe(1)

      asset.clearCache()

      await asset.testCached('key', fn)
      expect(callCount).toBe(2)
    })
  })
})

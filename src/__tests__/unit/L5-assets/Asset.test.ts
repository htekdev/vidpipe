/**
 * Unit tests for the base Asset class.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Asset, AssetOptions } from '../../../L5-assets/Asset.js'

/**
 * Concrete implementation of Asset for testing.
 */
class TestAsset extends Asset<string> {
  private _exists: boolean
  private generateCount = 0

  constructor(exists: boolean, result: string) {
    super()
    this._exists = exists
    this._result = result
  }

  async exists(): Promise<boolean> {
    return this._exists
  }

  async getResult(opts?: AssetOptions): Promise<string> {
    if (opts?.force || !this._exists) {
      this.generateCount++
    }
    return this._result!
  }

  getGenerateCount(): number {
    return this.generateCount
  }

  setExists(exists: boolean): void {
    this._exists = exists
  }

  // Expose cached method for testing
  async testCached<V>(key: string, fn: () => Promise<V>): Promise<V> {
    return this.cached(key, fn)
  }
}

describe('Asset', () => {
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

  describe('getResult()', () => {
    it('returns the result', async () => {
      const asset = new TestAsset(true, 'my-result')
      const result = await asset.getResult()
      expect(result).toBe('my-result')
    })

    it('increments generate count when force is true', async () => {
      const asset = new TestAsset(true, 'test')
      expect(asset.getGenerateCount()).toBe(0)

      await asset.getResult({ force: true })
      expect(asset.getGenerateCount()).toBe(1)

      await asset.getResult({ force: true })
      expect(asset.getGenerateCount()).toBe(2)
    })
  })

  describe('generate()', () => {
    it('calls getResult with force: true', async () => {
      const asset = new TestAsset(true, 'generated')
      const result = await asset.generate()

      expect(result).toBe('generated')
      expect(asset.getGenerateCount()).toBe(1)
    })

    it('passes additional options through', async () => {
      const asset = new TestAsset(true, 'test')
      await asset.generate({ model: 'gpt-4' })
      expect(asset.getGenerateCount()).toBe(1)
    })
  })

  describe('cached()', () => {
    it('caches the result of a computation', async () => {
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

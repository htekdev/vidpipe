import { describe, expect, it } from 'vitest'
import { getConfig, initConfig, withConfig } from '../../../L1-infra/config/environment.js'

describe('scoped environment', () => {
  it('environment.REQ-002: overlapping async descendants keep their complete configuration and restore fallback', async () => {
    const first = initConfig({
      storageProvider: 'aws', awsRegion: 'first-region', awsS3Bucket: 'first-bucket',
      awsS3Prefix: 'first-prefix', awsDynamodbContentTable: 'first-content',
      awsDynamodbVideosTable: 'first-videos', azureStorageAccountName: 'first-account',
      azureContainerName: 'first-container',
    })
    const second = initConfig({
      storageProvider: 'azure', awsRegion: 'second-region', awsS3Bucket: 'second-bucket',
      awsS3Prefix: 'second-prefix', awsDynamodbContentTable: 'second-content',
      awsDynamodbVideosTable: 'second-videos', azureStorageAccountName: 'second-account',
      azureContainerName: 'second-container',
    })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const running = withConfig(first, async () => {
      expect(getConfig()).toBe(first)
      await gate
      expect(getConfig()).toBe(first)
      await Promise.resolve()
      expect(getConfig()).toBe(first)
    })
    try {
      await withConfig(second, async () => {
        await Promise.resolve()
        expect(getConfig()).toBe(second)
      })
      expect(getConfig()).toBe(second)
    } finally {
      release()
    }
    await running
    expect(getConfig()).toBe(second)
  })

  it('environment.REQ-002: nested scopes restore the parent after rejection and synchronous throw', async () => {
    const outer = initConfig({ storageProvider: 'aws', awsS3Bucket: 'outer' })
    const inner = initConfig({ storageProvider: 'azure' })
    await withConfig(outer, async () => {
      await expect(withConfig(inner, async () => {
        await Promise.resolve()
        expect(getConfig()).toBe(inner)
        throw new Error('async failure')
      })).rejects.toThrow('async failure')
      expect(getConfig()).toBe(outer)
      expect(() => withConfig(inner, () => { throw new Error('sync failure') })).toThrow('sync failure')
      expect(getConfig()).toBe(outer)
      expect(withConfig(inner, () => getConfig())).toBe(inner)
    })
    expect(getConfig()).toBe(inner)
  })
})

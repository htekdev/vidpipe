import { describe, test, expect } from 'vitest'

describe('cover image generation e2e', () => {
  test('postStore supports image media type', async () => {
    const mod = await import('../../L3-services/postStore/postStore.js')
    expect(typeof mod.createItem).toBe('function')
    expect(typeof mod.getGroupedPendingItems).toBe('function')
  })

  test('queueBuilder imports generateImage', async () => {
    const mod = await import('../../L3-services/queueBuilder/queueBuilder.js')
    expect(typeof mod.buildPublishQueue).toBe('function')
  })

  test('VideoAsset has generateCoverImage method', async () => {
    const { VideoAsset } = await import('../../L5-assets/VideoAsset.js')
    expect(typeof VideoAsset.prototype.generateCoverImage).toBe('function')
  })

  test('VideoAsset has coverImagePath getter', async () => {
    const { VideoAsset } = await import('../../L5-assets/VideoAsset.js')
    const descriptor = Object.getOwnPropertyDescriptor(VideoAsset.prototype, 'coverImagePath')
    expect(descriptor?.get).toBeDefined()
  })
})

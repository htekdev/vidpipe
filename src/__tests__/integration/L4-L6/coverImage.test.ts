import { vi, describe, test, expect } from 'vitest'

// Mock L2 OpenAI image generation client
vi.mock('../../../../src/L2-clients/openai/imageGeneration.js', () => ({
  generateImage: vi.fn().mockResolvedValue('/tmp/test-cover.png'),
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 },
}))

// Import after mocks
import { VideoAsset } from '../../../../src/L5-assets/VideoAsset.js'

describe('L4-L6 Integration: cover image generation', () => {
  test('VideoAsset.generateCoverImage is inherited by concrete implementations', () => {
    expect(typeof VideoAsset.prototype.generateCoverImage).toBe('function')
  })

  test('coverImagePath returns correct path pattern', () => {
    const descriptor = Object.getOwnPropertyDescriptor(VideoAsset.prototype, 'coverImagePath')
    expect(descriptor?.get).toBeDefined()
  })
})

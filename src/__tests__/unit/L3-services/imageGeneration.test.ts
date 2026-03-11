import { describe, it, expect, vi, beforeEach } from 'vitest'

// L3 tests can ONLY mock L2 layer
const mockL2GenerateImage = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/openai/imageGeneration.js', () => ({
  generateImage: mockL2GenerateImage,
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 },
}))

import { generateImage, COST_BY_QUALITY } from '../../../L3-services/imageGeneration/imageGeneration.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'

describe('L3 imageGeneration service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    costTracker.reset()
  })

  it('delegates to L2 generateImage and returns the result', async () => {
    mockL2GenerateImage.mockResolvedValue('/output/image.png')

    const result = await generateImage('a flowchart', '/output/image.png')
    expect(result).toBe('/output/image.png')
    expect(mockL2GenerateImage).toHaveBeenCalledWith('a flowchart', '/output/image.png', undefined)
  })

  it('passes options through to L2', async () => {
    mockL2GenerateImage.mockResolvedValue('/out/img.png')

    await generateImage('test', '/out/img.png', { size: 'auto', quality: 'low', style: 'minimal' })
    expect(mockL2GenerateImage).toHaveBeenCalledWith('test', '/out/img.png', {
      size: 'auto',
      quality: 'low',
      style: 'minimal',
    })
  })

  it('records cost with costTracker using high quality by default', async () => {
    mockL2GenerateImage.mockResolvedValue('/out/img.png')
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')

    await generateImage('prompt text here', '/out/img.png')
    expect(spy).toHaveBeenCalledWith('openai-image', 0.07, expect.objectContaining({
      model: 'gpt-image-1.5',
      quality: 'high',
    }))
  })

  it('records cost with specified quality', async () => {
    mockL2GenerateImage.mockResolvedValue('/out/img.png')
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')

    await generateImage('prompt', '/out/img.png', { quality: 'low' })
    expect(spy).toHaveBeenCalledWith('openai-image', 0.04, expect.objectContaining({
      quality: 'low',
    }))
  })

  it('records cost with specified size', async () => {
    mockL2GenerateImage.mockResolvedValue('/out/img.png')
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')

    await generateImage('prompt', '/out/img.png', { size: '1024x1024' })
    expect(spy).toHaveBeenCalledWith('openai-image', 0.07, expect.objectContaining({
      size: '1024x1024',
    }))
  })

  it('truncates long prompts in metadata to 200 chars', async () => {
    mockL2GenerateImage.mockResolvedValue('/out/img.png')
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')
    const longPrompt = 'A'.repeat(300)

    await generateImage(longPrompt, '/out/img.png')
    expect(spy).toHaveBeenCalledWith('openai-image', 0.07, expect.objectContaining({
      prompt: 'A'.repeat(200),
    }))
  })

  it('exports COST_BY_QUALITY constants', () => {
    expect(COST_BY_QUALITY).toEqual({ low: 0.04, medium: 0.07, high: 0.07 })
  })

  it('propagates L2 errors', async () => {
    mockL2GenerateImage.mockRejectedValue(new Error('API error'))
    await expect(generateImage('test', '/out/img.png')).rejects.toThrow('API error')
  })
})

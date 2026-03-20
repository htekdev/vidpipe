/**
 * L4 Unit Test — applyIntroOutro bridge in videoServiceBridge
 *
 * Mocks: L3 intro/outro service only.
 * Tests that the L4 bridge delegates to the L3 service with correct arguments.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockApplyIntroOutro = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/introOutro/introOutroService.js', () => ({
  applyIntroOutro: mockApplyIntroOutro,
}))

import { applyIntroOutro } from '../../../L4-agents/videoServiceBridge.js'

describe('L4 Unit: videoServiceBridge applyIntroOutro', () => {
  afterEach(() => vi.clearAllMocks())

  it('delegates to L3 introOutroService with all arguments', async () => {
    mockApplyIntroOutro.mockResolvedValue('/output-intro-outro.mp4')

    const result = await applyIntroOutro(
      '/video.mp4', 'main', '/out.mp4', 'youtube', '16:9',
    )

    expect(result).toBe('/output-intro-outro.mp4')
    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/video.mp4', 'main', '/out.mp4', 'youtube', '16:9',
    )
  })

  it('passes undefined for optional platform and aspectRatio', async () => {
    mockApplyIntroOutro.mockResolvedValue('/out.mp4')

    await applyIntroOutro('/video.mp4', 'shorts', '/out.mp4')

    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/video.mp4', 'shorts', '/out.mp4', undefined, undefined,
    )
  })

  it('passes platform without aspectRatio', async () => {
    mockApplyIntroOutro.mockResolvedValue('/out.mp4')

    await applyIntroOutro('/video.mp4', 'medium-clips', '/out.mp4', 'tiktok')

    expect(mockApplyIntroOutro).toHaveBeenCalledWith(
      '/video.mp4', 'medium-clips', '/out.mp4', 'tiktok', undefined,
    )
  })
})

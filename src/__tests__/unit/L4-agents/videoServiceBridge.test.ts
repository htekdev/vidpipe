/**
 * L4 Unit Test — videoServiceBridge wrappers
 *
 * Mocks: L3 video operations service only.
 * Tests that the bridge module wraps the L3 function and delegates calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockTranscodeToMp4 = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  transcodeToMp4: mockTranscodeToMp4,
}))

import { transcodeToMp4 } from '../../../L4-agents/videoServiceBridge.js'
import { resolvePortraitCaptionStyle, mapVariantResults, buildPortraitCaptionASS } from '../../../L4-agents/ShortsAgent.js'

describe('L4 Unit: videoServiceBridge wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('transcodeToMp4 delegates to L3', async () => {
    mockTranscodeToMp4.mockResolvedValue('/output.mp4')

    const result = await transcodeToMp4('/input.webm', '/output.mp4')

    expect(result).toBe('/output.mp4')
    expect(mockTranscodeToMp4).toHaveBeenCalledWith('/input.webm', '/output.mp4')
  })

  it('resolvePortraitCaptionStyle returns portrait for split-screen, portrait-lower otherwise', () => {
    expect(resolvePortraitCaptionStyle(true)).toBe('portrait')
    expect(resolvePortraitCaptionStyle(false)).toBe('portrait-lower')
    expect(resolvePortraitCaptionStyle(undefined)).toBe('portrait-lower')
  })

  it('mapVariantResults preserves isSplitScreen flag', () => {
    const results = [
      { path: '/a.mp4', aspectRatio: '9:16', platform: 'tiktok', width: 1080, height: 1920, isSplitScreen: true },
      { path: '/b.mp4', aspectRatio: '4:5', platform: 'instagram-feed', width: 1080, height: 1350, isSplitScreen: false },
    ]
    const variants = mapVariantResults(results)
    expect(variants).toHaveLength(2)
    expect(variants[0].isSplitScreen).toBe(true)
    expect(variants[1].isSplitScreen).toBe(false)
  })

  it('buildPortraitCaptionASS uses lower-third when not split-screen', () => {
    const transcript = { text: 'hello', duration: 2, language: 'en', segments: [{ id: 0, text: 'hello', start: 0, end: 1, words: [] }], words: [{ word: 'hello', start: 0, end: 1 }] }
    const segments = [{ start: 0, end: 1 }]
    const result = buildPortraitCaptionASS(transcript, segments, 'Hook', false)
    expect(result).toContain('280') // lower-third MarginV
    expect(result).not.toContain('770')
  })

  it('buildPortraitCaptionASS uses middle when split-screen', () => {
    const transcript = { text: 'hello', duration: 2, language: 'en', segments: [{ id: 0, text: 'hello', start: 0, end: 1, words: [] }], words: [{ word: 'hello', start: 0, end: 1 }] }
    const segments = [{ start: 0, end: 1 }]
    const result = buildPortraitCaptionASS(transcript, segments, 'Hook', true)
    expect(result).toContain('770') // split-screen MarginV
  })
})

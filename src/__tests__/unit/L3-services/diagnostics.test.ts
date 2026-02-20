/**
 * L3 Unit Test — diagnostics service wrapper functions
 *
 * Mock boundary: L2 (ffmpeg path resolver)
 * Verifies that L3 wrappers delegate to L2 correctly.
 */
import { vi, describe, test, expect } from 'vitest'

const mockGetFFmpegPath = vi.hoisted(() => vi.fn().mockReturnValue('/usr/bin/ffmpeg'))
const mockGetFFprobePath = vi.hoisted(() => vi.fn().mockReturnValue('/usr/bin/ffprobe'))

vi.mock('../../../../src/L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: mockGetFFmpegPath,
  getFFprobePath: mockGetFFprobePath,
}))

import { getFFmpegPath, getFFprobePath } from '../../../../src/L3-services/diagnostics/diagnostics.js'

describe('L3 diagnostics wrapper functions', () => {
  test('getFFmpegPath delegates to L2', () => {
    const result = getFFmpegPath()
    expect(result).toBe('/usr/bin/ffmpeg')
    expect(mockGetFFmpegPath).toHaveBeenCalledOnce()
  })

  test('getFFprobePath delegates to L2', () => {
    const result = getFFprobePath()
    expect(result).toBe('/usr/bin/ffprobe')
    expect(mockGetFFprobePath).toHaveBeenCalledOnce()
  })
})

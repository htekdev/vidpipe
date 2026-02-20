/**
 * L3 Integration Test — diagnostics service → L2 ffmpeg path resolution
 *
 * Mock boundary: L1 (config, filesystem)
 * Real code:     L2 ffmpeg path resolver + L3 diagnostics wrapper
 *
 * Verifies the L3→L2 wrapper chain resolves FFmpeg paths correctly.
 */
import { vi, describe, test, expect } from 'vitest'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    FFMPEG_PATH: '/custom/ffmpeg',
    FFPROBE_PATH: '/custom/ffprobe',
  }),
  initConfig: vi.fn(),
}))

import { getFFmpegPath, getFFprobePath } from '../../../L3-services/diagnostics/diagnostics.js'

describe('L3 Integration: diagnostics → L2 ffmpeg', () => {
  test('getFFmpegPath returns configured path through wrapper chain', () => {
    const result = getFFmpegPath()
    expect(result).toBe('/custom/ffmpeg')
  })

  test('getFFprobePath returns configured path through wrapper chain', () => {
    const result = getFFprobePath()
    expect(result).toBe('/custom/ffprobe')
  })
})

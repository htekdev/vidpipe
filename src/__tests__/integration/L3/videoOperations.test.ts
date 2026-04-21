/**
 * L3 Integration Test — videoOperations → L2 FFmpeg chain
 *
 * Mock boundary: L1 (config, logger)
 * Real code:     L2 FFmpeg wrappers, L3 videoOperations
 *
 * Validates that L3 wrapper functions correctly delegate to real L2 modules.
 * Only tests sync functions since async FFmpeg calls need real binaries.
 */
import { describe, test, expect } from 'vitest'
import { getFFmpegPath, getFFprobePath, transcodeToMp4 } from '../../../L3-services/videoOperations/videoOperations.js'

describe('L3 Integration: videoOperations → L2 FFmpeg chain', () => {
  test('getFFmpegPath returns a string path', () => {
    const path = getFFmpegPath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })

  test('getFFprobePath returns a string path', () => {
    const path = getFFprobePath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })

  test('transcodeToMp4 is exported from L3 videoOperations', () => {
    expect(typeof transcodeToMp4).toBe('function')
  })

  test('transcodeToMp4 rejects for non-existent input file', async () => {
    await expect(transcodeToMp4('/nonexistent/video.webm', '/tmp/out.mp4'))
      .rejects.toThrow()
  })
})

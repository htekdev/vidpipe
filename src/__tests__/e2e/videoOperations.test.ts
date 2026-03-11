/**
 * E2E Test — videoOperations wrapper functions delegate to real L2 FFmpeg
 *
 * No mocking — verifies that L3 videoOperations wrappers correctly
 * delegate to real L2 FFmpeg modules for sync operations.
 */
import { describe, test, expect } from 'vitest'
import { getFFmpegPath, getFFprobePath } from '../../L3-services/videoOperations/videoOperations.js'

describe('E2E: videoOperations wrappers', () => {
  test('getFFmpegPath returns valid path through L3 wrapper', () => {
    const path = getFFmpegPath()
    expect(typeof path).toBe('string')
    expect(path).toMatch(/ffmpeg/i)
  })

  test('getFFprobePath returns valid path through L3 wrapper', () => {
    const path = getFFprobePath()
    expect(typeof path).toBe('string')
    expect(path).toMatch(/ffprobe/i)
  })
})

/**
 * E2E Test — diagnostics service returns valid FFmpeg paths
 *
 * No mocking — verifies real path resolution through L3→L2 wrapper chain.
 */
import { describe, test, expect } from 'vitest'
import { getFFmpegPath, getFFprobePath } from '../../L3-services/diagnostics/diagnostics.js'

describe('E2E: diagnostics FFmpeg path resolution', () => {
  test('getFFmpegPath returns a non-empty string', () => {
    const path = getFFmpegPath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })

  test('getFFprobePath returns a non-empty string', () => {
    const path = getFFprobePath()
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })
})

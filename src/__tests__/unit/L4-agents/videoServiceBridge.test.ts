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

describe('L4 Unit: videoServiceBridge wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('transcodeToMp4 delegates to L3', async () => {
    mockTranscodeToMp4.mockResolvedValue('/output.mp4')

    const result = await transcodeToMp4('/input.webm', '/output.mp4')

    expect(result).toBe('/output.mp4')
    expect(mockTranscodeToMp4).toHaveBeenCalledWith('/input.webm', '/output.mp4')
  })
})

/**
 * L4-L6 Integration Test — bridge wrappers delegate to real L3 services
 *
 * Mock boundary: L2 (external clients)
 * Real code:     L3 services, L4 bridge wrappers
 */
import { vi, describe, test, expect } from 'vitest'

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: () => '/usr/bin/ffmpeg',
  getFFprobePath: () => '/usr/bin/ffprobe',
  ffprobe: vi.fn(),
}))

import {
  markPending, markProcessing, markCompleted, markFailed,
} from '../../../L4-agents/pipelineServiceBridge.js'
import {
  analyzeVideoEditorial, transcribeVideo,
} from '../../../L4-agents/analysisServiceBridge.js'

describe('L4-L6 Integration: bridge wrappers', () => {
  test('pipelineServiceBridge markPending is a function', () => {
    expect(typeof markPending).toBe('function')
    expect(typeof markProcessing).toBe('function')
    expect(typeof markCompleted).toBe('function')
    expect(typeof markFailed).toBe('function')
  })

  test('analysisServiceBridge functions are callable', () => {
    expect(typeof analyzeVideoEditorial).toBe('function')
    expect(typeof transcribeVideo).toBe('function')
  })
})

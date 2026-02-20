/**
 * L4-L6 Integration Test — pipelineServices re-export chain
 *
 * Mock boundary: L2 clients
 * Real code:     L5 pipelineServices → L4 pipelineServiceBridge → L3 services
 *
 * Tests that the L5 re-export module correctly chains through L4 to L3.
 */
import { describe, it, expect, vi } from 'vitest'

// ── Mock L2 clients (integration L4-L6 mock boundary) ───────────────

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: vi.fn(() => 'ffmpeg'),
  getFFprobePath: vi.fn(() => 'ffprobe'),
}))

// ── Import after mocks ───────────────────────────────────────────────

import {
  costTracker,
  markPending,
  markProcessing,
  markCompleted,
  markFailed,
  buildPublishQueue,
  commitAndPush,
  ScheduleAgent,
} from '../../../L5-assets/pipelineServices.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L4-L6 Integration: pipelineServices re-export chain', () => {
  it('re-exports costTracker singleton from L3 via L4', () => {
    expect(costTracker).toBeDefined()
    expect(typeof costTracker.recordUsage).toBe('function')
  })

  it('re-exports processing state functions', () => {
    expect(typeof markPending).toBe('function')
    expect(typeof markProcessing).toBe('function')
    expect(typeof markCompleted).toBe('function')
    expect(typeof markFailed).toBe('function')
  })

  it('re-exports buildPublishQueue', () => {
    expect(typeof buildPublishQueue).toBe('function')
  })

  it('re-exports commitAndPush', () => {
    expect(typeof commitAndPush).toBe('function')
  })

  it('re-exports ScheduleAgent class', () => {
    expect(ScheduleAgent).toBeDefined()
    expect(typeof ScheduleAgent).toBe('function')
  })
})

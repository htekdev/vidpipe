/**
 * L4-L6 Integration Test — videoAnalysis service chain
 *
 * Mock boundary: L2 clients (Gemini API)
 * Real code:     L3 videoAnalysis + L3 costTracker
 *
 * Tests that the L3 videoAnalysis service correctly wraps L2 Gemini
 * calls and records costs. The L2 Gemini client is mocked; the L3
 * business logic (cost tracking, error handling) runs real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock L2 Gemini client ─────────────────────────────────────────────

vi.mock('../../../L2-clients/gemini/geminiClient.js', () => ({
  analyzeVideoEditorial: vi.fn(async () => 'Cut from 10s to 15s — dead air'),
  analyzeVideoClipDirection: vi.fn(async () => 'Short 1: 0:00-0:30 — exciting intro'),
  analyzeVideoForEnhancements: vi.fn(async () => 'Add zoom at 5s, B-roll at 20s'),
}))

// ── Import after mocks ───────────────────────────────────────────────

import {
  analyzeVideoEditorial,
  analyzeVideoClipDirection,
  analyzeVideoForEnhancements,
} from '../../../L3-services/videoAnalysis/videoAnalysis.js'

import {
  analyzeVideoEditorial as mockEditorial,
  analyzeVideoClipDirection as mockClipDirection,
  analyzeVideoForEnhancements as mockEnhancements,
} from '../../../L2-clients/gemini/geminiClient.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L4-L6 Integration: videoAnalysis → Gemini (mocked L2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('analyzeVideoEditorial passes through to L2 and returns result', async () => {
    const result = await analyzeVideoEditorial('/video.mp4', 120)

    expect(mockEditorial).toHaveBeenCalledWith('/video.mp4', 120, undefined)
    expect(result).toContain('dead air')
  })

  it('analyzeVideoClipDirection passes through to L2 and returns result', async () => {
    const result = await analyzeVideoClipDirection('/video.mp4', 60)

    expect(mockClipDirection).toHaveBeenCalledWith('/video.mp4', 60, undefined)
    expect(result).toContain('exciting intro')
  })

  it('analyzeVideoForEnhancements passes through with transcript', async () => {
    const result = await analyzeVideoForEnhancements('/video.mp4', 90, 'some transcript text')

    expect(mockEnhancements).toHaveBeenCalledWith('/video.mp4', 90, 'some transcript text', undefined)
    expect(result).toContain('B-roll')
  })

  it('forwards custom model parameter to L2', async () => {
    await analyzeVideoEditorial('/video.mp4', 120, 'gemini-2.0-flash')

    expect(mockEditorial).toHaveBeenCalledWith('/video.mp4', 120, 'gemini-2.0-flash')
  })
})

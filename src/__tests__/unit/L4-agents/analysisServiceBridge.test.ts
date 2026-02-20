/**
 * L4 Unit Test — analysisServiceBridge re-exports
 *
 * Mocks: L3 services only (imageGeneration, videoAnalysis, transcription, captionGeneration)
 * Tests that the bridge module re-exports the expected functions from L3.
 */
import { describe, it, expect, vi } from 'vitest'

// ── Mock L3 services ────────────────────────────────────────────────

vi.mock('../../../L3-services/imageGeneration/imageGeneration.js', () => ({
  generateImage: vi.fn(),
}))

vi.mock('../../../L3-services/videoAnalysis/videoAnalysis.js', () => ({
  analyzeVideoEditorial: vi.fn(),
  analyzeVideoClipDirection: vi.fn(),
  analyzeVideoForEnhancements: vi.fn(),
}))

vi.mock('../../../L3-services/transcription/transcription.js', () => ({
  transcribeVideo: vi.fn(),
}))

vi.mock('../../../L3-services/captionGeneration/captionGeneration.js', () => ({
  generateCaptions: vi.fn(),
}))

// ── Import after mocks ──────────────────────────────────────────────

import {
  generateImage,
  analyzeVideoEditorial,
  analyzeVideoClipDirection,
  analyzeVideoForEnhancements,
  transcribeVideo,
  generateCaptions,
} from '../../../L4-agents/analysisServiceBridge.js'

// ── Tests ────────────────────────────────────────────────────────────

describe('L4 Unit: analysisServiceBridge re-exports', () => {
  it('re-exports generateImage from L3 imageGeneration', () => {
    expect(typeof generateImage).toBe('function')
  })

  it('re-exports analyzeVideoEditorial from L3 videoAnalysis', () => {
    expect(typeof analyzeVideoEditorial).toBe('function')
  })

  it('re-exports analyzeVideoClipDirection from L3 videoAnalysis', () => {
    expect(typeof analyzeVideoClipDirection).toBe('function')
  })

  it('re-exports analyzeVideoForEnhancements from L3 videoAnalysis', () => {
    expect(typeof analyzeVideoForEnhancements).toBe('function')
  })

  it('re-exports transcribeVideo from L3 transcription', () => {
    expect(typeof transcribeVideo).toBe('function')
  })

  it('re-exports generateCaptions from L3 captionGeneration', () => {
    expect(typeof generateCaptions).toBe('function')
  })
})

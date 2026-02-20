/**
 * L4 Unit Test — analysisServiceBridge wrappers
 *
 * Mocks: L3 services only (imageGeneration, videoAnalysis, transcription, captionGeneration)
 * Tests that the bridge module wraps the L3 functions and delegates calls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

// ── Mock L3 services ────────────────────────────────────────────────

const mockGenerateImage = vi.hoisted(() => vi.fn())
const mockAnalyzeVideoEditorial = vi.hoisted(() => vi.fn())
const mockAnalyzeVideoClipDirection = vi.hoisted(() => vi.fn())
const mockAnalyzeVideoForEnhancements = vi.hoisted(() => vi.fn())
const mockTranscribeVideo = vi.hoisted(() => vi.fn())
const mockGenerateCaptions = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/imageGeneration/imageGeneration.js', () => ({
  generateImage: mockGenerateImage,
}))

vi.mock('../../../L3-services/videoAnalysis/videoAnalysis.js', () => ({
  analyzeVideoEditorial: mockAnalyzeVideoEditorial,
  analyzeVideoClipDirection: mockAnalyzeVideoClipDirection,
  analyzeVideoForEnhancements: mockAnalyzeVideoForEnhancements,
}))

vi.mock('../../../L3-services/transcription/transcription.js', () => ({
  transcribeVideo: mockTranscribeVideo,
}))

vi.mock('../../../L3-services/captionGeneration/captionGeneration.js', () => ({
  generateCaptions: mockGenerateCaptions,
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

describe('L4 Unit: analysisServiceBridge wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('analyzeVideoEditorial delegates to L3', async () => {
    mockAnalyzeVideoEditorial.mockResolvedValue('cut it')
    const result = await analyzeVideoEditorial('/v.mp4', 'prompt')
    expect(result).toBe('cut it')
    expect(mockAnalyzeVideoEditorial).toHaveBeenCalledWith('/v.mp4', 'prompt')
  })

  it('analyzeVideoClipDirection delegates to L3', async () => {
    mockAnalyzeVideoClipDirection.mockResolvedValue('zoom in')
    const result = await analyzeVideoClipDirection('/v.mp4', 'prompt')
    expect(result).toBe('zoom in')
  })

  it('analyzeVideoForEnhancements delegates to L3', async () => {
    mockAnalyzeVideoForEnhancements.mockResolvedValue([])
    const result = await analyzeVideoForEnhancements('/v.mp4', 'prompt' as never)
    expect(result).toEqual([])
  })

  it('transcribeVideo delegates to L3', async () => {
    mockTranscribeVideo.mockResolvedValue({ text: 'hello' })
    const result = await transcribeVideo('/audio.mp3')
    expect(result).toEqual({ text: 'hello' })
  })

  it('generateCaptions delegates to L3', async () => {
    mockGenerateCaptions.mockResolvedValue('/captions.srt')
    const result = await generateCaptions('/dir', [] as never)
    expect(result).toBe('/captions.srt')
  })

  it('generateImage delegates to L3', async () => {
    mockGenerateImage.mockResolvedValue('/img.png')
    const result = await generateImage('prompt', '/out.png')
    expect(result).toBe('/img.png')
  })
})

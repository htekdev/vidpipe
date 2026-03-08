/**
 * L4-L6 Integration Test — clip agent prompt quality rules
 *
 * Mock boundary: L2 (LLM provider)
 * Real code:     L3 providerFactory + L4 agents (ShortsAgent, MediumVideoAgent)
 *
 * Verifies that the agent system prompts enforce sentence-boundary
 * hook rules to prevent jarring mid-sentence cuts.
 */
import { vi, describe, test, expect } from 'vitest'

let capturedPrompt = ''

vi.mock('../../../L2-clients/llm/index.js', () => {
  const mockSession = {
    sendAndWait: async () => ({
      content: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: { amount: 0, model: 'mock', unit: 'usd' as const },
      durationMs: 0,
    }),
    on: () => {},
    destroy: async () => {},
  }
  const mockProvider = {
    name: 'mock',
    createSession: async (opts: { systemPrompt?: string }) => {
      capturedPrompt = opts.systemPrompt ?? ''
      return mockSession
    },
    isAvailable: () => true,
    getDefaultModel: () => 'mock-model',
    close: async () => {},
  }
  return {
    getProvider: () => mockProvider,
    resetProvider: async () => {},
    getProviderName: () => 'copilot' as const,
  }
})

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: () => 'ffmpeg',
  getFFprobePath: () => 'ffprobe',
  ffprobe: vi.fn(),
}))

describe('L4-L6 Integration: clip agent hook-first prompt quality', () => {
  const mockVideo = {
    filename: 'test.mp4',
    repoPath: '/tmp/test.mp4',
    slug: 'test',
    videoDir: '/tmp',
    duration: 300,
    createdAt: new Date(),
  } as any

  const mockTranscript = {
    duration: 300,
    text: 'Hello world',
    segments: [{
      start: 0, end: 10, text: 'Hello world',
      words: [
        { start: 0, end: 0.5, word: 'Hello' },
        { start: 0.6, end: 1.0, word: 'world' },
      ],
    }],
    words: [
      { start: 0, end: 0.5, word: 'Hello' },
      { start: 0.6, end: 1.0, word: 'world' },
    ],
  } as any

  test('ShortsAgent prompt requires sentence boundary hooks and viral scoring', async () => {
    const { generateShorts } = await import('../../../L4-agents/ShortsAgent.js')
    await generateShorts(mockVideo, mockTranscript)
    expect(capturedPrompt).toContain('sentence or clause boundary')
    expect(capturedPrompt).toContain('self-contained, complete thought')
    expect(capturedPrompt).toContain('Viral Score')
    expect(capturedPrompt).toContain('hookType')
  })

  test('MediumVideoAgent prompt enforces chronological order and viral strategy', async () => {
    const { generateMediumClips } = await import('../../../L4-agents/MediumVideoAgent.js')
    await generateMediumClips(mockVideo, mockTranscript)
    expect(capturedPrompt).toContain('strict chronological order')
    expect(capturedPrompt).toContain('NOT hook-first')
    expect(capturedPrompt).toContain('Viral Score')
    expect(capturedPrompt).toContain('micro-hook')
  })
})

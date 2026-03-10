/**
 * L4-L6 Integration Test — clip agent prompt quality rules
 *
 * Mock boundary: L2 (LLM provider)
 * Real code:     L3 providerFactory + L4 agents (ShortsAgent, MediumVideoAgent, SocialMediaAgent)
 *
 * Verifies that the agent system prompts enforce sentence-boundary
 * hook rules and that clip posts include broader video context.
 */
import { vi, describe, test, expect } from 'vitest'

let capturedPrompt = ''
let capturedUserMessage = ''

vi.mock('../../../L2-clients/llm/index.js', () => {
  const mockSession = {
    sendAndWait: async (msg: string) => {
      capturedUserMessage = msg
      return {
        content: '',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        cost: { amount: 0, model: 'mock', unit: 'usd' as const },
        durationMs: 0,
      }
    },
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

  test('generateShortPosts includes video context in user message when summary provided', async () => {
    const { generateShortPosts } = await import('../../../L4-agents/SocialMediaAgent.js')

    const mockShort = {
      id: 's1', title: 'Test Short', slug: 'test-short',
      segments: [{ start: 0, end: 10, description: 'intro' }],
      totalDuration: 10, outputPath: '/tmp/short.mp4',
      description: 'A test clip', tags: ['test'],
    } as any

    const mockSummary = {
      title: 'Building a Video Pipeline',
      overview: 'A deep dive into automated video editing with AI agents',
      keyTopics: ['ffmpeg', 'transcription', 'AI agents'],
      snapshots: [],
      markdownPath: '/tmp/README.md',
    }

    await generateShortPosts(mockVideo, mockShort, mockTranscript, undefined, mockSummary)

    expect(capturedUserMessage).toContain('Broader Video Context')
    expect(capturedUserMessage).toContain('Building a Video Pipeline')
    expect(capturedUserMessage).toContain('deep dive into automated video editing')
    expect(capturedUserMessage).toContain('ffmpeg')
    expect(capturedUserMessage).toContain('transcription')
  })

  test('generateShortPosts works without summary (backward compatible)', async () => {
    const { generateShortPosts } = await import('../../../L4-agents/SocialMediaAgent.js')

    const mockShort = {
      id: 's1', title: 'Test Short', slug: 'test-short',
      segments: [{ start: 0, end: 10, description: 'intro' }],
      totalDuration: 10, outputPath: '/tmp/short.mp4',
      description: 'A test clip', tags: ['test'],
    } as any

    await generateShortPosts(mockVideo, mockShort, mockTranscript)

    expect(capturedUserMessage).not.toContain('Broader Video Context')
    expect(capturedUserMessage).toContain('Short Clip Metadata')
  })
})

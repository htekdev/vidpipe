import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'

const mockSendAndWait = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn())
const mockCreateSession = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    sendAndWait: mockSendAndWait,
    close: mockClose,
  }),
)
const mockGetProvider = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    name: 'mock',
    createSession: mockCreateSession,
  }),
)
const mockGetModelForAgent = vi.hoisted(() => vi.fn().mockReturnValue('test-model'))

vi.mock('../../../L3-services/llm/providerFactory.js', () => ({
  getProvider: mockGetProvider,
}))

vi.mock('../../../L1-infra/config/modelConfig.js', () => ({
  getModelForAgent: mockGetModelForAgent,
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: vi.fn().mockReturnValue({
    name: 'TestBrand',
    handle: '@testbrand',
    tagline: 'Test tagline',
    voice: { tone: 'casual', personality: 'friendly', style: 'conversational' },
    advocacy: { primary: ['ai', 'devtools'], interests: [], avoids: [] },
  }),
}))

describe('ideaEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enrichIdeaInput.REQ-049 calls LLM and returns CreateIdeaInput', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'AI is rewriting CI/CD',
        audience: 'devops engineers',
        keyTakeaway: 'Agents automate pipeline decisions',
        talkingPoints: ['GitHub Actions agents', 'Auto-review PRs'],
        platforms: ['youtube', 'tiktok'],
        tags: ['ai', 'devops'],
        publishBy: '2026-04-01',
        trendContext: 'GitHub announced AI agents for Actions',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('AI agents for CI/CD')

    expect(result.topic).toBe('AI agents for CI/CD')
    expect(result.hook).toBe('AI is rewriting CI/CD')
    expect(result.audience).toBe('devops engineers')
    expect(result.platforms).toEqual([Platform.YouTube, Platform.TikTok])
    expect(result.talkingPoints).toHaveLength(2)
    expect(result.tags).toEqual(['ai', 'devops'])
    expect(result.publishBy).toBe('2026-04-01')
    expect(result.trendContext).toBe('GitHub announced AI agents for Actions')
  })

  it('creates session with system prompt and no tools', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await enrichIdeaInput('Test topic')

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [],
        model: 'test-model',
      }),
    )
  })

  it('includes topic in user message', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await enrichIdeaInput('My specific topic')

    const userMessage = mockSendAndWait.mock.calls[0][0]
    expect(userMessage).toContain('My specific topic')
  })

  it('enrichIdeaInput.REQ-050 includes prompt in user message', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await enrichIdeaInput('AI topic', 'Focus on GitHub Actions')

    const userMessage = mockSendAndWait.mock.calls[0][0]
    expect(userMessage).toContain('Focus on GitHub Actions')
  })

  it('closes session after completion', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await enrichIdeaInput('Test')

    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('closes session even on error', async () => {
    mockSendAndWait.mockRejectedValue(new Error('LLM failed'))

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await expect(enrichIdeaInput('Test')).rejects.toThrow('LLM failed')

    expect(mockClose).toHaveBeenCalledOnce()
  })

  it('handles markdown-fenced JSON response', async () => {
    mockSendAndWait.mockResolvedValue({
      content: '```json\n{"hook":"h","audience":"a","keyTakeaway":"k","talkingPoints":[],"platforms":["youtube"],"tags":[],"publishBy":"2026-04-01"}\n```',
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('Test')

    expect(result.hook).toBe('h')
    expect(result.audience).toBe('a')
  })

  it('filters invalid platforms from AI response', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube', 'fakebook', 'tiktok'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('Test')

    expect(result.platforms).toEqual([Platform.YouTube, Platform.TikTok])
  })

  it('truncates hook to 80 characters', async () => {
    const longHook = 'A'.repeat(120)
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: longHook,
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['youtube'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('Test')

    expect(result.hook.length).toBe(80)
  })

  it('defaults to youtube when no valid platforms in response', async () => {
    mockSendAndWait.mockResolvedValue({
      content: JSON.stringify({
        hook: 'h',
        audience: 'a',
        keyTakeaway: 'k',
        talkingPoints: [],
        platforms: ['fakebook'],
        tags: [],
        publishBy: '2026-04-01',
      }),
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('Test')

    expect(result.platforms).toEqual([Platform.YouTube])
  })

  it('throws on invalid JSON response', async () => {
    mockSendAndWait.mockResolvedValue({
      content: 'This is not JSON at all',
    })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    await expect(enrichIdeaInput('Test')).rejects.toThrow('Failed to parse AI enrichment response')
  })

  it('REQ-052 extracts JSON when LLM includes preamble text before the object', async () => {
    const preambleResponse =
      'Now I have comprehensive information about GitHub Copilot CLI extensions. Let me generate the content idea:\n\n' +
      JSON.stringify({
        hook: 'Your terminal just got superpowers with Copilot CLI extensions',
        audience: 'developers who use GitHub Copilot',
        keyTakeaway: 'Copilot CLI extensions unlock agentic workflows',
        talkingPoints: ['Extension scaffolding', 'Hook lifecycle', 'Tool registration'],
        platforms: ['youtube', 'tiktok'],
        tags: ['copilot', 'cli', 'extensions'],
        publishBy: '2026-03-20',
        trendContext: 'GitHub Copilot CLI just shipped extension support',
      })

    mockSendAndWait.mockResolvedValue({ content: preambleResponse })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('GitHub Copilot CLI Extensions')

    expect(result.hook).toBe('Your terminal just got superpowers with Copilot CLI extensions')
    expect(result.audience).toBe('developers who use GitHub Copilot')
    expect(result.platforms).toEqual([Platform.YouTube, Platform.TikTok])
    expect(result.talkingPoints).toHaveLength(3)
  })

  it('REQ-052 extracts JSON when LLM includes preamble and trailing text', async () => {
    const wrappedResponse =
      'Sure! Here is the idea:\n' +
      '{"hook":"h","audience":"a","keyTakeaway":"k","talkingPoints":[],"platforms":["youtube"],"tags":[],"publishBy":"2026-04-01"}\n' +
      'Let me know if you want changes!'

    mockSendAndWait.mockResolvedValue({ content: wrappedResponse })

    const { enrichIdeaInput } = await import('../../../L4-agents/ideaEnrichment.js')
    const result = await enrichIdeaInput('Test')

    expect(result.hook).toBe('h')
    expect(result.audience).toBe('a')
  })
})

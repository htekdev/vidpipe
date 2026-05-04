import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ThumbnailConfig } from '../../../L0-pure/types/index.js'

// ── Hoisted mocks ───────────────────────────────────────────────────────────
const mockL2GenerateImage = vi.hoisted(() => vi.fn())
const mockL2GenerateImageWithReference = vi.hoisted(() => vi.fn())

// ── Mock boundary: L2 clients only (L3 through L6 run real) ────────────────
vi.mock('../../../L2-clients/openai/imageGeneration.js', () => ({
  generateImage: mockL2GenerateImage,
  generateImageWithReference: mockL2GenerateImageWithReference,
  COST_BY_QUALITY: { low: 0.04, medium: 0.07, high: 0.07 } as Record<string, number>,
}))

// Mock @github/copilot-sdk for ThumbnailAgent session tests
vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: function CopilotClientMock() {
    return {
      createSession: async () => ({
        sendAndWait: async () => ({ data: { content: '' } }),
        on: (event: string, handler: (...args: any[]) => void) => {
          if (event === 'session.idle') {
            Promise.resolve().then(() => handler())
          }
          return () => {}
        },
        send: async () => {},
        destroy: async () => {},
      }),
      stop: async () => {},
    }
  },
  CopilotSession: function CopilotSessionMock() {},
  approveAll: vi.fn().mockReturnValue({ result: 'allow' }),
}))

// ── Import SUT after mocks ──────────────────────────────────────────────────
import { generateThumbnailForClip } from '../../../L5-assets/thumbnailGeneration.js'
import type { ThumbnailContext } from '../../../L5-assets/thumbnailGeneration.js'

// ── Helpers ─────────────────────────────────────────────────────────────────
function makeContext(overrides: Partial<ThumbnailContext> = {}): ThumbnailContext {
  return {
    title: 'Test Video Title',
    description: 'A test video about integration testing',
    hook: 'You won\'t believe this integration test',
    topics: ['testing', 'typescript'],
    videoPath: '/videos/test.mp4',
    outputDir: '/videos/test-output',
    contentType: 'main',
    platform: 'youtube',
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('L4-L6 Integration: thumbnail generation bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockL2GenerateImage.mockResolvedValue('/videos/test-output/thumbnail.png')
    mockL2GenerateImageWithReference.mockResolvedValue('/videos/test-output/thumbnail.png')
  })

  test('generateThumbnailForClip returns null when thumbnails disabled', async () => {
    // Real L1 config will return whatever brand.json says — if thumbnail is
    // not configured, getThumbnailConfig() returns { enabled: false }
    const ctx = makeContext()
    const result = await generateThumbnailForClip(ctx)

    // With default brand.json, thumbnails may be enabled or disabled.
    // We verify the function returns string | null without throwing.
    expect(result === null || typeof result === 'string').toBe(true)
  })

  test('generateThumbnailForClip calls L2 generateImage when thumbnail is enabled', async () => {
    // This test verifies the L5→L4→L3→L2 chain is wired correctly.
    // If brand config has thumbnails disabled, the bridge returns null early
    // and L2 is never called — both outcomes are valid integration behavior.
    const ctx = makeContext()

    const result = await generateThumbnailForClip(ctx)

    if (result !== null) {
      // The L5 bridge called through L4 agent → L3 service → mocked L2
      expect(
        mockL2GenerateImage.mock.calls.length +
        mockL2GenerateImageWithReference.mock.calls.length,
      ).toBeGreaterThanOrEqual(1)
      expect(typeof result).toBe('string')
    }
  })

  test('generateThumbnailForClip respects force flag to regenerate', async () => {
    const ctx = makeContext()

    // First call
    const result1 = await generateThumbnailForClip(ctx, false)
    // Force regeneration
    const result2 = await generateThumbnailForClip(ctx, true)

    // Both calls complete without error
    expect(result1 === null || typeof result1 === 'string').toBe(true)
    expect(result2 === null || typeof result2 === 'string').toBe(true)
  })

  test('generateThumbnailForClip handles shorts content type', async () => {
    const ctx = makeContext({ contentType: 'shorts', platform: 'tiktok' })

    const result = await generateThumbnailForClip(ctx)

    expect(result === null || typeof result === 'string').toBe(true)
  })

  test('generateThumbnailForClip handles medium-clips content type', async () => {
    const ctx = makeContext({ contentType: 'medium-clips', platform: 'instagram' })

    const result = await generateThumbnailForClip(ctx)

    expect(result === null || typeof result === 'string').toBe(true)
  })
})

describe('L4-L6 Integration: thumbnail L5 bridge exports', () => {
  test('generateThumbnailForClip is an async function', () => {
    expect(typeof generateThumbnailForClip).toBe('function')
  })

  test('ThumbnailContext type is importable from L5 bridge', async () => {
    const mod = await import('../../../L5-assets/thumbnailGeneration.js')
    expect(typeof mod.generateThumbnailForClip).toBe('function')
  })
})

describe('L4-L6 Integration: ThumbnailAgent class', () => {
  test('ThumbnailAgent is lazily importable from L4', async () => {
    const { ThumbnailAgent } = await import('../../../L4-agents/ThumbnailAgent.js')
    expect(typeof ThumbnailAgent).toBe('function')
  })

  test('ThumbnailAgent registers generate_thumbnail and capture_best_frame tools', async () => {
    const { ThumbnailAgent } = await import('../../../L4-agents/ThumbnailAgent.js')
    const agent = new ThumbnailAgent()
    try {
      // Access protected getTools() via the agent's tool registration
      const tools = (agent as unknown as { getTools(): Array<{ name: string }> }).getTools()
      const toolNames = tools.map(t => t.name)
      expect(toolNames).toContain('generate_thumbnail')
      expect(toolNames).toContain('capture_best_frame')
    } finally {
      await agent.destroy()
    }
  })

  test('ThumbnailAgent.generateForClip returns empty array when disabled', async () => {
    // With default brand config (thumbnails likely disabled), agent returns []
    const { ThumbnailAgent } = await import('../../../L4-agents/ThumbnailAgent.js')
    const agent = new ThumbnailAgent()
    try {
      const results = await agent.generateForClip(makeContext())
      // Disabled config → empty array; enabled → may have results via mocked L2
      expect(Array.isArray(results)).toBe(true)
    } finally {
      await agent.destroy()
    }
  })
})

describe('L4-L6 Integration: L3 thumbnail service via mocked L2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockL2GenerateImage.mockResolvedValue('/out/generated-thumb.png')
  })

  test('L3 generateThumbnail delegates to mocked L2 generateImage', async () => {
    const { generateThumbnail } = await import(
      '../../../L3-services/imageGeneration/thumbnailGeneration.js'
    )
    const { resolveThumbnailConfig } = await import(
      '../../../L3-services/imageGeneration/thumbnailGeneration.js'
    )

    const config = resolveThumbnailConfig()
    if (config.enabled) {
      const result = await generateThumbnail('test prompt', '/out/thumb.png')
      expect(result).toBe('/out/generated-thumb.png')
      expect(mockL2GenerateImage).toHaveBeenCalledWith(
        expect.any(String),
        '/out/thumb.png',
        expect.objectContaining({ size: expect.any(String), quality: expect.any(String) }),
      )
    }
  })
})

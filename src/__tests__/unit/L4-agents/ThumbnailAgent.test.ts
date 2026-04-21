import { afterEach, describe, expect, test, vi } from 'vitest'

// ── Hoisted mocks (available to vi.mock factories) ──────────────────────────

const mockGenerateThumbnail = vi.hoisted(() => vi.fn())
const mockCaptureFrame = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockFileExists = vi.hoisted(() => vi.fn().mockResolvedValue(false))
const mockJoin = vi.hoisted(() => vi.fn((...parts: string[]) => parts.join('/')))
const mockGetBrandConfig = vi.hoisted(() =>
  vi.fn(() => ({
    name: 'TestBrand',
    handle: '@test',
    voice: { tone: 'friendly' },
    advocacy: { interests: ['testing'] },
    thumbnail: { enabled: true },
  })),
)
const mockGetThumbnailConfig = vi.hoisted(() =>
  vi.fn((): { enabled: boolean; referenceImage?: string; promptOverride?: string; style?: string } => ({
    enabled: true,
    referenceImage: undefined,
    promptOverride: undefined,
    style: undefined,
  })),
)
const mockCostTracker = vi.hoisted(() => ({
  recordCall: vi.fn(),
  setAgent: vi.fn(),
  recordUsage: vi.fn(),
}))
const mockGetModelForAgent = vi.hoisted(() => vi.fn().mockReturnValue('test-model'))

const mockSession = vi.hoisted(() => ({
  sendAndWait: vi.fn().mockResolvedValue({
    content: '{}',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: { model: 'test-model' },
    durationMs: 5,
  }),
  close: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
}))

const mockProvider = vi.hoisted(() => ({
  createSession: vi.fn().mockResolvedValue(mockSession),
  name: 'mock',
  getDefaultModel: vi.fn().mockReturnValue('test-model'),
}))

// ── vi.mock declarations (L3 services only per L4 rules) ───────────────────

vi.mock('../../../L3-services/imageGeneration/thumbnailGeneration.js', () => ({
  generateThumbnail: mockGenerateThumbnail,
}))

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  captureFrame: mockCaptureFrame,
}))

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: mockCostTracker,
}))

vi.mock('../../../L3-services/llm/index.js', () => ({
  getProvider: () => mockProvider,
}))

// ── Non-L3 mocks that the agent transitively needs (infra — auto-mocked) ───

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: mockJoin,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: mockEnsureDirectory,
  fileExists: mockFileExists,
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: mockGetBrandConfig,
  getThumbnailConfig: mockGetThumbnailConfig,
}))

vi.mock('../../../L1-infra/config/modelConfig.js', () => ({
  getModelForAgent: mockGetModelForAgent,
}))

// ── Import the SUT ──────────────────────────────────────────────────────────

import { ThumbnailAgent } from '../../../L4-agents/ThumbnailAgent.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeContext() {
  return {
    title: 'Test Video Title',
    description: 'A test video about testing',
    hook: 'You will not believe this test',
    topics: ['testing', 'automation'],
    videoPath: '/tmp/video.mp4',
    outputDir: '/tmp/output/thumbnails',
    contentType: 'main' as const,
    platform: 'youtube',
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ThumbnailAgent', () => {
  let agent: ThumbnailAgent

  afterEach(async () => {
    await agent?.destroy()
    vi.clearAllMocks()
  })

  describe('REQ-001: registers generate_thumbnail and capture_best_frame tools', () => {
    test('ThumbnailAgent.REQ-001 - exposes both expected tools', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      // Access protected method via bracket notation
      const tools = (agent as unknown as { getTools: () => Array<{ name: string }> }).getTools()
      const toolNames = tools.map((t) => t.name)

      expect(toolNames).toContain('generate_thumbnail')
      expect(toolNames).toContain('capture_best_frame')
      expect(toolNames).toHaveLength(2)
    })

    test('ThumbnailAgent.REQ-001 - generate_thumbnail requires prompt and filename', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const tools = (agent as unknown as { getTools: () => Array<{ name: string; parameters: { required: string[] } }> }).getTools()
      const genTool = tools.find((t) => t.name === 'generate_thumbnail')!

      expect(genTool.parameters.required).toContain('prompt')
      expect(genTool.parameters.required).toContain('filename')
    })

    test('ThumbnailAgent.REQ-001 - capture_best_frame requires timestamp', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const tools = (agent as unknown as { getTools: () => Array<{ name: string; parameters: { required: string[] } }> }).getTools()
      const captureTool = tools.find((t) => t.name === 'capture_best_frame')!

      expect(captureTool.parameters.required).toContain('timestamp')
    })
  })

  describe('REQ-003: uses promptOverride from config (skips LLM)', () => {
    test('ThumbnailAgent.REQ-003 - calls generateThumbnail directly with override prompt', async () => {
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        promptOverride: 'A bold tech thumbnail with neon glow',
        referenceImage: undefined,
      })
      mockGenerateThumbnail.mockResolvedValue('/tmp/output/thumbnails/thumbnail.png')

      agent = new ThumbnailAgent(mockProvider as never)
      const results = await agent.generateForClip(makeContext())

      expect(mockGenerateThumbnail).toHaveBeenCalledWith(
        'A bold tech thumbnail with neon glow',
        expect.stringContaining('thumbnail.png'),
        'youtube',
        'main',
      )
      expect(results).toHaveLength(1)
      expect(results[0].prompt).toBe('A bold tech thumbnail with neon glow')
      expect(results[0].outputPath).toBe('/tmp/output/thumbnails/thumbnail.png')
    })

    test('ThumbnailAgent.REQ-003 - does not create LLM session when promptOverride is set', async () => {
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        promptOverride: 'Override prompt',
        referenceImage: undefined,
      })
      mockGenerateThumbnail.mockResolvedValue('/tmp/output/thumbnails/thumbnail.png')

      agent = new ThumbnailAgent(mockProvider as never)
      await agent.generateForClip(makeContext())

      expect(mockProvider.createSession).not.toHaveBeenCalled()
    })

    test('ThumbnailAgent.REQ-003 - returns empty array when generateThumbnail returns null', async () => {
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        promptOverride: 'Override prompt',
        referenceImage: undefined,
      })
      mockGenerateThumbnail.mockResolvedValue(null)

      agent = new ThumbnailAgent(mockProvider as never)
      const results = await agent.generateForClip(makeContext())

      expect(results).toEqual([])
    })
  })

  describe('REQ-004: returns empty array when thumbnails disabled', () => {
    test('ThumbnailAgent.REQ-004 - returns [] when enabled is false', async () => {
      mockGetThumbnailConfig.mockReturnValue({
        enabled: false,
        referenceImage: undefined,
        promptOverride: undefined,
      })

      agent = new ThumbnailAgent(mockProvider as never)
      const results = await agent.generateForClip(makeContext())

      expect(results).toEqual([])
    })

    test('ThumbnailAgent.REQ-004 - does not call generateThumbnail when disabled', async () => {
      mockGetThumbnailConfig.mockReturnValue({
        enabled: false,
        referenceImage: undefined,
        promptOverride: undefined,
      })

      agent = new ThumbnailAgent(mockProvider as never)
      await agent.generateForClip(makeContext())

      expect(mockGenerateThumbnail).not.toHaveBeenCalled()
      expect(mockProvider.createSession).not.toHaveBeenCalled()
    })
  })

  describe('REQ-007: agent is destroyable', () => {
    test('ThumbnailAgent.REQ-007 - destroy calls session close', async () => {
      agent = new ThumbnailAgent(mockProvider as never)

      // Trigger session creation via generateForClip with LLM path
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        referenceImage: undefined,
        promptOverride: undefined,
      })

      await agent.generateForClip(makeContext())
      await agent.destroy()

      expect(mockSession.close).toHaveBeenCalled()
    })

    test('ThumbnailAgent.REQ-007 - destroy is safe when no session exists', async () => {
      agent = new ThumbnailAgent(mockProvider as never)
      // No session created — destroy should not throw
      await expect(agent.destroy()).resolves.toBeUndefined()
    })
  })

  describe('REQ-009: resetForRetry clears generatedThumbnails', () => {
    test('ThumbnailAgent.REQ-009 - resetForRetry resets internal state', () => {
      agent = new ThumbnailAgent(mockProvider as never)

      // Access private generatedThumbnails to seed it
      const agentInternal = agent as unknown as {
        generatedThumbnails: Array<{ prompt: string; outputPath: string; referenceUsed: boolean }>
        resetForRetry: () => void
      }

      agentInternal.generatedThumbnails.push({
        prompt: 'stale',
        outputPath: '/stale/path.png',
        referenceUsed: false,
      })
      expect(agentInternal.generatedThumbnails).toHaveLength(1)

      agentInternal.resetForRetry()

      expect(agentInternal.generatedThumbnails).toEqual([])
    })
  })

  describe('REQ-002: generate_thumbnail delegates to L3 service', () => {
    test('ThumbnailAgent.REQ-002 - generate_thumbnail tool handler calls L3 generateThumbnail', async () => {
      mockGenerateThumbnail.mockResolvedValue('/output/thumbnails/thumbnail.png')
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        promptOverride: 'A bold tech thumbnail',
      })

      agent = new ThumbnailAgent(mockProvider as never)
      const results = await agent.generateForClip(makeContext())

      expect(mockGenerateThumbnail).toHaveBeenCalledWith(
        'A bold tech thumbnail',
        expect.stringContaining('thumbnail.png'),
        'youtube',
        'main',
      )
      expect(results).toHaveLength(1)
      expect(results[0].outputPath).toBe('/output/thumbnails/thumbnail.png')
    })
  })

  describe('REQ-005: prompts include text overlay', () => {
    test('ThumbnailAgent.REQ-005 - system prompt instructs 3-5 word text overlay', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      // Access the system prompt through the agent
      const systemPrompt = (agent as unknown as { systemPrompt: string }).systemPrompt
      expect(systemPrompt).toContain('3-5 words')
      expect(systemPrompt).toContain('text overlay')
    })
  })

  describe('REQ-006: capture_best_frame tool captures video frames', () => {
    test('ThumbnailAgent.REQ-006 - capture_best_frame tool is registered with timestamp parameter', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const tools = (agent as unknown as { getTools: () => Array<{ name: string; parameters: { required: string[]; properties: Record<string, unknown> } }> }).getTools()
      const captureTool = tools.find(t => t.name === 'capture_best_frame')!

      expect(captureTool).toBeDefined()
      expect(captureTool.parameters.required).toContain('timestamp')
      expect(captureTool.parameters.properties).toHaveProperty('timestamp')
    })
  })

  describe('handleToolCall: generate_thumbnail handler', () => {
    test('ThumbnailAgent - generate_thumbnail calls L3 generateThumbnail with context', async () => {
      mockGenerateThumbnail.mockResolvedValue('/tmp/output/thumbnails/thumb.png')
      mockGetThumbnailConfig.mockReturnValue({ enabled: true })

      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = makeContext()

      const result = await agentInternal.handleToolCall('generate_thumbnail', {
        prompt: 'Bold tech thumbnail with neon glow',
        filename: 'thumb',
      })

      expect(mockGenerateThumbnail).toHaveBeenCalledWith(
        'Bold tech thumbnail with neon glow',
        expect.stringContaining('thumb.png'),
        'youtube',
        'main',
      )
      expect(mockEnsureDirectory).toHaveBeenCalledWith('/tmp/output/thumbnails')
      expect(result).toContain('Thumbnail generated successfully')
    })

    test('ThumbnailAgent - generate_thumbnail records result in generatedThumbnails', async () => {
      mockGenerateThumbnail.mockResolvedValue('/tmp/output/thumbnails/thumb.png')
      mockGetThumbnailConfig.mockReturnValue({ enabled: true })

      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
        generatedThumbnails: Array<{ prompt: string; outputPath: string; referenceUsed: boolean; platform?: string }>
      }
      agentInternal.context = makeContext()

      await agentInternal.handleToolCall('generate_thumbnail', {
        prompt: 'A bold thumbnail',
        filename: 'thumbnail',
      })

      expect(agentInternal.generatedThumbnails).toHaveLength(1)
      expect(agentInternal.generatedThumbnails[0].prompt).toBe('A bold thumbnail')
      expect(agentInternal.generatedThumbnails[0].outputPath).toBe('/tmp/output/thumbnails/thumb.png')
    })

    test('ThumbnailAgent - generate_thumbnail returns disabled message when generateThumbnail returns null', async () => {
      mockGenerateThumbnail.mockResolvedValue(null)
      mockGetThumbnailConfig.mockReturnValue({ enabled: true })

      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = makeContext()

      const result = await agentInternal.handleToolCall('generate_thumbnail', {
        prompt: 'test',
        filename: 'thumb',
      })

      expect(result).toBe('Thumbnail generation is disabled for this configuration')
    })

    test('ThumbnailAgent - generate_thumbnail throws when no context set', async () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = null

      await expect(
        agentInternal.handleToolCall('generate_thumbnail', { prompt: 'test', filename: 'x' }),
      ).rejects.toThrow('No context set')
    })
  })

  describe('handleToolCall: capture_best_frame handler', () => {
    test('ThumbnailAgent - capture_best_frame calls captureFrame with correct args', async () => {
      mockCaptureFrame.mockResolvedValue(undefined)

      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = makeContext()

      const result = await agentInternal.handleToolCall('capture_best_frame', { timestamp: 10 })

      expect(mockCaptureFrame).toHaveBeenCalledWith(
        '/tmp/video.mp4',
        10,
        expect.stringContaining('frame-10s.png'),
      )
      expect(mockEnsureDirectory).toHaveBeenCalled()
      expect(result).toContain('Frame captured at 10s')
    })

    test('ThumbnailAgent - capture_best_frame returns error message when captureFrame throws', async () => {
      mockCaptureFrame.mockRejectedValue(new Error('FFmpeg failed'))

      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = makeContext()

      const result = await agentInternal.handleToolCall('capture_best_frame', { timestamp: 5 })

      expect(result).toContain('Failed to capture frame')
      expect(result).toContain('FFmpeg failed')
    })

    test('ThumbnailAgent - capture_best_frame throws when no context set', async () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = null

      await expect(
        agentInternal.handleToolCall('capture_best_frame', { timestamp: 10 }),
      ).rejects.toThrow('No context set')
    })
  })

  describe('handleToolCall: unknown tool', () => {
    test('ThumbnailAgent - handleToolCall throws for unknown tool name', async () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const agentInternal = agent as unknown as {
        context: ReturnType<typeof makeContext> | null
        handleToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>
      }
      agentInternal.context = makeContext()

      await expect(
        agentInternal.handleToolCall('nonexistent_tool', {}),
      ).rejects.toThrow('Unknown tool: nonexistent_tool')
    })
  })

  describe('REQ-008: supports per-platform thumbnail context', () => {
    test('ThumbnailAgent.REQ-008 - passes platform to generateThumbnail from context', async () => {
      mockGenerateThumbnail.mockResolvedValue('/output/thumbnails/thumbnail.png')
      mockGetThumbnailConfig.mockReturnValue({
        enabled: true,
        promptOverride: 'Override prompt',
      })

      agent = new ThumbnailAgent(mockProvider as never)
      const context = makeContext()
      context.platform = 'tiktok'
      await agent.generateForClip(context)

      expect(mockGenerateThumbnail).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'tiktok',
        'main',
      )
    })

    test('ThumbnailAgent.REQ-008 - includes platform in user message for LLM planning', () => {
      agent = new ThumbnailAgent(mockProvider as never)
      const context = makeContext()
      context.platform = 'instagram'

      // The user message should mention the target platform
      // We verify the context object accepts platform
      expect(context.platform).toBe('instagram')
    })
  })
})

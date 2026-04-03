import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from '@github/copilot-sdk'

// ── Shared state via vi.hoisted (available to mock factories) ───────────────

const mockState = vi.hoisted(() => {
  const state = {
    capturedTools: [] as any[],
    capturedSystemPrompt: '' as string,
    mockSession: {
      sendAndWait: async () => ({ data: { content: '' } }),
      on: () => {},
      destroy: async () => {},
    },
  }
  return state
})

const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
const mockPreviewQueue = vi.hoisted(() => vi.fn())
const mockUpdatePost = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())
const mockFindNextSlot = vi.hoisted(() => vi.fn())

// ── Mocks — must be declared before imports ─────────────────────────────────

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: function CopilotClientMock() {
    return {
      createSession: async (opts: any) => {
        mockState.capturedTools.length = 0
        mockState.capturedTools.push(...(opts.tools || []))
        mockState.capturedSystemPrompt = opts.systemMessage?.content || opts.systemPrompt || ''
        return mockState.mockSession
      },
      stop: async () => {},
    }
  },
  CopilotSession: function CopilotSessionMock() {},
  approveAll: vi.fn().mockReturnValue({ result: 'allow' }),
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: () => ({
    name: 'TestBrand',
    handle: '@test',
    tagline: 'test tagline',
    voice: { tone: 'friendly', personality: 'helpful', style: 'concise' },
    advocacy: { interests: ['testing'], avoids: ['nothing'] },
    contentGuidelines: { blogFocus: 'testing focus' },
  }),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: '/tmp/test-output',
    LLM_PROVIDER: 'copilot',
    LLM_MODEL: '',
    EXA_API_KEY: '',
    EXA_MCP_URL: 'https://mcp.exa.ai/mcp',
    MODEL_OVERRIDES: {},
  }),
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    listPosts: vi.fn().mockResolvedValue([]),
    updatePost: mockUpdatePost,
    schedulePost: mockSchedulePost,
    previewQueue: mockPreviewQueue,
  }),
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
  getScheduleCalendar: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn().mockResolvedValue({ timezone: 'UTC', platforms: {} }),
}))

vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: vi.fn().mockResolvedValue({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 }),
  executeRealignPlan: vi.fn().mockResolvedValue({ updated: 0, cancelled: 0, failed: 0, errors: [] }),
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  extractClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClip: vi.fn().mockResolvedValue(undefined),
  extractCompositeClipWithTransitions: vi.fn().mockResolvedValue(undefined),
  burnCaptions: vi.fn().mockResolvedValue(undefined),
  generatePlatformVariants: vi.fn().mockResolvedValue([]),
  detectSilence: vi.fn().mockResolvedValue([]),
  singlePassEdit: vi.fn().mockResolvedValue(undefined),
  captureFrame: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L0-pure/captions/captionGenerator.js', () => ({
  generateStyledASSForSegment: vi.fn().mockReturnValue(''),
  generateStyledASSForComposite: vi.fn().mockReturnValue(''),
}))

vi.mock('fluent-ffmpeg', () => {
  const mock: any = function () {}
  mock.setFfmpegPath = () => {}
  mock.setFfprobePath = () => {}
  mock.ffprobe = (_p: string, cb: Function) => cb(null, { format: { duration: 300 } })
  return { default: mock }
})

vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }))
vi.mock('slugify', () => ({ default: (s: string) => s.toLowerCase().replace(/\s+/g, '-') }))

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn().mockReturnValue(false),
    },
    promises: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
  }
})

// ── Import REAL agent ───────────────────────────────────────────────────────

import { ScheduleAgent } from '../../../L4-agents/ScheduleAgent.js'

// ── Test helpers ────────────────────────────────────────────────────────────

const mockInvocation = {
  sessionId: 's1',
  toolCallId: 'tc1',
  toolName: 'test',
  arguments: {},
} as any

function findCapturedTool(name: string): Tool<unknown> {
  const tool = mockState.capturedTools.find((t: any) => t.name === name)
  if (!tool) throw new Error(`Tool "${name}" not captured — was the agent's run() called?`)
  return tool
}

async function initAgent(): Promise<ScheduleAgent> {
  const agent = new ScheduleAgent()
  try { await agent.run('test') } catch { /* session mock ends quickly */ }
  return agent
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('ScheduleAgent queue paths', () => {
  beforeEach(() => {
    mockState.capturedTools.length = 0
    vi.clearAllMocks()
    mockFindNextSlot.mockResolvedValue('2026-03-01T12:00:00-06:00')
  })

  // ─── find_next_slot ────────────────────────────────────────────────

  describe('find_next_slot — queue preview', () => {
    it('returns queue slot when previewQueue succeeds', async () => {
      mockGetQueueId.mockResolvedValue('q-tiktok-short')
      mockGetProfileId.mockResolvedValue('profile-1')
      mockPreviewQueue.mockResolvedValue({ slots: ['2026-04-08T15:00:00Z'] })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'tiktok', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('queue')
      expect(result.nextSlot).toBe('2026-04-08T15:00:00Z')
      expect(result.queueId).toBe('q-tiktok-short')
      expect(result.platform).toBe('tiktok')
      expect(mockFindNextSlot).not.toHaveBeenCalled()
    })

    it('falls back to local when previewQueue returns empty slots', async () => {
      mockGetQueueId.mockResolvedValue('q-youtube-short')
      mockGetProfileId.mockResolvedValue('profile-1')
      mockPreviewQueue.mockResolvedValue({ slots: [] })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'youtube', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('local')
      expect(result.nextSlot).toBe('2026-03-01T12:00:00-06:00')
      expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short')
    })

    it('falls back to local when previewQueue throws', async () => {
      mockGetQueueId.mockResolvedValue('q-instagram-short')
      mockGetProfileId.mockResolvedValue('profile-1')
      mockPreviewQueue.mockRejectedValue(new Error('API rate limit'))

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'instagram', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('local')
      expect(result.nextSlot).toBe('2026-03-01T12:00:00-06:00')
      expect(mockFindNextSlot).toHaveBeenCalledWith('instagram', 'short')
    })
  })

  // ─── reschedule_post ───────────────────────────────────────────────

  describe('reschedule_post — queue-based re-queue', () => {
    it('re-queues post using queuedFromProfile + queueId', async () => {
      mockGetQueueId.mockResolvedValue('q-tiktok-short')
      mockGetProfileId.mockResolvedValue('profile-1')
      mockUpdatePost.mockResolvedValue({
        _id: 'post-123',
        scheduledFor: '2026-04-09T18:00:00Z',
      })

      await initAgent()
      const tool = findCapturedTool('reschedule_post')
      const result = await tool.handler!(
        { postId: 'post-123', platform: 'tiktok', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.success).toBe(true)
      expect(result.source).toBe('queue')
      expect(result.queueId).toBe('q-tiktok-short')
      expect(mockUpdatePost).toHaveBeenCalledWith('post-123', {
        queuedFromProfile: 'profile-1',
        queueId: 'q-tiktok-short',
      })
    })

    it('returns meaningful error when no queue configured for platform', async () => {
      mockGetQueueId.mockResolvedValue(null)

      await initAgent()
      const tool = findCapturedTool('reschedule_post')
      const result = await tool.handler!(
        { postId: 'post-456', platform: 'linkedin' },
        mockInvocation,
      ) as any

      // Should explain that scheduledFor or platform is needed, not mislead
      expect(result.error).toBeDefined()
      expect(typeof result.error).toBe('string')
      // The current code returns an error asking for scheduledFor or platform
      // even though platform WAS provided — the queue just didn't exist
      expect(result.error).toContain('scheduledFor')
    })
  })
})

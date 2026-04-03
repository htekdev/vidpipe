/**
 * L4-L6 Integration Test — ScheduleAgent queue paths
 *
 * Mock boundary: L2 clients (Late API, LLM providers)
 * Real code:     L3 queueMapping + L3 lateApiService + L4 ScheduleAgent
 *
 * Tests that the ScheduleAgent's queue-based tool handlers correctly
 * delegate to L2 Late API operations (previewQueue, updatePost) with
 * proper fallback to local slot calculation when queue operations fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from '@github/copilot-sdk'

// ── Shared state via vi.hoisted ─────────────────────────────────────

const mockState = vi.hoisted(() => {
  const state = {
    capturedTools: [] as any[],
    mockSession: {
      sendAndWait: async () => ({ data: { content: '' } }),
      on: () => {},
      destroy: async () => {},
    },
  }
  return state
})

const mockPreviewQueue = vi.hoisted(() => vi.fn())
const mockUpdatePost = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())
const mockGetScheduledPosts = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockListProfiles = vi.hoisted(() => vi.fn().mockResolvedValue([
  { _id: 'profile-integ', name: 'Integration Test' },
]))
const mockListQueues = vi.hoisted(() => vi.fn().mockResolvedValue({
  queues: [
    { _id: 'q-tiktok-short', profileId: 'profile-integ', name: 'tiktok-short', active: true },
    { _id: 'q-instagram-short', profileId: 'profile-integ', name: 'instagram-short', active: true },
    { _id: 'q-linkedin-medium-clip', profileId: 'profile-integ', name: 'linkedin-medium-clip', active: true },
  ],
}))

// ── Mock L2 boundary ────────────────────────────────────────────────

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function () {
    return {
      previewQueue: mockPreviewQueue,
      updatePost: mockUpdatePost,
      schedulePost: mockSchedulePost,
      getScheduledPosts: mockGetScheduledPosts,
      listPosts: vi.fn().mockResolvedValue([]),
      listProfiles: mockListProfiles,
      listQueues: mockListQueues,
    }
  }),
}))

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: function CopilotClientMock() {
    return {
      createSession: async (opts: any) => {
        mockState.capturedTools.length = 0
        mockState.capturedTools.push(...(opts.tools || []))
        return mockState.mockSession
      },
      stop: async () => {},
    }
  },
  CopilotSession: function CopilotSessionMock() {},
  approveAll: vi.fn().mockReturnValue({ result: 'allow' }),
}))

vi.mock('fluent-ffmpeg', () => {
  const mock: any = function () {}
  mock.setFfmpegPath = () => {}
  mock.setFfprobePath = () => {}
  mock.ffprobe = (_p: string, cb: Function) => cb(null, { format: { duration: 300 } })
  return { default: mock }
})

vi.mock('uuid', () => ({ v4: () => 'test-uuid-integ' }))
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

// ── Import REAL L3 + L4 after mocks ─────────────────────────────────

import { ScheduleAgent } from '../../../L4-agents/ScheduleAgent.js'
import { clearQueueCache } from '../../../L3-services/queueMapping/queueMapping.js'

// ── Test helpers ────────────────────────────────────────────────────

const mockInvocation = {
  sessionId: 's-integ',
  toolCallId: 'tc-integ',
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

// ── Tests ───────────────────────────────────────────────────────────

describe('L4-L6 Integration: ScheduleAgent queue paths (mocked L2)', () => {
  beforeEach(async () => {
    mockState.capturedTools.length = 0
    vi.clearAllMocks()
    // Reset queue cache so each test gets fresh L2 data
    await clearQueueCache()
    // Re-setup default L2 mock responses
    mockGetScheduledPosts.mockResolvedValue([])
    mockListProfiles.mockResolvedValue([
      { _id: 'profile-integ', name: 'Integration Test' },
    ])
    mockListQueues.mockResolvedValue({
      queues: [
        { _id: 'q-tiktok-short', profileId: 'profile-integ', name: 'tiktok-short', active: true },
        { _id: 'q-instagram-short', profileId: 'profile-integ', name: 'instagram-short', active: true },
        { _id: 'q-linkedin-medium-clip', profileId: 'profile-integ', name: 'linkedin-medium-clip', active: true },
      ],
    })
  })

  // ─── find_next_slot — queue preview success ─────────────────────

  describe('find_next_slot — queue preview returns slot', () => {
    it('returns queue-sourced slot when previewQueue succeeds', async () => {
      mockPreviewQueue.mockResolvedValue({
        profileId: 'profile-integ',
        queueId: 'q-tiktok-short',
        slots: ['2026-05-10T14:00:00Z'],
      })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'tiktok', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('queue')
      expect(result.nextSlot).toBe('2026-05-10T14:00:00Z')
      expect(result.queueId).toBe('q-tiktok-short')
      expect(result.platform).toBe('tiktok')
      // previewQueue was called with profileId, queueId, count=1
      expect(mockPreviewQueue).toHaveBeenCalledWith('profile-integ', 'q-tiktok-short', 1)
    })

    it('normalizes twitter → x before queue lookup', async () => {
      mockPreviewQueue.mockResolvedValue({
        profileId: 'profile-integ',
        slots: ['2026-05-10T16:00:00Z'],
      })
      // listQueues returns x-short queue
      mockListQueues.mockResolvedValue({
        queues: [
          { _id: 'q-x-short', profileId: 'profile-integ', name: 'x-short', active: true },
        ],
      })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'twitter', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.platform).toBe('x')
    })
  })

  // ─── find_next_slot — fallback to local ─────────────────────────

  describe('find_next_slot — fallback to local calculation', () => {
    it('falls back to local when previewQueue throws', async () => {
      mockPreviewQueue.mockRejectedValue(new Error('Late API 503'))

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'tiktok', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('local')
      expect(result.nextSlot).toBeTruthy()
      // Should be a valid ISO datetime from local calculation
      expect(result.nextSlot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      // previewQueue was attempted
      expect(mockPreviewQueue).toHaveBeenCalled()
    })

    it('falls back to local when previewQueue returns empty slots', async () => {
      mockPreviewQueue.mockResolvedValue({
        profileId: 'profile-integ',
        queueId: 'q-instagram-short',
        slots: [],
      })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'instagram', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.source).toBe('local')
      expect(result.nextSlot).toBeTruthy()
      expect(result.nextSlot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('falls back to local when no queue configured for platform', async () => {
      // Return empty queues so getQueueId returns null
      mockListQueues.mockResolvedValue({ queues: [] })

      await initAgent()
      const tool = findCapturedTool('find_next_slot')
      const result = await tool.handler!(
        { platform: 'linkedin', clipType: 'video' },
        mockInvocation,
      ) as any

      // No queue → goes straight to local
      expect(result.source).toBe('local')
      expect(mockPreviewQueue).not.toHaveBeenCalled()
    })
  })

  // ─── reschedule_post — queue-based re-queue ─────────────────────

  describe('reschedule_post — queue-based re-queue via updatePost', () => {
    it('re-queues post with queuedFromProfile and queueId', async () => {
      mockUpdatePost.mockResolvedValue({
        _id: 'post-789',
        scheduledFor: '2026-05-11T09:00:00Z',
        status: 'scheduled',
      })

      await initAgent()
      const tool = findCapturedTool('reschedule_post')
      const result = await tool.handler!(
        { postId: 'post-789', platform: 'tiktok', clipType: 'short' },
        mockInvocation,
      ) as any

      expect(result.success).toBe(true)
      expect(result.source).toBe('queue')
      expect(result.queueId).toBe('q-tiktok-short')
      expect(result.scheduledFor).toBe('2026-05-11T09:00:00Z')
      // updatePost called with queue fields
      expect(mockUpdatePost).toHaveBeenCalledWith('post-789', {
        queuedFromProfile: 'profile-integ',
        queueId: 'q-tiktok-short',
      })
    })

    it('uses manual override when scheduledFor is provided', async () => {
      mockSchedulePost.mockResolvedValue({
        _id: 'post-manual',
        scheduledFor: '2026-06-01T12:00:00Z',
      })

      await initAgent()
      const tool = findCapturedTool('reschedule_post')
      const result = await tool.handler!(
        { postId: 'post-manual', scheduledFor: '2026-06-01T12:00:00Z' },
        mockInvocation,
      ) as any

      expect(result.success).toBe(true)
      expect(result.source).toBe('manual')
      expect(result.scheduledFor).toBe('2026-06-01T12:00:00Z')
      expect(mockSchedulePost).toHaveBeenCalledWith('post-manual', '2026-06-01T12:00:00Z')
      expect(mockUpdatePost).not.toHaveBeenCalled()
    })

    it('returns error when no queue and no scheduledFor provided', async () => {
      // No queues configured
      mockListQueues.mockResolvedValue({ queues: [] })

      await initAgent()
      const tool = findCapturedTool('reschedule_post')
      const result = await tool.handler!(
        { postId: 'post-noqueue', platform: 'linkedin' },
        mockInvocation,
      ) as any

      expect(result.error).toBeDefined()
      expect(typeof result.error).toBe('string')
      expect(mockUpdatePost).not.toHaveBeenCalled()
      expect(mockSchedulePost).not.toHaveBeenCalled()
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── L1 Mocks ──────────────────────────────────────────────────────────

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFileSync: vi.fn(() => '{"version":"1.3.0"}'),
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
  fileExists: mockFileExists,
  listDirectorySync: vi.fn(() => []),
  fileExistsSync: vi.fn(() => false),
}))

vi.mock('../../../../L1-infra/paths/paths.js', () => ({
  join: (...parts: string[]) => parts.join('/'),
  homedir: () => '/home/testuser',
  projectRoot: () => '/project',
}))

vi.mock('../../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: './recordings',
    WATCH_FOLDER: './watch',
    LLM_PROVIDER: 'copilot',
    LLM_MODEL: undefined,
    OPENAI_API_KEY: 'sk-test',
    EXA_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    LATE_API_KEY: undefined,
    SKIP_GIT: false,
    SKIP_SILENCE_REMOVAL: false,
    SKIP_SHORTS: false,
    SKIP_MEDIUM_CLIPS: false,
    SKIP_SOCIAL: false,
    SKIP_CAPTIONS: false,
    SKIP_VISUAL_ENHANCEMENT: false,
    SKIP_SOCIAL_PUBLISH: false,
  }),
  initConfig: vi.fn(),
}))

vi.mock('../../../../L1-infra/process/process.js', () => ({
  spawnCommand: vi.fn(() => ({ status: 0, stdout: 'v22.0.0' })),
  createModuleRequire: vi.fn(() => vi.fn()),
}))

// ── L3 Mocks ──────────────────────────────────────────────────────────

const mockGetScheduleCalendar = vi.hoisted(() => vi.fn())
const mockFindNextSlot = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/scheduler/scheduler.js', () => ({
  getScheduleCalendar: mockGetScheduleCalendar,
  findNextSlot: mockFindNextSlot,
}))

const mockGetPendingItems = vi.hoisted(() => vi.fn())
const mockGetPublishedItems = vi.hoisted(() => vi.fn())
const mockGetItem = vi.hoisted(() => vi.fn())
const mockRejectItem = vi.hoisted(() => vi.fn())
const mockApproveBulk = vi.hoisted(() => vi.fn())
const mockApproveItem = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/postStore/postStore.js', () => ({
  getPendingItems: mockGetPendingItems,
  getPublishedItems: mockGetPublishedItems,
  getItem: mockGetItem,
  rejectItem: mockRejectItem,
  approveBulk: mockApproveBulk,
  approveItem: mockApproveItem,
}))

const mockGetVideoStatus = vi.hoisted(() => vi.fn())
const mockGetFullState = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/processingState/processingState.js', () => ({
  getVideoStatus: mockGetVideoStatus,
  getFullState: mockGetFullState,
}))

vi.mock('../../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: {
    getReport: vi.fn(() => ({
      totalCostUSD: 0.05,
      totalPRUs: 2,
      totalTokens: { input: 1000, output: 500, total: 1500 },
      totalServiceCostUSD: 0.01,
      byProvider: {},
      byAgent: {},
      byModel: {},
      byService: {},
    })),
  },
}))

const mockBuildRealignPlan = vi.hoisted(() => vi.fn())
const mockExecuteRealignPlan = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: mockBuildRealignPlan,
  executeRealignPlan: mockExecuteRealignPlan,
}))

vi.mock('../../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn(async () => ({ platforms: { youtube: {} } })),
}))

vi.mock('../../../../L3-services/llm/index.js', () => ({}))

vi.mock('../../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: vi.fn(async () => 'acc-123'),
}))

vi.mock('../../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: vi.fn(() => ({
    schedulePost: vi.fn(async () => ({ id: 'late-1' })),
  })),
}))

// ── Import after mocks ────────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQueryTools } from '../../../../L7-app/mcp/tools/query.js'
import { registerActionTools } from '../../../../L7-app/mcp/tools/action.js'
import { registerSystemTools } from '../../../../L7-app/mcp/tools/system.js'
import { createJob, getJob, updateJob, cancelJob, listJobs, cleanupOldJobs } from '../../../../L7-app/mcp/jobs.js'

// ── Helpers ────────────────────────────────────────────────────────────

let registeredTools: Map<string, { description: string; handler: (args: Record<string, unknown>) => Promise<unknown> }>

function createTestServer(): void {
  registeredTools = new Map()
  const mockServer = {
    tool: vi.fn((name: string, description: string, _schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => {
      registeredTools.set(name, { description, handler })
    }),
  } as unknown as McpServer
  registerQueryTools(mockServer)
  registerActionTools(mockServer)
  registerSystemTools(mockServer)
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const tool = registeredTools.get(name)
  if (!tool) throw new Error(`Tool not found: ${name}`)
  const result = await tool.handler(args) as { content: Array<{ text: string }> }
  return JSON.parse(result.content[0].text)
}

// ── Lifecycle ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockFileExists.mockResolvedValue(true)
  mockWriteJsonFile.mockResolvedValue(undefined)
  mockReadJsonFile.mockResolvedValue({ jobs: {} })
  createTestServer()
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('MCP Tools — Query, Action, System', () => {
  describe('Tool Registration', () => {
    it('registers all query tools', () => {
      const queryTools = ['get_schedule_calendar', 'get_pending_posts', 'get_published_posts',
        'get_post', 'get_video_status', 'list_recordings', 'get_cost_report',
        'get_job_status', 'list_jobs']
      for (const name of queryTools) {
        expect(registeredTools.has(name), `Missing: ${name}`).toBe(true)
      }
    })

    it('registers all action tools', () => {
      const actionTools = ['approve_posts', 'reject_posts', 'find_next_slot', 'realign_schedule', 'cancel_job']
      for (const name of actionTools) {
        expect(registeredTools.has(name), `Missing: ${name}`).toBe(true)
      }
    })

    it('registers all system tools', () => {
      const systemTools = ['get_config', 'doctor']
      for (const name of systemTools) {
        expect(registeredTools.has(name), `Missing: ${name}`).toBe(true)
      }
    })
  })

  describe('Query: get_schedule_calendar', () => {
    it('returns calendar with post count', async () => {
      mockGetScheduleCalendar.mockResolvedValue([
        { platform: 'youtube', scheduledFor: '2026-03-15T10:00:00Z', source: 'late' },
        { platform: 'tiktok', scheduledFor: '2026-03-15T12:00:00Z', source: 'local' },
      ])
      const result = await callTool('get_schedule_calendar') as { totalPosts: number; posts: unknown[] }
      expect(result.totalPosts).toBe(2)
      expect(result.posts).toHaveLength(2)
    })

    it('returns empty when no posts', async () => {
      mockGetScheduleCalendar.mockResolvedValue([])
      const result = await callTool('get_schedule_calendar') as { totalPosts: number }
      expect(result.totalPosts).toBe(0)
    })
  })

  describe('Query: get_pending_posts', () => {
    it('returns pending items with count', async () => {
      mockGetPendingItems.mockResolvedValue([
        { id: 'p1', metadata: { platform: 'youtube', clipType: 'short', sourceVideo: 'test.mp4' }, postContent: 'Short content' },
      ])
      const result = await callTool('get_pending_posts') as { count: number; items: Array<{ id: string }> }
      expect(result.count).toBe(1)
      expect(result.items[0].id).toBe('p1')
    })
  })

  describe('Query: get_post', () => {
    it('returns post details for valid ID', async () => {
      mockGetItem.mockResolvedValue({
        id: 'p1', metadata: { platform: 'youtube', clipType: 'short', sourceVideo: 'v.mp4' },
        postContent: 'Full content here',
      })
      const result = await callTool('get_post', { postId: 'p1' }) as { id: string; content: string }
      expect(result.id).toBe('p1')
      expect(result.content).toBe('Full content here')
    })

    it('returns error for unknown post', async () => {
      mockGetItem.mockResolvedValue(undefined)
      const result = await callTool('get_post', { postId: 'nope' }) as { error: string }
      expect(result.error).toContain('nope')
    })
  })

  describe('Query: get_video_status', () => {
    it('returns status for known video', async () => {
      mockGetVideoStatus.mockResolvedValue({ status: 'completed', sourcePath: '/tmp/v.mp4' })
      const result = await callTool('get_video_status', { slug: 'demo' }) as { status: string }
      expect(result.status).toBe('completed')
    })

    it('returns error for unknown video', async () => {
      mockGetVideoStatus.mockResolvedValue(undefined)
      const result = await callTool('get_video_status', { slug: 'nope' }) as { error: string }
      expect(result.error).toContain('nope')
    })
  })

  describe('Query: list_recordings', () => {
    it('returns tracked recordings', async () => {
      mockGetFullState.mockResolvedValue({
        videos: { 'demo': { status: 'completed', sourcePath: '/tmp/demo.mp4' } },
      })
      const result = await callTool('list_recordings') as { tracked: Array<{ slug: string }> }
      expect(result.tracked).toHaveLength(1)
      expect(result.tracked[0].slug).toBe('demo')
    })
  })

  describe('Query: get_cost_report', () => {
    it('returns cost data', async () => {
      const result = await callTool('get_cost_report') as { totalCostUSD: number; totalPRUs: number }
      expect(result.totalCostUSD).toBe(0.05)
      expect(result.totalPRUs).toBe(2)
    })
  })

  describe('Action: reject_posts', () => {
    it('rejects each post and returns count', async () => {
      mockRejectItem.mockResolvedValue(undefined)
      const result = await callTool('reject_posts', { postIds: ['p1', 'p2'] }) as { rejected: number; failed: number }
      expect(result.rejected).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockRejectItem).toHaveBeenCalledTimes(2)
    })

    it('handles partial failures', async () => {
      mockRejectItem
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Not found'))
      const result = await callTool('reject_posts', { postIds: ['p1', 'p2'] }) as { rejected: number; failed: number }
      expect(result.rejected).toBe(1)
      expect(result.failed).toBe(1)
    })
  })

  describe('Action: find_next_slot', () => {
    it('returns slot info', async () => {
      mockFindNextSlot.mockResolvedValue('2026-03-15T10:00:00-05:00')
      const result = await callTool('find_next_slot', { platform: 'youtube' }) as { nextSlot: string; platform: string }
      expect(result.nextSlot).toBe('2026-03-15T10:00:00-05:00')
      expect(result.platform).toBe('youtube')
    })

    it('returns error when no slot', async () => {
      mockFindNextSlot.mockResolvedValue(null)
      const result = await callTool('find_next_slot', { platform: 'youtube' }) as { error: string }
      expect(result.error).toContain('youtube')
    })
  })

  describe('Action: realign_schedule', () => {
    it('returns dry-run plan', async () => {
      mockBuildRealignPlan.mockResolvedValue({
        totalFetched: 10, skipped: 8, unmatched: 0,
        posts: [{
          platform: 'youtube', clipType: 'short',
          post: { content: 'Test post' },
          oldScheduledFor: null, newScheduledFor: '2026-03-15T10:00:00Z',
        }],
        toCancel: [],
      })
      const result = await callTool('realign_schedule', { dryRun: true }) as { dryRun: boolean; toRealign: number }
      expect(result.dryRun).toBe(true)
      expect(result.toRealign).toBe(1)
      expect(mockExecuteRealignPlan).not.toHaveBeenCalled()
    })

    it('executes realignment when dryRun is false', async () => {
      const plan = {
        totalFetched: 5, skipped: 3, unmatched: 0,
        posts: [{
          platform: 'youtube', clipType: 'short',
          post: { content: 'Move me' },
          oldScheduledFor: '2026-03-14T10:00:00Z', newScheduledFor: '2026-03-15T10:00:00Z',
        }],
        toCancel: [],
      }
      mockBuildRealignPlan.mockResolvedValue(plan)
      mockExecuteRealignPlan.mockResolvedValue({ updated: 1, cancelled: 0, failed: 0, errors: [] })

      const result = await callTool('realign_schedule', { dryRun: false }) as { executed: boolean; updated: number }
      expect(result.executed).toBe(true)
      expect(result.updated).toBe(1)
      expect(mockExecuteRealignPlan).toHaveBeenCalledWith(plan)
    })

    it('returns nothing-to-do message when aligned', async () => {
      mockBuildRealignPlan.mockResolvedValue({ totalFetched: 10, skipped: 10, unmatched: 0, posts: [], toCancel: [] })
      const result = await callTool('realign_schedule', { dryRun: true }) as { message: string }
      expect(result.message).toContain('Nothing to realign')
    })
  })

  describe('System: get_config', () => {
    it('returns configuration with version and feature flags', async () => {
      const result = await callTool('get_config') as {
        version: string
        featureFlags: Record<string, boolean>
        hasApiKeys: Record<string, boolean>
      }
      expect(result.version).toBe('1.3.0')
      expect(result.featureFlags.git).toBe(true)
      expect(result.featureFlags.silenceRemoval).toBe(true)
      expect(result.hasApiKeys.openai).toBe(true)
      expect(result.hasApiKeys.exa).toBe(false)
    })
  })

  describe('System: doctor', () => {
    it('returns diagnostic checks', async () => {
      const result = await callTool('doctor') as { checks: Array<{ label: string; ok: boolean }> }
      expect(result.checks.length).toBeGreaterThan(0)
      const nodeCheck = result.checks.find(c => c.label === 'Node.js')
      expect(nodeCheck?.ok).toBe(true)
    })

    it('reports all-passed status', async () => {
      const result = await callTool('doctor') as { allPassed: boolean; failedRequired: number }
      expect(typeof result.allPassed).toBe('boolean')
      expect(typeof result.failedRequired).toBe('number')
    })
  })
})

// ── Jobs CRUD Tests ───────────────────────────────────────────────────

describe('MCP Job Tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFileExists.mockResolvedValue(true)
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockReadJsonFile.mockResolvedValue({ jobs: {} })
  })

  describe('createJob', () => {
    it('creates a job with pending status and unique ID', async () => {
      const job = await createJob('process_video')
      expect(job.id).toMatch(/^job-/)
      expect(job.type).toBe('process_video')
      expect(job.status).toBe('pending')
      expect(job.createdAt).toBeDefined()
      expect(job.heartbeat).toBeDefined()
      expect(mockWriteJsonFile).toHaveBeenCalledOnce()
    })

    it('persists job to disk at vidpipe config path', async () => {
      await createJob('transcribe_video')
      const writeCall = mockWriteJsonFile.mock.calls[0]
      expect(writeCall[0]).toBe('/home/testuser/.vidpipe/mcp-jobs.json')
      const data = writeCall[1] as { jobs: Record<string, unknown> }
      expect(Object.keys(data.jobs)).toHaveLength(1)
    })

    it('generates unique IDs across calls', async () => {
      const job1 = await createJob('a')
      const job2 = await createJob('b')
      expect(job1.id).not.toBe(job2.id)
    })
  })

  describe('getJob', () => {
    it('returns null for unknown job ID', async () => {
      const job = await getJob('nonexistent')
      expect(job).toBeNull()
    })

    it('returns the job when found', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-123': { id: 'job-123', type: 'process_video', status: 'completed', createdAt: now, updatedAt: now, heartbeat: now },
        },
      })
      const job = await getJob('job-123')
      expect(job).not.toBeNull()
      expect(job!.id).toBe('job-123')
      expect(job!.status).toBe('completed')
    })

    it('marks running jobs as failed when heartbeat is stale', async () => {
      const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-stale': { id: 'job-stale', type: 'process_video', status: 'running', createdAt: staleTime, updatedAt: staleTime, heartbeat: staleTime },
        },
      })
      const job = await getJob('job-stale')
      expect(job!.status).toBe('failed')
      expect(job!.error).toContain('stale')
      expect(mockWriteJsonFile).toHaveBeenCalled()
    })

    it('does not mark completed jobs as stale', async () => {
      const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-done': { id: 'job-done', type: 'x', status: 'completed', createdAt: oldTime, updatedAt: oldTime, heartbeat: oldTime },
        },
      })
      const job = await getJob('job-done')
      expect(job!.status).toBe('completed')
    })
  })

  describe('updateJob', () => {
    it('updates job status and progress', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-1': { id: 'job-1', type: 'process_video', status: 'pending', createdAt: now, updatedAt: now, heartbeat: now },
        },
      })
      const updated = await updateJob('job-1', { status: 'running', stage: 'transcription', progress: '2/15 stages' })
      expect(updated!.status).toBe('running')
      expect(updated!.stage).toBe('transcription')
      expect(updated!.progress).toBe('2/15 stages')
    })

    it('returns null for unknown job ID', async () => {
      const result = await updateJob('nonexistent', { status: 'running' })
      expect(result).toBeNull()
    })
  })

  describe('cancelJob', () => {
    it('sets job status to cancelled', async () => {
      const now = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-c': { id: 'job-c', type: 'x', status: 'running', createdAt: now, updatedAt: now, heartbeat: now },
        },
      })
      const job = await cancelJob('job-c')
      expect(job!.status).toBe('cancelled')
      expect(job!.error).toBe('Cancelled by user')
    })
  })

  describe('listJobs', () => {
    it('returns all jobs sorted by creation time (newest first)', async () => {
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-old': { id: 'job-old', type: 'a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' },
          'job-new': { id: 'job-new', type: 'b', status: 'running', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', heartbeat: new Date().toISOString() },
        },
      })
      const jobs = await listJobs()
      expect(jobs).toHaveLength(2)
      expect(jobs[0].id).toBe('job-new')
    })

    it('filters by status', async () => {
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-1': { id: 'job-1', type: 'a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' },
          'job-2': { id: 'job-2', type: 'b', status: 'running', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', heartbeat: new Date().toISOString() },
        },
      })
      const jobs = await listJobs({ status: 'running' })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('job-2')
    })

    it('filters by type', async () => {
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'job-a': { id: 'job-a', type: 'process_video', status: 'completed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', heartbeat: '2026-01-01T00:00:00Z' },
          'job-b': { id: 'job-b', type: 'transcribe', status: 'completed', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z', heartbeat: '2026-03-01T00:00:00Z' },
        },
      })
      const jobs = await listJobs({ type: 'transcribe' })
      expect(jobs).toHaveLength(1)
      expect(jobs[0].id).toBe('job-b')
    })
  })

  describe('cleanupOldJobs', () => {
    it('removes jobs older than maxAge that are not running', async () => {
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      const recent = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: {
          'old-done': { id: 'old-done', type: 'a', status: 'completed', createdAt: old, updatedAt: old, heartbeat: old },
          'old-running': { id: 'old-running', type: 'b', status: 'running', createdAt: old, updatedAt: old, heartbeat: old },
          'recent': { id: 'recent', type: 'c', status: 'completed', createdAt: recent, updatedAt: recent, heartbeat: recent },
        },
      })
      const removed = await cleanupOldJobs()
      expect(removed).toBe(1)
    })

    it('returns 0 when nothing to clean', async () => {
      const recent = new Date().toISOString()
      mockReadJsonFile.mockResolvedValue({
        jobs: { 'fresh': { id: 'fresh', type: 'a', status: 'completed', createdAt: recent, updatedAt: recent, heartbeat: recent } },
      })
      const removed = await cleanupOldJobs()
      expect(removed).toBe(0)
    })
  })

  describe('readStore fallback', () => {
    it('returns empty store when file does not exist', async () => {
      mockFileExists.mockResolvedValue(false)
      const job = await getJob('any')
      expect(job).toBeNull()
    })

    it('returns empty store when file is corrupt', async () => {
      mockReadJsonFile.mockRejectedValue(new Error('JSON parse error'))
      const job = await getJob('any')
      expect(job).toBeNull()
    })
  })
})

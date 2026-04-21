import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock setup (L1 + L3 only) ───────────────────────────────────────────

const mockSyncQueuesToLate = vi.hoisted(() => vi.fn())
const mockInitConfig = vi.hoisted(() => vi.fn())
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
const mockFindNextSlot = vi.hoisted(() => vi.fn())
const mockGetScheduleCalendar = vi.hoisted(() => vi.fn())
const mockCreateLateApiClient = vi.hoisted(() => vi.fn())
const mockGetIdeasByIds = vi.hoisted(() => vi.fn())
const mockGetAccountId = vi.hoisted(() => vi.fn())
const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
const mockBuildRealignPlan = vi.hoisted(() => vi.fn())
const mockExecuteRealignPlan = vi.hoisted(() => vi.fn())
const mockGetItem = vi.hoisted(() => vi.fn())
const mockApproveItem = vi.hoisted(() => vi.fn())
const mockApproveBulk = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: mockLogger,
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'test-output', LATE_API_KEY: 'test-key' }),
  initConfig: mockInitConfig,
}))

vi.mock('../../../L3-services/queueSync/queueSync.js', () => ({
  syncQueuesToLate: mockSyncQueuesToLate,
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
  getScheduleCalendar: mockGetScheduleCalendar,
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: mockCreateLateApiClient,
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: mockGetAccountId,
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: mockBuildRealignPlan,
  executeRealignPlan: mockExecuteRealignPlan,
}))

vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getItem: mockGetItem,
  approveItem: mockApproveItem,
  approveBulk: mockApproveBulk,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
  fileExistsSync: vi.fn().mockReturnValue(false),
  ensureDirectory: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  getConfigPath: vi.fn().mockReturnValue('C:\\test\\config.json'),
  loadGlobalConfig: vi.fn().mockReturnValue({ credentials: {}, defaults: {} }),
  saveGlobalConfig: vi.fn(),
  setGlobalConfigValue: vi.fn(),
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: vi.fn().mockResolvedValue([]),
  getIdea: vi.fn().mockResolvedValue(null),
  createIdea: vi.fn(),
  updateIdea: vi.fn(),
}))

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  extractClip: vi.fn(),
  burnCaptions: vi.fn(),
  detectSilence: vi.fn(),
  captureFrame: vi.fn(),
  generatePlatformVariants: vi.fn(),
}))

vi.mock('../../../L3-services/diagnostics/diagnostics.js', () => ({
  getFFmpegPath: vi.fn().mockReturnValue('ffmpeg'),
  getFFprobePath: vi.fn().mockReturnValue('ffprobe'),
}))

// ── Imports after mocks ─────────────────────────────────────────────────

import { runSyncQueues } from '../../../L7-app/commands/syncQueues.js'
import { runRealign } from '../../../L7-app/commands/realign.js'
import { runReschedule } from '../../../L7-app/commands/reschedule.js'
import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'
import { createVidPipe } from '../../../L7-app/sdk/VidPipeSDK.js'
import express from 'express'
import request from 'supertest'
import { createRouter } from '../../../L7-app/review/routes.js'

// ── Helpers ─────────────────────────────────────────────────────────────

function makeSyncResult(overrides: Partial<{
  created: string[]
  updated: string[]
  deleted: string[]
  unchanged: string[]
  errors: Array<{ queueName: string; error: string }>
}> = {}) {
  return {
    created: [],
    updated: [],
    deleted: [],
    unchanged: [],
    errors: [],
    ...overrides,
  }
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

// ── runSyncQueues ───────────────────────────────────────────────────────

describe('runSyncQueues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())
  })

  it('delegates to syncQueuesToLate with default options', async () => {
    await runSyncQueues()

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockSyncQueuesToLate).toHaveBeenCalledWith({
      reshuffle: undefined,
      dryRun: undefined,
      deleteOrphans: undefined,
    })
  })

  it('passes reshuffle flag through', async () => {
    await runSyncQueues({ reshuffle: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffle: true }),
    )
  })

  it('passes dryRun flag through and logs dry-run notice', async () => {
    await runSyncQueues({ dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    )
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('DRY RUN'),
    )
  })

  it('passes deleteOrphans flag through', async () => {
    await runSyncQueues({ deleteOrphans: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ deleteOrphans: true }),
    )
  })

  it('logs created, updated, deleted, and unchanged counts', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({
      created: ['tiktok-short', 'youtube-main'],
      updated: ['instagram-short'],
      deleted: ['x-medium'],
      unchanged: ['linkedin-short'],
    }))

    await runSyncQueues()

    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Created 2'))
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Updated 1'))
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Deleted 1'))
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Unchanged: 1'))
  })

  it('logs errors from sync result', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({
      errors: [{ queueName: 'tiktok-short', error: 'API timeout' }],
    }))

    await runSyncQueues()

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('tiktok-short'),
    )
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('API timeout'),
    )
  })

  it('logs total queues processed', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({
      created: ['a'],
      updated: ['b'],
      deleted: ['c'],
      unchanged: ['d', 'e'],
    }))

    await runSyncQueues()

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('5 queues processed'),
    )
  })
})

// ── Queue preview in next-slot endpoint ─────────────────────────────────

describe('GET /api/schedule/next-slot/:platform — queue preview', () => {
  let app: ReturnType<typeof buildApp>

  beforeEach(() => {
    vi.clearAllMocks()
    app = buildApp()
    mockGetQueueId.mockResolvedValue(null)
    mockFindNextSlot.mockResolvedValue('2026-03-01T10:00:00-06:00')
    mockGetIdeasByIds.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
    mockCreateLateApiClient.mockReturnValue({
      async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' as const } },
      async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
      async getScheduledPosts() { return [] },
      async listAccounts() { return [] },
      async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
      async previewQueue() { return { profileId: 'p1', count: 0, slots: [] } },
    })
  })

  it('returns queue-based slot when queue preview succeeds', async () => {
    mockGetQueueId.mockResolvedValue('queue-123')
    mockGetProfileId.mockResolvedValue('profile-abc')
    mockCreateLateApiClient.mockReturnValue({
      async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' as const } },
      async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
      async getScheduledPosts() { return [] },
      async listAccounts() { return [] },
      async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
      previewQueue: vi.fn().mockResolvedValue({
        profileId: 'profile-abc',
        queueId: 'queue-123',
        count: 1,
        slots: ['2026-04-01T18:00:00-05:00'],
      }),
    })

    const res = await request(app).get('/api/schedule/next-slot/tiktok')
    expect(res.status).toBe(200)
    expect(res.body.platform).toBe('tiktok')
    expect(res.body.nextSlot).toBe('2026-04-01T18:00:00-05:00')
    expect(res.body.source).toBe('queue')
  })

  it('falls back to local slot when no queueId found', async () => {
    mockGetQueueId.mockResolvedValue(null)

    const res = await request(app).get('/api/schedule/next-slot/youtube')
    expect(res.status).toBe(200)
    expect(res.body.platform).toBe('youtube')
    expect(res.body.nextSlot).toBe('2026-03-01T10:00:00-06:00')
    expect(res.body.source).toBeUndefined()
  })

  it('falls back to local slot when queue preview throws', async () => {
    mockGetQueueId.mockResolvedValue('queue-456')
    mockGetProfileId.mockRejectedValue(new Error('Late API unavailable'))

    const res = await request(app).get('/api/schedule/next-slot/instagram')
    expect(res.status).toBe(200)
    expect(res.body.platform).toBe('instagram')
    expect(res.body.nextSlot).toBe('2026-03-01T10:00:00-06:00')
    expect(res.body.source).toBeUndefined()
  })

  it('falls back to local slot when preview returns empty slots', async () => {
    mockGetQueueId.mockResolvedValue('queue-789')
    mockGetProfileId.mockResolvedValue('profile-xyz')
    mockCreateLateApiClient.mockReturnValue({
      async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' as const } },
      async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
      async getScheduledPosts() { return [] },
      async listAccounts() { return [] },
      async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
      previewQueue: vi.fn().mockResolvedValue({
        profileId: 'profile-xyz',
        count: 0,
        slots: [],
      }),
    })

    const res = await request(app).get('/api/schedule/next-slot/linkedin')
    expect(res.status).toBe(200)
    expect(res.body.platform).toBe('linkedin')
    expect(res.body.nextSlot).toBe('2026-03-01T10:00:00-06:00')
    expect(res.body.source).toBeUndefined()
  })
})

// ── runRealign --queue path (lines 45-62) ───────────────────────────────

describe('runRealign --queue path', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('delegates to syncQueuesToLate with reshuffle when queue option set', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({ updated: ['q1', 'q2'] }))

    await runRealign({ queue: true })

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockSyncQueuesToLate).toHaveBeenCalledWith({ reshuffle: true, dryRun: undefined })
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('2 queues reshuffled'))
  })

  it('passes dryRun flag through queue reshuffle', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())

    await runRealign({ queue: true, dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith({ reshuffle: true, dryRun: true })
    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('DRY RUN')
  })

  it('displays errors from queue reshuffle', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({
      errors: [{ queueName: 'tiktok-short', error: 'Timeout' }],
    }))

    await runRealign({ queue: true })

    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('tiktok-short')
    expect(output).toContain('Timeout')
  })

  it('does not call buildRealignPlan in queue mode', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())

    await runRealign({ queue: true })

    expect(mockBuildRealignPlan).not.toHaveBeenCalled()
  })
})

// ── runReschedule --queue path (lines 37-43) ────────────────────────────

describe('runReschedule --queue path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())
  })

  it('delegates to syncQueuesToLate with reshuffle in queue mode', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult({ updated: ['q1'] }))

    await runReschedule({ queue: true })

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockSyncQueuesToLate).toHaveBeenCalledWith({ reshuffle: true, dryRun: undefined })
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Queue reshuffle complete'))
  })

  it('passes dryRun through in queue mode', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())

    await runReschedule({ queue: true, dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith({ reshuffle: true, dryRun: true })
  })

  it('returns early without calling loadScheduleConfig', async () => {
    mockSyncQueuesToLate.mockResolvedValue(makeSyncResult())

    await runReschedule({ queue: true })

    expect(mockLoadScheduleConfig).not.toHaveBeenCalled()
  })
})

// ── enqueueApproval — queue-based scheduling (lines 166-269) ────────────

describe('enqueueApproval — queue-based scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
    mockGetAccountId.mockResolvedValue('acc-tiktok-123')
    mockFileExists.mockResolvedValue(true)
    mockGetIdeasByIds.mockResolvedValue([])
    mockApproveItem.mockResolvedValue(undefined)
    mockApproveBulk.mockResolvedValue(undefined)
    mockFindNextSlot.mockResolvedValue('2026-03-01T10:00:00-06:00')
    mockGetQueueId.mockResolvedValue(null)
  })

  function makeApprovalItem(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      metadata: {
        id,
        platform: 'tiktok',
        accountId: 'acc-tt',
        clipType: 'short',
        sourceVideo: '/test/v.mp4',
        sourceClip: null,
        sourceMediaPath: '/test/media.mp4',
        hashtags: [],
        links: [],
        characterCount: 50,
        platformCharLimit: 2200,
        suggestedSlot: null,
        scheduledFor: null,
        status: 'pending_review',
        latePostId: null,
        publishedUrl: null,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        publishedAt: null,
        ...overrides,
      },
      postContent: 'Queue test #post',
      hasMedia: true,
      mediaPath: '/test/media.mp4',
      thumbnailPath: null,
      folderPath: `/test/publish-queue/${id}`,
    }
  }

  it('uses queue scheduling when getQueueId returns a queueId', async () => {
    mockGetQueueId.mockResolvedValue('queue-tiktok-short')
    mockGetProfileId.mockResolvedValue('profile-abc')
    const mockClient = {
      uploadMedia: vi.fn().mockResolvedValue({ url: 'https://cdn/media.mp4', type: 'video' as const }),
      createPost: vi.fn().mockResolvedValue({ _id: 'late-q1', scheduledFor: '2026-03-02T19:00:00-06:00' }),
    }
    mockCreateLateApiClient.mockReturnValue(mockClient)
    mockGetItem.mockResolvedValue(makeApprovalItem('q-item'))

    const result = await enqueueApproval(['q-item'])

    expect(result.scheduled).toBe(1)
    expect(result.results[0].success).toBe(true)
    expect(result.results[0].latePostId).toBe('late-q1')
    expect(mockClient.createPost).toHaveBeenCalledWith(
      expect.objectContaining({
        queueId: 'queue-tiktok-short',
        queuedFromProfile: 'profile-abc',
      }),
    )
    // scheduledFor should NOT be set in queue mode
    const args = mockClient.createPost.mock.calls[0][0]
    expect(args.scheduledFor).toBeUndefined()
    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('falls back to local slot when no queueId found', async () => {
    mockGetQueueId.mockResolvedValue(null)
    const mockClient = {
      uploadMedia: vi.fn().mockResolvedValue({ url: 'https://cdn/media.mp4', type: 'video' as const }),
      createPost: vi.fn().mockResolvedValue({ _id: 'late-local' }),
    }
    mockCreateLateApiClient.mockReturnValue(mockClient)
    mockGetItem.mockResolvedValue(makeApprovalItem('local-item'))

    const result = await enqueueApproval(['local-item'])

    expect(result.scheduled).toBe(1)
    expect(mockFindNextSlot).toHaveBeenCalled()
    const args = mockClient.createPost.mock.calls[0][0]
    expect(args.scheduledFor).toBe('2026-03-01T10:00:00-06:00')
    expect(args.queueId).toBeUndefined()
    expect(args.queuedFromProfile).toBeUndefined()
  })
})

// ── VidPipeSDK findNextSlot queue path (lines 787-803) ──────────────────

describe('VidPipeSDK schedule.findNextSlot — queue preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInitConfig.mockReturnValue({})
    mockGetQueueId.mockResolvedValue(null)
    mockGetProfileId.mockResolvedValue(null)
    mockFindNextSlot.mockResolvedValue('2026-03-01T10:00:00-06:00')
    mockCreateLateApiClient.mockReturnValue({
      previewQueue: vi.fn().mockResolvedValue({ slots: [] }),
    })
  })

  it('returns queue-based slot when preview succeeds', async () => {
    mockGetQueueId.mockResolvedValue('queue-tiktok-short')
    mockGetProfileId.mockResolvedValue('profile-abc')
    mockCreateLateApiClient.mockReturnValue({
      previewQueue: vi.fn().mockResolvedValue({
        profileId: 'profile-abc',
        queueId: 'queue-tiktok-short',
        count: 1,
        slots: ['2026-04-01T18:00:00-05:00'],
      }),
    })

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('tiktok', 'short')

    expect(result).toBe('2026-04-01T18:00:00-05:00')
    expect(mockGetQueueId).toHaveBeenCalledWith('tiktok', 'short')
    expect(mockGetProfileId).toHaveBeenCalled()
    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('falls back to local slot when preview returns empty slots', async () => {
    mockGetQueueId.mockResolvedValue('queue-empty')
    mockGetProfileId.mockResolvedValue('profile-xyz')
    mockCreateLateApiClient.mockReturnValue({
      previewQueue: vi.fn().mockResolvedValue({ slots: [] }),
    })

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('tiktok', 'short')

    expect(result).toBe('2026-03-01T10:00:00-06:00')
    expect(mockFindNextSlot).toHaveBeenCalled()
  })

  it('falls back to local slot when queue preview throws', async () => {
    mockGetQueueId.mockResolvedValue('queue-broken')
    mockGetProfileId.mockRejectedValue(new Error('API error'))

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('tiktok', 'short')

    expect(result).toBe('2026-03-01T10:00:00-06:00')
    expect(mockFindNextSlot).toHaveBeenCalled()
  })

  it('uses clipType default of short when clipType is undefined', async () => {
    mockGetQueueId.mockResolvedValue('queue-default')
    mockGetProfileId.mockResolvedValue('profile-def')
    mockCreateLateApiClient.mockReturnValue({
      previewQueue: vi.fn().mockResolvedValue({
        count: 1,
        slots: ['2026-05-01T10:00:00-05:00'],
      }),
    })

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('youtube')

    expect(result).toBe('2026-05-01T10:00:00-05:00')
    expect(mockGetQueueId).toHaveBeenCalledWith('youtube', 'short')
  })
})

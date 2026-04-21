import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockGetQueueId = vi.hoisted(() => vi.fn())
const mockGetProfileId = vi.hoisted(() => vi.fn())
const mockPreviewQueue = vi.hoisted(() => vi.fn())
const mockFindNextSlot = vi.hoisted(() => vi.fn())
const mockGetIdeasByIds = vi.hoisted(() => vi.fn())

// ── Mocks (L0, L1, L3 — valid for L7 unit tests) ───────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
  initConfig: () => ({ OUTPUT_DIR: 'C:\\test-output', LATE_API_KEY: 'test-key' }),
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    async uploadMedia() { return { url: 'https://test.com/media.mp4', type: 'video' } },
    async createPost() { return { _id: 'test-post-id', status: 'scheduled' } },
    async getScheduledPosts() { return [] },
    async listAccounts() { return [{ id: 'acc-1', platform: 'tiktok', name: 'Test Account' }] },
    async listProfiles() { return [{ id: 'profile-1', name: 'Test Profile' }] },
    previewQueue: mockPreviewQueue,
  }),
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
  getScheduleCalendar: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: async () => 'test-account-id',
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: async () => ({ timezone: 'America/Chicago', platforms: {} }),
}))

vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getPendingItems: vi.fn().mockResolvedValue([]),
  getGroupedPendingItems: vi.fn().mockResolvedValue([]),
  getItem: vi.fn().mockResolvedValue(null),
  updateItem: vi.fn().mockResolvedValue(undefined),
  rejectItem: vi.fn().mockResolvedValue(undefined),
}))

// ── Import after mocks ─────────────────────────────────────────────────

import express from 'express'
import request from 'supertest'
import { createRouter } from '../../../L7-app/review/routes.js'

// ── Test helpers ────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(createRouter())
  return app
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('GET /api/schedule/next-slot/:platform — queue preview branch', () => {
  let app: ReturnType<typeof express>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFindNextSlot.mockResolvedValue('2026-02-15T19:00:00-06:00')
    mockGetIdeasByIds.mockResolvedValue([])
    app = buildApp()
  })

  it('returns queue slot when previewQueue succeeds', async () => {
    mockGetQueueId.mockResolvedValue('q-tiktok-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockResolvedValue({ slots: ['2026-04-08T15:00:00Z'] })

    const res = await request(app).get('/api/schedule/next-slot/tiktok')

    expect(res.status).toBe(200)
    expect(res.body.source).toBe('queue')
    expect(res.body.nextSlot).toBe('2026-04-08T15:00:00Z')
    expect(res.body.platform).toBe('tiktok')
    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('falls back to local when previewQueue returns empty slots', async () => {
    mockGetQueueId.mockResolvedValue('q-youtube-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockResolvedValue({ slots: [] })

    const res = await request(app).get('/api/schedule/next-slot/youtube?clipType=short')

    expect(res.status).toBe(200)
    expect(res.body.nextSlot).toBe('2026-02-15T19:00:00-06:00')
    expect(res.body.platform).toBe('youtube')
    // Fallback path does not include source: 'queue'
    expect(res.body.source).not.toBe('queue')
    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short')
  })

  it('falls back to local when previewQueue throws', async () => {
    mockGetQueueId.mockResolvedValue('q-instagram-short')
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockRejectedValue(new Error('API timeout'))

    const res = await request(app).get('/api/schedule/next-slot/instagram')

    expect(res.status).toBe(200)
    expect(res.body.nextSlot).toBe('2026-02-15T19:00:00-06:00')
    expect(res.body.platform).toBe('instagram')
    expect(mockFindNextSlot).toHaveBeenCalledWith('instagram', undefined)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RealignPlan } from '../../../../L3-services/scheduler/realign.js'

// ── Mock L1 infrastructure only ────────────────────────────────────────

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

vi.mock('../../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-integration-key' }),
  initConfig: vi.fn(),
}))

// Mock fetchRaw (L1 infra) to intercept real HTTP calls
const mockFetchRaw = vi.hoisted(() => vi.fn())
vi.mock('../../../../L1-infra/http/httpClient.js', () => ({
  fetchRaw: mockFetchRaw,
}))

import { executeRealignPlan } from '../../../../L3-services/scheduler/realign.js'

// ── Helpers ────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Map<string, string>(),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('L3 Integration: executeRealignPlan schedulePost flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends PUT with isDraft: false when scheduling a post', async () => {
    mockFetchRaw.mockResolvedValue(jsonResponse({
      post: { _id: 'p1', status: 'scheduled', content: 'test', platforms: [], createdAt: '', updatedAt: '' },
    }))

    const plan: RealignPlan = {
      posts: [{
        post: {
          _id: 'p1',
          content: 'Integration test post',
          status: 'draft',
          platforms: [{ platform: 'twitter', accountId: 'a1' }],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        platform: 'twitter',
        clipType: 'short',
        oldScheduledFor: null,
        newScheduledFor: '2026-04-01T10:00:00Z',
      }],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 1,
    }

    const result = await executeRealignPlan(plan)

    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)

    // Verify the PUT body contains isDraft: false (from schedulePost)
    const putCall = mockFetchRaw.mock.calls.find(
      ([url, opts]: [string, RequestInit]) => opts.method === 'PUT',
    )
    expect(putCall).toBeDefined()
    const body = JSON.parse(putCall![1].body as string)
    expect(body).toEqual({
      scheduledFor: '2026-04-01T10:00:00Z',
      isDraft: false,
    })
  })

  it('returns zeros for empty plan', async () => {
    const plan: RealignPlan = {
      posts: [],
      toCancel: [],
      skipped: 0,
      unmatched: 0,
      totalFetched: 0,
    }

    const result = await executeRealignPlan(plan)

    expect(result).toEqual({ updated: 0, cancelled: 0, failed: 0, errors: [] })
  })
})

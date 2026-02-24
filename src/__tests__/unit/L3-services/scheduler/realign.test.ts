import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LatePost } from '../../../../L2-clients/late/lateApi.js'
import type { RealignPlan } from '../../../../L3-services/scheduler/realign.js'

// ── Mocks (L2 only) ───────────────────────────────────────────────────

const mockUpdatePost = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())
vi.mock('../../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    updatePost(...args: unknown[]) { return mockUpdatePost(...args) }
    schedulePost(...args: unknown[]) { return mockSchedulePost(...args) }
  },
}))

import { executeRealignPlan } from '../../../../L3-services/scheduler/realign.js'

// ── Helpers ────────────────────────────────────────────────────────────

function makePost(overrides: Partial<LatePost> = {}): LatePost {
  return {
    _id: 'post-1',
    content: 'Test post content for unit test',
    status: 'scheduled',
    platforms: [{ platform: 'twitter', accountId: 'acc-1' }],
    scheduledFor: '2026-03-01T12:00:00Z',
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
    ...overrides,
  }
}

function makePlan(overrides: Partial<RealignPlan> = {}): RealignPlan {
  return {
    posts: [],
    toCancel: [],
    skipped: 0,
    unmatched: 0,
    totalFetched: 0,
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('executeRealignPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdatePost.mockResolvedValue(makePost())
    mockSchedulePost.mockResolvedValue(makePost())
  })

  it('schedules posts via schedulePost(id, scheduledFor) — not updatePost with status', async () => {
    const post = makePost({ _id: 'p-update', status: 'draft' })
    const plan = makePlan({
      posts: [{
        post,
        platform: 'twitter',
        clipType: 'short',
        oldScheduledFor: '2026-03-01T12:00:00Z',
        newScheduledFor: '2026-03-05T14:00:00Z',
      }],
    })

    await executeRealignPlan(plan)

    expect(mockSchedulePost).toHaveBeenCalledWith('p-update', '2026-03-05T14:00:00Z')
    // Regression: must NOT use updatePost with status: 'scheduled'
    expect(mockUpdatePost).not.toHaveBeenCalledWith(
      'p-update',
      expect.objectContaining({ status: 'scheduled' }),
    )
  })

  it('cancels posts with { status: "cancelled" }', async () => {
    const post = makePost({ _id: 'p-cancel' })
    const plan = makePlan({
      toCancel: [{
        post,
        platform: 'twitter',
        clipType: 'short',
        reason: 'no matching slot',
      }],
    })

    await executeRealignPlan(plan)

    expect(mockUpdatePost).toHaveBeenCalledWith('p-cancel', { status: 'cancelled' })
  })

  it('updates draft posts in-place via schedulePost (not delete + recreate)', async () => {
    const draftPost = makePost({ _id: 'p-draft', status: 'draft', isDraft: true })
    const plan = makePlan({
      posts: [{
        post: draftPost,
        platform: 'twitter',
        clipType: 'medium-clip',
        oldScheduledFor: null,
        newScheduledFor: '2026-03-10T08:00:00Z',
      }],
    })

    await executeRealignPlan(plan)

    // Single schedulePost call — no delete/create flow
    expect(mockSchedulePost).toHaveBeenCalledTimes(1)
    expect(mockSchedulePost).toHaveBeenCalledWith('p-draft', '2026-03-10T08:00:00Z')
  })

  it('returns correct counts for mixed operations', async () => {
    const plan = makePlan({
      toCancel: [
        { post: makePost({ _id: 'c1' }), platform: 'twitter', clipType: 'short', reason: 'dup' },
      ],
      posts: [
        { post: makePost({ _id: 'u1' }), platform: 'twitter', clipType: 'short', oldScheduledFor: null, newScheduledFor: '2026-03-06T08:00:00Z' },
        { post: makePost({ _id: 'u2' }), platform: 'twitter', clipType: 'short', oldScheduledFor: null, newScheduledFor: '2026-03-06T14:00:00Z' },
      ],
    })

    const result = await executeRealignPlan(plan)

    expect(result).toEqual({ updated: 2, cancelled: 1, failed: 0, errors: [] })
  })

  it('records failures without throwing', async () => {
    mockSchedulePost.mockRejectedValueOnce(new Error('API down'))

    const plan = makePlan({
      posts: [{
        post: makePost({ _id: 'p-fail' }),
        platform: 'twitter',
        clipType: 'short',
        oldScheduledFor: null,
        newScheduledFor: '2026-03-07T08:00:00Z',
      }],
    })

    const result = await executeRealignPlan(plan)

    expect(result.failed).toBe(1)
    expect(result.errors).toEqual([{ postId: 'p-fail', error: 'API down' }])
  })
})

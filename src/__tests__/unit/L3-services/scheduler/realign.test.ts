import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LatePost } from '../../../../L2-clients/late/lateApi.js'
import type { RealignPlan, ClipTypeMaps } from '../../../../L3-services/scheduler/realign.js'
import type { ScheduleContext } from '../../../../L3-services/scheduler/scheduler.js'

// Verify ScheduleContext includes ideaPublishByMap (structural test)
const _typeCheck: ScheduleContext['ideaPublishByMap'] = new Map<string, number>()

// ── Mocks (L2 only) ───────────────────────────────────────────────────

const mockUpdatePost = vi.hoisted(() => vi.fn())
const mockLateSchedulePost = vi.hoisted(() => vi.fn())
const mockListPosts = vi.hoisted(() => vi.fn())
vi.mock('../../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    updatePost(...args: unknown[]) { return mockUpdatePost(...args) }
    schedulePost(...args: unknown[]) { return mockLateSchedulePost(...args) }
    listPosts(...args: unknown[]) { return mockListPosts(...args) }
  },
}))

// ── Mock scheduler.js exports ─────────────────────────────────────────

const mockSchedulerSchedulePost = vi.hoisted(() => vi.fn())
const mockBuildBookedMap = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/scheduler/scheduler.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    schedulePost: (...args: unknown[]) => mockSchedulerSchedulePost(...args),
    buildBookedMap: (...args: unknown[]) => mockBuildBookedMap(...args),
  }
})

// ── Mock scheduleConfig.js ────────────────────────────────────────────

const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
const mockGetPlatformSchedule = vi.hoisted(() => vi.fn())
const mockGetDisplacementConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: (...args: unknown[]) => mockLoadScheduleConfig(...args),
  getPlatformSchedule: (...args: unknown[]) => mockGetPlatformSchedule(...args),
  getDisplacementConfig: (...args: unknown[]) => mockGetDisplacementConfig(...args),
}))

// ── Mock postStore.js ─────────────────────────────────────────────────

const mockGetPublishedItems = vi.hoisted(() => vi.fn())
vi.mock('../../../../L3-services/postStore/postStore.js', () => ({
  getPublishedItems: () => mockGetPublishedItems(),
}))

// ── Mock logger ───────────────────────────────────────────────────────

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { executeRealignPlan, buildRealignPlan } from '../../../../L3-services/scheduler/realign.js'

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

const MOCK_PLATFORM_CONFIG = { slots: [{ days: ['tue'], time: '09:00', label: 'Tue' }], avoidDays: [] }

// ── Tests ──────────────────────────────────────────────────────────────

describe('executeRealignPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdatePost.mockResolvedValue(makePost())
    mockLateSchedulePost.mockResolvedValue(makePost())
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

    expect(mockLateSchedulePost).toHaveBeenCalledWith('p-update', '2026-03-05T14:00:00Z')
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
    expect(mockLateSchedulePost).toHaveBeenCalledTimes(1)
    expect(mockLateSchedulePost).toHaveBeenCalledWith('p-draft', '2026-03-10T08:00:00Z')
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
    mockLateSchedulePost.mockRejectedValueOnce(new Error('API down'))

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

// ── buildRealignPlan tests ────────────────────────────────────────────

describe('buildRealignPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadScheduleConfig.mockResolvedValue({ timezone: 'UTC' })
    mockGetDisplacementConfig.mockReturnValue({ enabled: true, canDisplace: 'non-idea-only' })
    mockBuildBookedMap.mockResolvedValue(new Map())
    mockGetPublishedItems.mockResolvedValue([])
    mockListPosts.mockResolvedValue([])
    mockGetPlatformSchedule.mockReturnValue(MOCK_PLATFORM_CONFIG)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty plan when no posts exist', async () => {
    mockListPosts.mockResolvedValue([])

    const plan = await buildRealignPlan()

    expect(plan).toEqual({ posts: [], toCancel: [], skipped: 0, unmatched: 0, totalFetched: 0 })
  })

  it('tags posts by latePostId from clipTypeMaps', async () => {
    const post = makePost({ _id: 'p-known', content: 'Known clip', status: 'scheduled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-known', 'medium-clip']]),
      byContent: new Map(),
    }

    mockSchedulerSchedulePost.mockResolvedValue('2026-03-04T09:00:00+00:00')

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.totalFetched).toBe(1)
    expect(plan.unmatched).toBe(0)
  })

  it('falls back to content-based clipType matching', async () => {
    const post = makePost({ _id: 'p-content', content: 'My cool video content', status: 'scheduled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map(),
      byContent: new Map([['twitter::my cool video content', 'short']]),
    }

    mockSchedulerSchedulePost.mockResolvedValue('2026-03-04T09:00:00+00:00')

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.totalFetched).toBe(1)
    expect(plan.unmatched).toBe(0)
  })

  it('defaults to short and increments unmatched when no clipType map match', async () => {
    const post = makePost({ _id: 'p-unmatch', content: 'Unknown content', status: 'scheduled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map(),
      byContent: new Map(),
    }

    mockSchedulerSchedulePost.mockResolvedValue('2026-03-04T09:00:00+00:00')

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.unmatched).toBe(1)
    expect(plan.totalFetched).toBe(1)
  })

  it('cancels posts when no platform schedule config exists', async () => {
    const post = makePost({ _id: 'p-noconfig', status: 'scheduled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )
    mockGetPlatformSchedule.mockReturnValue(null)

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-noconfig', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.toCancel).toHaveLength(1)
    expect(plan.toCancel[0].reason).toContain('No schedule slots')
  })

  it('cancels posts when schedulePost returns null (no available slot)', async () => {
    const post = makePost({ _id: 'p-noslot', status: 'draft' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'draft' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue(null)

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-noslot', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.toCancel).toHaveLength(1)
    expect(plan.toCancel[0].reason).toContain('No available slot')
  })

  it('assigns new slots to posts via schedulePost and records them', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-02T00:00:00Z'))

    const post = makePost({ _id: 'p-assign', status: 'draft', scheduledFor: undefined })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'draft' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue('2026-03-04T09:00:00+00:00')

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-assign', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.posts).toHaveLength(1)
    expect(plan.posts[0].newScheduledFor).toBe('2026-03-04T09:00:00+00:00')
    expect(plan.posts[0].oldScheduledFor).toBeNull()
    expect(mockSchedulerSchedulePost).toHaveBeenCalledOnce()
  })

  it('sorts idea-linked posts first for priority scheduling', async () => {
    const nonIdeaPost = makePost({ _id: 'p-normal', status: 'draft', scheduledFor: undefined })
    const ideaPost = makePost({ _id: 'p-idea', status: 'draft', scheduledFor: undefined })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'draft' ? [nonIdeaPost, ideaPost] : [],
    )

    // Mark the idea post as idea-linked via bookedMap
    const bookedMap = new Map<number, { scheduledFor: string; source: string; postId: string; platform: string; ideaLinked: boolean }>()
    bookedMap.set(1000, { scheduledFor: '2026-03-05T09:00:00Z', source: 'late', postId: 'p-idea', platform: 'x', ideaLinked: true })
    mockBuildBookedMap.mockResolvedValue(bookedMap)

    const calls: string[] = []
    mockSchedulerSchedulePost.mockImplementation((_cfg: unknown, _ms: unknown, isIdea: boolean, label: string) => {
      calls.push(`${label}:idea=${isIdea}`)
      return '2026-03-04T09:00:00+00:00'
    })

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-normal', 'short'], ['p-idea', 'short']]),
      byContent: new Map(),
    }

    await buildRealignPlan({ clipTypeMaps })

    // The idea-linked post should be scheduled first
    expect(calls.length).toBe(2)
    expect(calls[0]).toContain('idea=true')
  })

  it('frees current slot from bookedMap before reassigning', async () => {
    const currentMs = new Date('2026-03-03T09:00:00Z').getTime()
    const bookedMap = new Map<number, { scheduledFor: string; source: string; postId: string; platform: string; ideaLinked: boolean }>()
    bookedMap.set(currentMs, { scheduledFor: '2026-03-03T09:00:00Z', source: 'late', postId: 'p-free', platform: 'x', ideaLinked: false })
    mockBuildBookedMap.mockResolvedValue(bookedMap)

    const post = makePost({ _id: 'p-free', status: 'draft', scheduledFor: '2026-03-03T09:00:00Z' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'draft' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue('2026-03-05T09:00:00+00:00')

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-free', 'short']]),
      byContent: new Map(),
    }

    await buildRealignPlan({ clipTypeMaps })

    // Verify the post's old slot was freed (bookedMap should have been modified)
    expect(bookedMap.has(currentMs)).toBe(false)
  })

  it('does not export buildPrioritizedRealignPlan (removed)', async () => {
    const realignModule = await import('../../../../L3-services/scheduler/realign.js')
    expect('buildPrioritizedRealignPlan' in realignModule).toBe(false)
  })

  it('skips scheduled posts already on a valid slot (isOnValidSlot true)', async () => {
    // 2026-03-03 is a Tuesday — matches MOCK_PLATFORM_CONFIG { days: ['tue'], time: '09:00' }
    const post = makePost({
      _id: 'p-valid-slot',
      status: 'scheduled',
      scheduledFor: '2026-03-03T09:00:00+00:00',
    })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-valid-slot', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.skipped).toBe(1)
    expect(plan.posts).toHaveLength(0)
    expect(plan.toCancel).toHaveLength(0)
    // schedulePost should NOT be called — post was already on a valid slot
    expect(mockSchedulerSchedulePost).not.toHaveBeenCalled()
  })

  it('reschedules posts not on a valid slot (wrong day of week)', async () => {
    // 2026-03-02 is a Monday — not in MOCK_PLATFORM_CONFIG days: ['tue']
    const post = makePost({
      _id: 'p-wrong-day',
      status: 'scheduled',
      scheduledFor: '2026-03-02T09:00:00+00:00',
    })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue('2026-03-03T09:00:00+00:00')

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-wrong-day', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.posts).toHaveLength(1)
    expect(plan.posts[0].oldScheduledFor).toBe('2026-03-02T09:00:00+00:00')
    expect(plan.posts[0].newScheduledFor).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulerSchedulePost).toHaveBeenCalledOnce()
  })

  it('reschedules posts not on a valid slot (wrong time)', async () => {
    // Tuesday at 15:00 — right day but wrong time (config has 09:00)
    const post = makePost({
      _id: 'p-wrong-time',
      status: 'scheduled',
      scheduledFor: '2026-03-03T15:00:00+00:00',
    })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue('2026-03-10T09:00:00+00:00')

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-wrong-time', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.posts).toHaveLength(1)
    expect(plan.posts[0].newScheduledFor).toBe('2026-03-10T09:00:00+00:00')
  })

  it('reschedules posts on avoidDays even if time matches', async () => {
    // Tuesday at 09:00 — valid day/time BUT avoidDays includes 'tue'
    const post = makePost({
      _id: 'p-avoid',
      status: 'scheduled',
      scheduledFor: '2026-03-03T09:00:00+00:00',
    })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )
    mockGetPlatformSchedule.mockReturnValue({
      slots: [{ days: ['tue'], time: '09:00', label: 'Tue' }],
      avoidDays: ['tue'],
    })
    mockSchedulerSchedulePost.mockResolvedValue('2026-03-05T09:00:00+00:00')

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-avoid', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    // avoidDays rejects the slot → post is rescheduled
    expect(plan.posts).toHaveLength(1)
    expect(mockSchedulerSchedulePost).toHaveBeenCalledOnce()
  })

  it('skips scheduled post when schedulePost returns same slot (unchanged)', async () => {
    // Post is on a Monday (invalid slot), gets rescheduled, but schedulePost
    // returns the exact same datetime → detected as unchanged → skipped
    const sameSlot = '2026-03-02T12:00:00+00:00'
    const post = makePost({
      _id: 'p-unchanged',
      status: 'scheduled',
      scheduledFor: sameSlot,
    })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'scheduled' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue(sameSlot)

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-unchanged', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.skipped).toBe(1)
    expect(plan.posts).toHaveLength(0)
  })

  it('skips already-cancelled posts when no platform config exists', async () => {
    const post = makePost({ _id: 'p-already-cancelled', status: 'cancelled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'cancelled' ? [post] : [],
    )
    mockGetPlatformSchedule.mockReturnValue(null)

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-already-cancelled', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    // Already cancelled → should NOT be added to toCancel again
    expect(plan.toCancel).toHaveLength(0)
  })

  it('skips already-cancelled posts when schedulePost returns null', async () => {
    const post = makePost({ _id: 'p-cancel-noslot', status: 'cancelled' })
    mockListPosts.mockImplementation(async ({ status }: { status: string }) =>
      status === 'cancelled' ? [post] : [],
    )
    mockSchedulerSchedulePost.mockResolvedValue(null)

    const clipTypeMaps: ClipTypeMaps = {
      byLatePostId: new Map([['p-cancel-noslot', 'short']]),
      byContent: new Map(),
    }

    const plan = await buildRealignPlan({ clipTypeMaps })

    expect(plan.toCancel).toHaveLength(0)
  })
})

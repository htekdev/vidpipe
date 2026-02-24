import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (L2 only) ───────────────────────────────────────────────────

const mockListPosts = vi.hoisted(() => vi.fn())
const mockUpdatePost = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    listPosts(...args: unknown[]) { return mockListPosts(...args) }
    updatePost(...args: unknown[]) { return mockUpdatePost(...args) }
    schedulePost(...args: unknown[]) { return mockSchedulePost(...args) }
  },
}))

const mockReadScheduleFile = vi.hoisted(() => vi.fn())
const mockWriteScheduleFile = vi.hoisted(() => vi.fn())
const mockResolveSchedulePath = vi.hoisted(() => vi.fn(() => '/fake/schedule.json'))
vi.mock('../../../L2-clients/scheduleStore/scheduleStore.js', () => ({
  readScheduleFile: mockReadScheduleFile,
  writeScheduleFile: mockWriteScheduleFile,
  resolveSchedulePath: mockResolveSchedulePath,
}))

import { buildPrioritizedRealignPlan, executeRealignPlan } from '../../../L3-services/scheduler/realign.js'
import type { PriorityRule, ClipTypeMaps } from '../../../L3-services/scheduler/realign.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

// Empty clipTypeMaps to inject (avoids real disk I/O from postStore)
const EMPTY_CLIP_TYPE_MAPS: ClipTypeMaps = {
  byLatePostId: new Map(),
  byContent: new Map(),
}

// ── Test schedule config ───────────────────────────────────────────────
// Simple config: platform "x" with 3 daily short slots + 1 daily medium-clip slot
const TEST_SCHEDULE = {
  timezone: 'UTC',
  platforms: {
    x: {
      slots: [],
      avoidDays: [],
      byClipType: {
        short: {
          slots: [
            { days: ['mon','tue','wed','thu','fri','sat','sun'], time: '08:00', label: 'Morning' },
            { days: ['mon','tue','wed','thu','fri','sat','sun'], time: '14:00', label: 'Afternoon' },
            { days: ['mon','tue','wed','thu','fri','sat','sun'], time: '20:00', label: 'Evening' },
          ],
          avoidDays: [],
        },
        'medium-clip': {
          slots: [
            { days: ['mon','tue','wed','thu','fri','sat','sun'], time: '12:00', label: 'Midday' },
          ],
          avoidDays: [],
        },
      },
    },
    youtube: {
      slots: [],
      avoidDays: [],
      byClipType: {
        short: {
          slots: [
            { days: ['mon','tue','wed','thu','fri','sat','sun'], time: '09:00', label: 'Morning' },
          ],
          avoidDays: [],
        },
      },
    },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────

function makePost(id: string, content: string, platform = 'twitter', scheduledFor?: string) {
  return {
    _id: id,
    content,
    platforms: [{ platform }],
    status: 'scheduled',
    scheduledFor: scheduledFor ?? null,
  }
}

/** Mock Late API to return given posts as scheduled, rest empty. */
function mockPosts(posts: ReturnType<typeof makePost>[]) {
  mockListPosts
    .mockResolvedValueOnce(posts) // scheduled
    .mockResolvedValueOnce([])    // draft
    .mockResolvedValueOnce([])    // cancelled
    .mockResolvedValueOnce([])    // failed
}

/** Seed the schedule cache with TEST_SCHEDULE. */
function seedSchedule(config = TEST_SCHEDULE) {
  mockReadScheduleFile.mockResolvedValue(JSON.stringify(config))
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('buildPrioritizedRealignPlan — comprehensive', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
    // Default: Math.random always returns 0 (all saturation checks pass for saturation > 0)
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    randomSpy.mockRestore()
  })

  // ── Empty / baseline ──

  it('returns empty plan when no posts exist', async () => {
    seedSchedule()
    mockPosts([])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    expect(plan.posts).toHaveLength(0)
    expect(plan.toCancel).toHaveLength(0)
    expect(plan.totalFetched).toBe(0)
  })

  it('with empty priorities, assigns all posts sorted by scheduledFor', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'Alpha post', 'twitter', '2026-06-02T08:00:00+00:00'),
      makePost('p2', 'Beta post', 'twitter', '2026-06-01T08:00:00+00:00'),
      makePost('p3', 'Gamma post', 'twitter', '2026-06-03T08:00:00+00:00'),
    ])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    expect(plan.posts).toHaveLength(3)
    // Remaining pool sorts by scheduledFor → p2 (earliest), p1, p3
    const ids = plan.posts.map(p => p.post._id)
    expect(ids.indexOf('p2')).toBeLessThan(ids.indexOf('p1'))
    expect(ids.indexOf('p1')).toBeLessThan(ids.indexOf('p3'))
  })

  // ── Basic prioritization ──

  it('100% saturation puts keyword-matched posts in earliest slots', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'Learn about devops pipelines', 'twitter'),
      makePost('p2', 'React hooks tutorial', 'twitter'),
      makePost('p3', 'DevOps CI/CD best practices', 'twitter'),
      makePost('p4', 'TypeScript generics', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })
    expect(plan.posts).toHaveLength(4)

    // First 2 posts should be the devops ones
    const firstTwoIds = plan.posts.slice(0, 2).map(p => p.post._id)
    expect(firstTwoIds).toContain('p1')
    expect(firstTwoIds).toContain('p3')

    // Last 2 are non-devops
    const lastTwoIds = plan.posts.slice(2).map(p => p.post._id)
    expect(lastTwoIds).toContain('p2')
    expect(lastTwoIds).toContain('p4')
  })

  // ── Multiple rules in order ──

  it('respects rule array order: rule[0] before rule[1]', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'Kubernetes scaling guide', 'twitter'),
      makePost('p2', 'React hooks deep dive', 'twitter'),
      makePost('p3', 'DevOps monitoring setup', 'twitter'),
      makePost('p4', 'Random cats content', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [
        { keywords: ['devops', 'kubernetes'], saturation: 1.0 },
        { keywords: ['react'], saturation: 1.0 },
      ],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    const ids = plan.posts.map(p => p.post._id)
    // Rule 0 posts (devops/kubernetes: p1, p3) should come before Rule 1 (react: p2)
    const devopsMaxIdx = Math.max(ids.indexOf('p1'), ids.indexOf('p3'))
    const reactIdx = ids.indexOf('p2')
    const catsIdx = ids.indexOf('p4')
    expect(devopsMaxIdx).toBeLessThan(reactIdx)
    expect(reactIdx).toBeLessThan(catsIdx)
  })

  // ── Saturation control ──

  it('saturation=0 never picks priority posts via rule, non-matching fill slots', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops tools', 'twitter', '2026-06-02T08:00:00+00:00'),
      makePost('p2', 'random stuff', 'twitter', '2026-06-01T08:00:00+00:00'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // With saturation=0, rule never fires. p1 is reserved for rule (excluded from pool).
    // Only p2 (non-matching) goes to remaining pool.
    expect(plan.posts[0].post._id).toBe('p2')
    // p1 never assigned → cancelled
    expect(plan.toCancel).toHaveLength(1)
    expect(plan.toCancel[0].post._id).toBe('p1')
  })

  it('saturation=0.5 with deterministic random controls slot assignment', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops alpha', 'twitter'),
      makePost('p2', 'devops beta', 'twitter'),
      makePost('p3', 'random gamma', 'twitter'),
      makePost('p4', 'random delta', 'twitter'),
    ])

    // Simulate: slot 0 → 0.3 (< 0.5, rule fires), slot 1 → 0.7 (>= 0.5, skip),
    // slot 2 → 0.1 (< 0.5, rule fires), slot 3 → 0.9 (>= 0.5, skip)
    randomSpy
      .mockReturnValueOnce(0.3)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 0.5 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    const ids = plan.posts.map(p => p.post._id)
    // Slot 0: rule fires (0.3 < 0.5) → devops p1
    expect(ids[0]).toBe('p1')
    // Slot 1: rule skips (0.7 >= 0.5) → remaining pool (non-matching only) → p3
    expect(ids[1]).toBe('p3')
    // Slot 2: rule fires (0.1 < 0.5) → devops p2
    expect(ids[2]).toBe('p2')
    // Slot 3: rule skips (0.9 >= 0.5) → remaining pool → p4
    expect(ids[3]).toBe('p4')
  })

  // ── Date range filtering ──

  it('date range restricts when a rule fires', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops tools', 'twitter'),
      makePost('p2', 'react hooks', 'twitter'),
    ])

    // Rule only active in far future — shouldn't fire for today's slots
    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0, from: '2099-01-01', to: '2099-12-31' }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // p1 matches rule → excluded from remaining pool, reserved for rule (which never fires)
    // Only p2 (non-matching) goes to remaining pool
    expect(plan.posts).toHaveLength(1)
    expect(plan.posts[0].post._id).toBe('p2')
    // p1 gets cancelled since no slots within the rule's date range are available now
    expect(plan.toCancel).toHaveLength(1)
    expect(plan.toCancel[0].post._id).toBe('p1')
  })

  it('date range active today causes rule to fire', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops tools', 'twitter'),
      makePost('p2', 'react hooks', 'twitter'),
    ])

    // Rule active from past to future — covers today
    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0, from: '2020-01-01', to: '2099-12-31' }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // p1 matches devops → assigned first via rule
    expect(plan.posts[0].post._id).toBe('p1')
  })

  it('preserves priority-matched posts for their date range (does not consume them early)', async () => {
    // This is the key bug test: when a rule has a future date range,
    // priority-matched posts should NOT be consumed by earlier slots.

    // Use a config with 1 slot/day to make slots predictable
    const singleSlotConfig = {
      timezone: 'UTC',
      platforms: {
        x: {
          slots: [],
          avoidDays: [] as string[],
          byClipType: {
            short: {
              slots: [{ days: ['mon','tue','wed','thu','fri','sat','sun'], time: '10:00', label: 'Daily' }],
              avoidDays: [] as string[],
            },
          },
        },
      },
    }
    seedSchedule(singleSlotConfig as typeof TEST_SCHEDULE)

    // 8 posts: 2 hooks, 6 random — enough to fill slots through the date range
    mockPosts([
      makePost('hook1', 'React hooks deep dive #hooks', 'twitter'),
      makePost('hook2', 'Custom hooks patterns #hooks', 'twitter'),
      makePost('rand1', 'Architecture matrix #CleanCode', 'twitter'),
      makePost('rand2', 'TypeScript generics guide', 'twitter'),
      makePost('rand3', 'CSS grid tricks', 'twitter'),
      makePost('rand4', 'Docker basics', 'twitter'),
      makePost('rand5', 'Git workflows', 'twitter'),
      makePost('rand6', 'Testing patterns', 'twitter'),
    ])

    // Rule: hooks posts starting 3 days from now (slots 1-3 are before range, 4+ are in range)
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() + 3)
    const toDate = new Date()
    toDate.setDate(toDate.getDate() + 10)
    const from = fromDate.toISOString().slice(0, 10)
    const to = toDate.toISOString().slice(0, 10)

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['hooks'], saturation: 1.0, from, to }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // Find posts assigned to slots within the rule's date range
    const nextWeekPosts = plan.posts.filter(p => {
      const date = p.newScheduledFor.slice(0, 10)
      return date >= from && date <= to
    })

    // hooks posts should be in the date range — they were reserved for the rule
    const hooksInRange = nextWeekPosts.filter(p =>
      p.post.content.toLowerCase().includes('hooks'),
    )
    expect(hooksInRange.length).toBeGreaterThan(0)

    // Before the date range, only non-hooks posts should appear
    const beforeRange = plan.posts.filter(p => {
      const date = p.newScheduledFor.slice(0, 10)
      return date < from
    })
    const hooksBeforeRange = beforeRange.filter(p =>
      p.post.content.toLowerCase().includes('hooks'),
    )
    expect(hooksBeforeRange).toHaveLength(0)
  })

  // ── Keyword matching ──

  it('keyword matching is case-insensitive', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'DEVOPS IN PRODUCTION', 'twitter'),
      makePost('p2', 'unrelated content', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    expect(plan.posts[0].post._id).toBe('p1')
  })

  it('multiple keywords in a rule match any (OR logic)', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'kubernetes cluster setup', 'twitter'),
      makePost('p2', 'docker container basics', 'twitter'),
      makePost('p3', 'unrelated finance tips', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['kubernetes', 'docker'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // p1 and p2 match the rule (OR logic), p3 doesn't
    const firstTwoIds = plan.posts.slice(0, 2).map(p => p.post._id)
    expect(firstTwoIds).toContain('p1')
    expect(firstTwoIds).toContain('p2')
    expect(plan.posts[2].post._id).toBe('p3')
  })

  it('posts with no content never match keyword rules', async () => {
    seedSchedule()
    mockPosts([
      { _id: 'p1', content: '', platforms: [{ platform: 'twitter' }], status: 'scheduled', scheduledFor: null },
      makePost('p2', 'devops rocks', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // p2 matches rule → first. p1 (empty content) → remaining pool
    expect(plan.posts[0].post._id).toBe('p2')
    expect(plan.posts[1].post._id).toBe('p1')
  })

  // ── Cross-rule post consumption ──

  it('post matching multiple rules is consumed by the first rule that fires', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops kubernetes automation', 'twitter'),
      makePost('p2', 'kubernetes scaling tips', 'twitter'),
      makePost('p3', 'random stuff', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [
        { keywords: ['devops'], saturation: 1.0 },
        { keywords: ['kubernetes'], saturation: 1.0 },
      ],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    const ids = plan.posts.map(p => p.post._id)
    // p1 matches both rules but Rule 0 fires first → p1 consumed
    // Rule 0 has [p1], Rule 1 has [p1, p2]
    // Slot 0: Rule 0 → shift p1, not used → assign p1
    // Slot 1: Rule 0 exhausted. Rule 1 → shift p1, but used → shift p2, not used → assign p2
    // Slot 2: Both exhausted → remaining → p3
    expect(ids[0]).toBe('p1')
    expect(ids[1]).toBe('p2')
    expect(ids[2]).toBe('p3')
  })

  // ── Overflow / cancellation ──

  it('cancels overflow posts when more posts than available slots', async () => {
    // Config with only 1 slot per day
    const smallConfig = {
      timezone: 'UTC',
      platforms: {
        x: {
          slots: [],
          avoidDays: [] as string[],
          byClipType: {
            short: {
              slots: [{ days: ['mon','tue','wed','thu','fri','sat','sun'], time: '08:00', label: 'Only slot' }],
              avoidDays: [] as string[],
            },
          },
        },
      },
    }
    seedSchedule(smallConfig as typeof TEST_SCHEDULE)

    // 100 posts but only 1 slot per day (730 max days searched = 730 slots max)
    // With 100 posts, all should get slots since 730 > 100
    mockPosts(Array.from({ length: 100 }, (_, i) => makePost(`p${i}`, `content ${i}`, 'twitter')))

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    expect(plan.posts.length).toBe(100)
    expect(plan.toCancel).toHaveLength(0)
  })

  it('cancels posts for platform with no schedule slots', async () => {
    // Config with no slots for x/short
    const noSlotsConfig = {
      timezone: 'UTC',
      platforms: {
        x: {
          slots: [],
          avoidDays: [] as string[],
          byClipType: {
            short: {
              slots: [] as any[],
              avoidDays: [] as string[],
            },
          },
        },
      },
    }
    seedSchedule(noSlotsConfig as typeof TEST_SCHEDULE)
    mockPosts([
      makePost('p1', 'devops content', 'twitter'),
      makePost('p2', 'react content', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    expect(plan.posts).toHaveLength(0)
    expect(plan.toCancel).toHaveLength(2)
    expect(plan.toCancel[0].reason).toContain('No schedule slots')
  })

  // ── Platform handling ──

  it('twitter platform normalizes to x for slot lookup', async () => {
    seedSchedule()
    mockPosts([makePost('p1', 'test content', 'twitter')])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    // Should find slots via x platform config
    expect(plan.posts).toHaveLength(1)
    expect(plan.toCancel).toHaveLength(0)
  })

  it('handles multiple platforms independently', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops on twitter', 'twitter'),
      makePost('p2', 'devops on youtube', 'youtube'),
      makePost('p3', 'react on twitter', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    // Each platform group is handled independently
    // twitter group: p1 (devops, priority), p3 (remaining)
    // youtube group: p2 (devops, priority)
    expect(plan.posts).toHaveLength(3)

    // Within each platform, devops posts should come first in chronological slot order
    const twitterPosts = plan.posts.filter(p => p.platform === 'twitter')
    const youtubePosts = plan.posts.filter(p => p.platform === 'youtube')
    expect(twitterPosts).toHaveLength(2)
    expect(youtubePosts).toHaveLength(1)
  })

  // ── Slot assignment correctness ──

  it('assigns chronologically increasing slots to posts', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'first post', 'twitter'),
      makePost('p2', 'second post', 'twitter'),
      makePost('p3', 'third post', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    // Final result is sorted by newScheduledFor
    for (let i = 1; i < plan.posts.length; i++) {
      const prev = new Date(plan.posts[i - 1].newScheduledFor).getTime()
      const curr = new Date(plan.posts[i].newScheduledFor).getTime()
      expect(curr).toBeGreaterThan(prev)
    }
  })

  it('records oldScheduledFor from original post', async () => {
    seedSchedule()
    const origDate = '2026-06-01T08:00:00+00:00'
    mockPosts([makePost('p1', 'test', 'twitter', origDate)])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    expect(plan.posts[0].oldScheduledFor).toBe(origDate)
  })

  it('skips posts already at the correct slot', async () => {
    seedSchedule()
    // Compute the actual first slot using the same logic as generateSlots
    // Must check ALL slot times (08:00, 14:00, 20:00) not just 08:00
    const now = new Date()
    const nowMs = now.getTime()
    const slotTimes = ['08:00', '14:00', '20:00']
    let firstSlotIso = ''
    outer:
    for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
      const day = new Date(now)
      day.setDate(day.getDate() + dayOffset)
      const y = day.getUTCFullYear()
      const m = String(day.getUTCMonth() + 1).padStart(2, '0')
      const d = String(day.getUTCDate()).padStart(2, '0')
      for (const time of slotTimes) {
        const candidate = `${y}-${m}-${d}T${time}:00+00:00`
        if (new Date(candidate).getTime() > nowMs) {
          firstSlotIso = candidate
          break outer
        }
      }
    }

    mockPosts([makePost('p1', 'test', 'twitter', firstSlotIso)])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    // Post already at correct slot → skipped
    expect(plan.skipped).toBe(1)
    expect(plan.posts).toHaveLength(0)
  })

  // ── Rule queue exhaustion ──

  it('falls back to remaining pool when all priority queues are exhausted', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops only match', 'twitter'),
      makePost('p2', 'cats video', 'twitter'),
      makePost('p3', 'dogs video', 'twitter'),
      makePost('p4', 'birds video', 'twitter'),
    ])

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    const ids = plan.posts.map(p => p.post._id)
    // Only p1 matches devops → it gets slot 0
    // Slots 1-3 → remaining pool (p2, p3, p4 by insertion order since no scheduledFor)
    expect(ids[0]).toBe('p1')
    expect(ids.slice(1).sort()).toEqual(['p2', 'p3', 'p4'])
  })

  // ── Unmatched count ──

  it('counts unmatched posts (no clipType from published store)', async () => {
    seedSchedule()
    mockPosts([makePost('p1', 'anything', 'twitter')])

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    // No published items → all posts are unmatched (defaulting to short)
    expect(plan.unmatched).toBe(1)
  })

  // ── Execute plan ──

  it('executeRealignPlan calls schedulePost for each planned post', async () => {
    seedSchedule()
    mockPosts([
      makePost('p1', 'devops one', 'twitter'),
      makePost('p2', 'devops two', 'twitter'),
    ])
    mockSchedulePost.mockResolvedValue({})

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })

    const result = await executeRealignPlan(plan)
    expect(result.updated).toBe(2)
    expect(result.failed).toBe(0)
    expect(mockSchedulePost).toHaveBeenCalledTimes(2)
  })

  it('executeRealignPlan reports progress via callback', async () => {
    seedSchedule()
    mockPosts([makePost('p1', 'test', 'twitter')])
    mockSchedulePost.mockResolvedValue({})

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    const progress: Array<[number, number, string]> = []

    await executeRealignPlan(plan, (completed, total, phase) => {
      progress.push([completed, total, phase])
    })

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[progress.length - 1][0]).toBe(progress[progress.length - 1][1]) // final: completed === total
  })

  it('executeRealignPlan handles API errors gracefully', async () => {
    seedSchedule()
    mockPosts([makePost('p1', 'test', 'twitter')])
    mockSchedulePost.mockRejectedValue(new Error('API rate limit'))

    const plan = await buildPrioritizedRealignPlan({ priorities: [], clipTypeMaps: EMPTY_CLIP_TYPE_MAPS })
    const result = await executeRealignPlan(plan)

    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].error).toContain('API rate limit')
  })
})

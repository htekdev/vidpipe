import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (L2 only) ───────────────────────────────────────────────────

const mockListPosts = vi.hoisted(() => vi.fn())
const mockUpdatePost = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    listPosts(...args: unknown[]) { return mockListPosts(...args) }
    updatePost(...args: unknown[]) { return mockUpdatePost(...args) }
  },
}))

import { buildPrioritizedRealignPlan, executeRealignPlan } from '../../../L3-services/scheduler/realign.js'
import type { PriorityRule } from '../../../L3-services/scheduler/realign.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

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

// ── Tests ──────────────────────────────────────────────────────────────

describe('buildPrioritizedRealignPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
  })

  it('returns empty plan when no posts exist', async () => {
    mockListPosts.mockResolvedValue([])

    const plan = await buildPrioritizedRealignPlan({ priorities: [] })
    expect(plan.posts).toHaveLength(0)
    expect(plan.toCancel).toHaveLength(0)
    expect(plan.totalFetched).toBe(0)
  })

  it('prioritizes keyword-matched posts at 100% saturation', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'Learn about devops pipelines'),
        makePost('p2', 'React hooks tutorial'),
        makePost('p3', 'DevOps CI/CD best practices'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const priorities: PriorityRule[] = [
      { keywords: ['devops'], saturation: 1.0 },
    ]

    const plan = await buildPrioritizedRealignPlan({ priorities })
    expect(plan.posts.length).toBe(3)

    // First two assigned posts should be devops-related
    const firstTwo = plan.posts.slice(0, 2)
    const devopsPosts = firstTwo.filter(p => p.post.content.toLowerCase().includes('devops'))
    expect(devopsPosts).toHaveLength(2)
  })

  it('never picks priority posts at 0% saturation', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'Learn about devops', 'twitter', '2026-03-01T12:00:00+00:00'),
        makePost('p2', 'React hooks tutorial', 'twitter', '2026-03-02T12:00:00+00:00'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const priorities: PriorityRule[] = [
      { keywords: ['devops'], saturation: 0 },
    ]

    // With 0% saturation, falls through to remaining pool sorted by scheduledFor
    const plan = await buildPrioritizedRealignPlan({ priorities })
    expect(plan.posts.length).toBeGreaterThanOrEqual(1)
    // p1 is earliest by scheduledFor, should be first in the remaining pool
    expect(plan.posts[0].post._id).toBe('p1')
  })

  it('respects date range filtering on priority rules', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'devops pipeline setup'),
        makePost('p2', 'react hooks deep dive'),
        makePost('p3', 'devops monitoring tools'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    // Rule only active far in the future
    const priorities: PriorityRule[] = [
      { keywords: ['devops'], saturation: 1.0, from: '2099-01-01', to: '2099-12-31' },
    ]

    const plan = await buildPrioritizedRealignPlan({ priorities })
    // All posts assigned from the remaining pool since date range doesn't match
    expect(plan.posts.length).toBe(3)
  })

  it('processes multiple priority rules in array order', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'kubernetes deployment guide'),
        makePost('p2', 'react hooks patterns'),
        makePost('p3', 'devops monitoring setup'),
        makePost('p4', 'typescript generics'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const priorities: PriorityRule[] = [
      { keywords: ['devops', 'kubernetes'], saturation: 1.0 },
      { keywords: ['react', 'hooks'], saturation: 1.0 },
    ]

    const plan = await buildPrioritizedRealignPlan({ priorities })
    expect(plan.posts.length).toBe(4)

    // Rule[0] (devops/kubernetes) fires first, then rule[1] (react), then remainder
    const contents = plan.posts.map(p => p.post._id)
    const devopsIdx = Math.min(
      ...['p1', 'p3'].map(id => contents.indexOf(id)).filter(i => i >= 0),
    )
    const reactIdx = contents.indexOf('p2')
    const tsIdx = contents.indexOf('p4')
    expect(devopsIdx).toBeLessThan(reactIdx)
    expect(reactIdx).toBeLessThan(tsIdx)
  })

  it('falls back to remaining pool when priority queue is exhausted', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'devops tools'),
        makePost('p2', 'random video about cats'),
        makePost('p3', 'another random video'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const priorities: PriorityRule[] = [
      { keywords: ['devops'], saturation: 1.0 },
    ]

    const plan = await buildPrioritizedRealignPlan({ priorities })
    expect(plan.posts.length).toBe(3)
    // First should be devops (priority), remaining from pool
    expect(plan.posts[0].post._id).toBe('p1')
  })

  it('handles case-insensitive keyword matching', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'DEVOPS in production'),
        makePost('p2', 'DevOps best practices'),
        makePost('p3', 'unrelated content'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const priorities: PriorityRule[] = [
      { keywords: ['devops'], saturation: 1.0 },
    ]

    const plan = await buildPrioritizedRealignPlan({ priorities })
    const firstTwo = plan.posts.slice(0, 2)
    expect(firstTwo.every(p => p.post.content.toLowerCase().includes('devops'))).toBe(true)
  })

  it('works with empty priorities array (behaves like regular realign)', async () => {
    mockListPosts
      .mockResolvedValueOnce([ // scheduled
        makePost('p1', 'First post', 'twitter', '2026-03-02T12:00:00+00:00'),
        makePost('p2', 'Second post', 'twitter', '2026-03-01T12:00:00+00:00'),
      ])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed

    const plan = await buildPrioritizedRealignPlan({ priorities: [] })
    expect(plan.posts.length).toBe(2)
    // With no priority rules, remaining pool sorts by scheduledFor → p2 first
    expect(plan.posts[0].post._id).toBe('p2')
  })

  it('returns plan compatible with executeRealignPlan', async () => {
    mockListPosts
      .mockResolvedValueOnce([makePost('p1', 'devops tools')])
      .mockResolvedValueOnce([]) // draft
      .mockResolvedValueOnce([]) // cancelled
      .mockResolvedValueOnce([]) // failed
    mockUpdatePost.mockResolvedValue({})

    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
    })

    const result = await executeRealignPlan(plan)
    expect(result.updated).toBe(1)
    expect(result.failed).toBe(0)
  })
})

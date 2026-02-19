import { describe, it, expect, vi } from 'vitest'

// Mock L2 boundary
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    listPosts() { return Promise.resolve([]) }
    updatePost() { return Promise.resolve({}) }
  },
}))

import { buildPrioritizedRealignPlan } from '../../../L3-services/scheduler/realign.js'

describe('L4-L6 Integration: prioritized realign plan building', () => {
  it('builds empty plan when no posts exist', async () => {
    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['devops'], saturation: 1.0 }],
    })
    expect(plan.posts).toHaveLength(0)
    expect(plan.totalFetched).toBe(0)
  })
})

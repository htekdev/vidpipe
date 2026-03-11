import { describe, test, expect } from 'vitest'
import { buildPrioritizedRealignPlan } from '../../L3-services/scheduler/realign.js'
import type { ClipTypeMaps } from '../../L3-services/scheduler/realign.js'

const hasLateApiKey = !!process.env.LATE_API_KEY

// Empty clipTypeMaps to avoid disk I/O during e2e tests
const EMPTY_CLIP_TYPE_MAPS: ClipTypeMaps = {
  byLatePostId: new Map(),
  byContent: new Map(),
}

describe.skipIf(!hasLateApiKey)('prioritized realign e2e', () => {
  test('buildPrioritizedRealignPlan reserves priority posts outside remaining pool', async () => {
    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['nonexistent-keyword-xyz'], saturation: 1.0 }],
      clipTypeMaps: EMPTY_CLIP_TYPE_MAPS,
    })
    expect(plan).toBeDefined()
    expect(Array.isArray(plan.posts)).toBe(true)
    expect(Array.isArray(plan.toCancel)).toBe(true)
    expect(typeof plan.skipped).toBe('number')
    expect(typeof plan.unmatched).toBe('number')
    expect(typeof plan.totalFetched).toBe('number')
  }, 60_000)
})

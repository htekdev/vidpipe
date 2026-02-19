import { describe, test, expect } from 'vitest'
import { buildPrioritizedRealignPlan } from '../../L3-services/scheduler/realign.js'

describe('prioritized realign e2e', () => {
  test('buildPrioritizedRealignPlan returns valid plan shape without crashing', async () => {
    const plan = await buildPrioritizedRealignPlan({
      priorities: [{ keywords: ['nonexistent-keyword-xyz'], saturation: 1.0 }],
    })
    expect(plan).toBeDefined()
    expect(Array.isArray(plan.posts)).toBe(true)
    expect(Array.isArray(plan.toCancel)).toBe(true)
    expect(typeof plan.skipped).toBe('number')
    expect(typeof plan.unmatched).toBe('number')
    expect(typeof plan.totalFetched).toBe('number')
  }, 30_000)
})

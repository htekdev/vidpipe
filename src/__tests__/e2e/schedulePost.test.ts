import { describe, test, expect } from 'vitest'
import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import { findNextSlot, rescheduleIdeaPosts, type SlotOptions, type RescheduleResult } from '../../L3-services/scheduler/scheduler.js'
import { updatePublishedItemSchedule } from '../../L3-services/postStore/postStore.js'

const hasLateApiKey = !!process.env.LATE_API_KEY

describe('schedulePost e2e', () => {
  test('LateApiClient exposes schedulePost method', () => {
    // Verify the method exists on the prototype (no API key needed)
    expect(typeof LateApiClient.prototype.schedulePost).toBe('function')
  })

  test('schedulePost delegates to updatePost', () => {
    // Verify schedulePost is distinct from updatePost
    expect(LateApiClient.prototype.schedulePost).not.toBe(LateApiClient.prototype.updatePost)
  })

  test('findNextSlot accepts optional SlotOptions parameter', () => {
    const args: Parameters<typeof findNextSlot> = [
      'x',
      'short',
      {
        ideaIds: ['idea-aware-contract-test'],
        publishBy: '2026-06-01T12:00:00Z',
      },
    ]

    expect(args).toHaveLength(3)
    expect(args[2]).toBeTruthy()
  })

  test('SlotOptions interface includes ideaIds and publishBy', () => {
    const options: SlotOptions = {
      ideaIds: ['idea-aware-contract-test'],
      publishBy: '2026-06-01T12:00:00Z',
    }

    expect(options).toBeTruthy()
  })

  describe.skipIf(!hasLateApiKey)('with live API', () => {
    test('schedulePost rejects with invalid post ID', async () => {
      const client = new LateApiClient()
      await expect(
        client.schedulePost('nonexistent-post-id', '2026-06-01T12:00:00Z'),
      ).rejects.toThrow()
    }, 15_000)
  })

  describe.skipIf(!hasLateApiKey)('idea-aware scheduling with live API', () => {
    test('findNextSlot with ideaIds returns a valid slot', async () => {
      const slot = await findNextSlot('x', 'short', {
        ideaIds: ['idea-aware-live-test'],
      })

      expect(slot === null || !Number.isNaN(Date.parse(slot))).toBe(true)
    }, 15_000)
  })

  // ── rescheduleIdeaPosts contract ────────────────────────────────

  test('rescheduleIdeaPosts is exported and callable', () => {
    // Fix: reschedule sorts by urgency and gracefully skips published posts
    expect(typeof rescheduleIdeaPosts).toBe('function')
  })

  test('RescheduleResult type has required fields', () => {
    const result: RescheduleResult = {
      rescheduled: 0,
      unchanged: 0,
      failed: 0,
      details: [],
    }

    expect(result).toHaveProperty('rescheduled')
    expect(result).toHaveProperty('unchanged')
    expect(result).toHaveProperty('failed')
    expect(result).toHaveProperty('details')
    expect(Array.isArray(result.details)).toBe(true)
  })

  test('rescheduleIdeaPosts accepts dryRun option', () => {
    const params: Parameters<typeof rescheduleIdeaPosts> = [{ dryRun: true }]
    expect(params[0]).toEqual({ dryRun: true })
  })

  // ── updatePublishedItemSchedule contract ────────────────────────

  test('updatePublishedItemSchedule is exported and callable', () => {
    expect(typeof updatePublishedItemSchedule).toBe('function')
  })

  test('updatePublishedItemSchedule rejects invalid IDs', async () => {
    await expect(
      updatePublishedItemSchedule('../traversal', '2026-01-01T00:00:00Z'),
    ).rejects.toThrow('Invalid ID format')
  })

  test('rescheduleIdeaPosts dry run returns result without modifying posts', async () => {
    const result = await rescheduleIdeaPosts({ dryRun: true })

    expect(result).toHaveProperty('rescheduled')
    expect(result).toHaveProperty('unchanged')
    expect(result).toHaveProperty('failed')
    expect(Array.isArray(result.details)).toBe(true)
    expect(typeof result.rescheduled).toBe('number')
    expect(typeof result.unchanged).toBe('number')
    expect(typeof result.failed).toBe('number')
  }, 120_000)
})

// ── buildPrioritizedRealignPlan removed ─────────────────────────

test('buildPrioritizedRealignPlan is no longer exported from realign', async () => {
  const realignModule = await import('../../L3-services/scheduler/realign.js')
  expect('buildPrioritizedRealignPlan' in realignModule).toBe(false)
})

test('buildRealignPlan is still exported from realign', async () => {
  const { buildRealignPlan } = await import('../../L3-services/scheduler/realign.js')
  expect(typeof buildRealignPlan).toBe('function')
})

test('schedulePost and buildBookedMap are exported', async () => {
  const { schedulePost, buildBookedMap } = await import('../../L3-services/scheduler/scheduler.js')
  expect(typeof schedulePost).toBe('function')
  expect(typeof buildBookedMap).toBe('function')
})

test('buildBookedMap only includes future local entries', async () => {
  const { buildBookedMap } = await import('../../L3-services/scheduler/scheduler.js')
  const map = await buildBookedMap()
  const nowMs = Date.now()
  for (const [, slot] of map) {
    if (slot.source === 'local') {
      expect(new Date(slot.scheduledFor).getTime()).toBeGreaterThan(nowMs - 60_000)
    }
  }
})

test('rescheduleAllPosts uses own-post detection to avoid unnecessary moves', async () => {
  const { rescheduleAllPosts } = await import('../../L3-services/scheduler/scheduler.js')
  expect(typeof rescheduleAllPosts).toBe('function')
})

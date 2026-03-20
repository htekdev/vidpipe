/**
 * E2E Test — queueSync builds correct queue definitions
 *
 * No mocking — reads real schedule.json and tests pure queue building logic.
 * Skipped when LATE_API_KEY is not configured (E2E environment indicator).
 */
import { describe, test, expect } from 'vitest'

const hasLateKey = Boolean(process.env.LATE_API_KEY)

describe.skipIf(!hasLateKey)('Queue sync E2E', () => {
  test('buildDesiredQueues produces correct queue definitions from schedule.json', async () => {
    const { buildDesiredQueues } = await import('../../L3-services/scheduler/queueSync.js')
    const { loadScheduleConfig, clearScheduleCache } = await import('../../L3-services/scheduler/scheduleConfig.js')

    clearScheduleCache()
    const config = await loadScheduleConfig()
    const queues = buildDesiredQueues(config)

    expect(queues.length).toBeGreaterThan(0)
    for (const q of queues) {
      expect(q.name).toBeTruthy()
      expect(q.slots.length).toBeGreaterThan(0)
      for (const slot of q.slots) {
        expect(slot.dayOfWeek).toBeGreaterThanOrEqual(0)
        expect(slot.dayOfWeek).toBeLessThanOrEqual(6)
        expect(slot.time).toMatch(/^\d{2}:\d{2}$/)
      }
    }
  })
})

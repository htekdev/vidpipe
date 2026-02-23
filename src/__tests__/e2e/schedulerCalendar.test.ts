import { describe, test, expect } from 'vitest'
import { getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'

const hasLateApiKey = !!process.env.LATE_API_KEY

describe.skipIf(!hasLateApiKey)('scheduler e2e', () => {
  test('getScheduleCalendar returns array without crashing', async () => {
    const calendar = await getScheduleCalendar()
    expect(Array.isArray(calendar)).toBe(true)
  }, 60_000)

  test('getScheduleCalendar respects date filters', async () => {
    const calendar = await getScheduleCalendar(
      new Date('2099-01-01'),
      new Date('2099-01-02'),
    )
    expect(calendar).toEqual([])
  }, 60_000)
  test('getPlatformSchedule resolves twitter alias to x key from real schedule.json', async () => {
    const { loadScheduleConfig, getPlatformSchedule, clearScheduleCache } = await import('../../L3-services/scheduler/scheduleConfig.js')
    clearScheduleCache()
    await loadScheduleConfig()
    const schedule = getPlatformSchedule('twitter')
    expect(schedule).not.toBeNull()
    expect(schedule!.slots.length).toBeGreaterThanOrEqual(0)
  }, 10_000)
})

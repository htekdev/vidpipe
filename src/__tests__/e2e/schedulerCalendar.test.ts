import { describe, test, expect } from 'vitest'
import { getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'

describe('scheduler e2e', () => {
  test('getScheduleCalendar returns array without crashing', async () => {
    const calendar = await getScheduleCalendar()
    expect(Array.isArray(calendar)).toBe(true)
  }, 10_000)

  test('getScheduleCalendar respects date filters', async () => {
    const calendar = await getScheduleCalendar(
      new Date('2099-01-01'),
      new Date('2099-01-02'),
    )
    expect(calendar).toEqual([])
  }, 10_000)
})

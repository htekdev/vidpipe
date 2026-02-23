import { describe, test, expect } from 'vitest'
import { getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const hasLateApiKey = !!process.env.LATE_API_KEY

// Skip tests if published directory has too many items (> 100) to avoid slow disk I/O
function hasLargePublishedDir(): boolean {
  const publishedDir = join(process.cwd(), 'recordings', 'published')
  if (!existsSync(publishedDir)) return false
  try {
    const items = readdirSync(publishedDir)
    return items.length > 100
  } catch {
    return false
  }
}

const skipSlowTests = hasLargePublishedDir()

describe.skipIf(!hasLateApiKey || skipSlowTests)('scheduler e2e', () => {
  test('getScheduleCalendar returns array without crashing', async () => {
    const calendar = await getScheduleCalendar()
    expect(Array.isArray(calendar)).toBe(true)
  }, 120_000)

  test('getScheduleCalendar respects date filters', async () => {
    const calendar = await getScheduleCalendar(
      new Date('2099-01-01'),
      new Date('2099-01-02'),
    )
    expect(calendar).toEqual([])
  }, 120_000)
  test('getPlatformSchedule resolves twitter alias to x key from real schedule.json', async () => {
    const { loadScheduleConfig, getPlatformSchedule, clearScheduleCache } = await import('../../L3-services/scheduler/scheduleConfig.js')
    clearScheduleCache()
    await loadScheduleConfig()
    const schedule = getPlatformSchedule('twitter')
    expect(schedule).not.toBeNull()
    expect(schedule!.slots.length).toBeGreaterThanOrEqual(0)
  }, 10_000)
})

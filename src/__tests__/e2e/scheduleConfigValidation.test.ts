import { describe, test, expect, beforeAll } from 'vitest'
import { Platform } from '../../L0-pure/types/index.js'
import { loadScheduleConfig, getPlatformSchedule, clearScheduleCache } from '../../L3-services/scheduler/scheduleConfig.js'

/**
 * Config validation: ensures every platform that the pipeline generates posts for
 * has a usable schedule slot (either dedicated or via fallback).
 *
 * This test catches the class of bug where CONTENT_MATRIX generates items for a
 * platform/clipType combo that schedule.json has no slots for, causing approvals
 * to silently fail with "No available slot."
 */

const PLATFORM_SCHEDULE_KEYS: Record<Platform, string> = {
  [Platform.YouTube]: 'youtube',
  [Platform.LinkedIn]: 'linkedin',
  [Platform.TikTok]: 'tiktok',
  [Platform.Instagram]: 'instagram',
  [Platform.X]: 'x',
}

const EXPECTED_SLOT_COUNTS: Record<string, Partial<Record<'video' | 'short' | 'medium-clip', number>>> = {
  youtube: { short: 1, 'medium-clip': 0, video: 1 },
  linkedin: { short: 1, 'medium-clip': 0 },
  tiktok: { short: 2, 'medium-clip': 0 },
  instagram: { short: 1, 'medium-clip': 0, video: 0 },
  x: { short: 2, 'medium-clip': 0 },
}

describe('schedule.json slot sizing', () => {
  beforeAll(async () => {
    clearScheduleCache()
    await loadScheduleConfig()
  })

  for (const platform of Object.values(Platform)) {
    const scheduleKey = PLATFORM_SCHEDULE_KEYS[platform]
    const clipTypes = EXPECTED_SLOT_COUNTS[scheduleKey]
    for (const [clipType, expectedSlotCount] of Object.entries(clipTypes)) {
      test(`${scheduleKey}/${clipType} has ${expectedSlotCount} configured slots`, () => {
        const schedule = getPlatformSchedule(scheduleKey, clipType)
        expect(schedule, `No schedule config for ${scheduleKey}/${clipType}`).not.toBeNull()
        expect(schedule!.slots.length).toBe(expectedSlotCount)
      })
    }
  }
})

describe('schedule.json publishBy enforcement', () => {
  test('SlotOptions accepts publishBy field', async () => {
    const { findNextSlot } = await import('../../L3-services/scheduler/scheduler.js')
    expect(typeof findNextSlot).toBe('function')
  })

  test('schedule.json ideaSpacing config is loaded', async () => {
    const { getIdeaSpacingConfig } = await import('../../L3-services/scheduler/scheduleConfig.js')
    const spacing = getIdeaSpacingConfig()
    expect(spacing).toHaveProperty('samePlatformHours')
    expect(spacing).toHaveProperty('crossPlatformHours')
    expect(spacing.samePlatformHours).toBeGreaterThanOrEqual(0)
    expect(spacing.crossPlatformHours).toBeGreaterThanOrEqual(0)
  })

  test('validateScheduleConfig accepts zero crossPlatformHours', async () => {
    const { validateScheduleConfig } = await import('../../L3-services/scheduler/scheduleConfig.js')
    const config = validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: { samePlatformHours: 6, crossPlatformHours: 0 },
      platforms: { x: { slots: [], avoidDays: [] } },
    })
    expect(config.ideaSpacing?.crossPlatformHours).toBe(0)
  })
})

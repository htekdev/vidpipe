import { describe, test, expect, beforeAll } from 'vitest'
import { Platform } from '../../L0-pure/types/index.js'
import { loadScheduleConfig, getPlatformSchedule, clearScheduleCache } from '../../L3-services/scheduler/scheduleConfig.js'
import type { ClipType } from '../../L3-services/socialPosting/platformContentStrategy.js'

/**
 * Config validation: ensures every platform that the pipeline generates posts for
 * has a usable schedule slot (either dedicated or via fallback).
 *
 * This test catches the class of bug where CONTENT_MATRIX generates items for a
 * platform/clipType combo that schedule.json has no slots for, causing approvals
 * to silently fail with "No available slot."
 */

const ALL_CLIP_TYPES: ClipType[] = ['video', 'short', 'medium-clip']

const PLATFORM_SCHEDULE_KEYS: Record<Platform, string> = {
  [Platform.YouTube]: 'youtube',
  [Platform.LinkedIn]: 'linkedin',
  [Platform.TikTok]: 'tiktok',
  [Platform.Instagram]: 'instagram',
  [Platform.X]: 'x',
}

describe('schedule.json ↔ content strategy consistency', () => {
  beforeAll(async () => {
    clearScheduleCache()
    await loadScheduleConfig()
  })

  for (const platform of Object.values(Platform)) {
    for (const clipType of ALL_CLIP_TYPES) {
      const scheduleKey = PLATFORM_SCHEDULE_KEYS[platform]

      test(`${scheduleKey}/${clipType} has usable schedule slots (direct or fallback)`, () => {
        const schedule = getPlatformSchedule(scheduleKey, clipType)
        expect(schedule, `No schedule config for ${scheduleKey}/${clipType}`).not.toBeNull()
        expect(schedule!.slots.length, `${scheduleKey}/${clipType} resolved to 0 slots — posts cannot be approved`).toBeGreaterThan(0)
      })
    }
  }
})

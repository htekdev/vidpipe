import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

import {
  getDefaultScheduleConfig,
  validateScheduleConfig,
  loadScheduleConfig,
  clearScheduleCache,
  getPlatformSchedule,
} from '../services/scheduleConfig.js'

const tmpDir = path.join(os.tmpdir(), `vidpipe-schedule-${randomUUID()}`)

describe('scheduleConfig', () => {
  beforeEach(async () => {
    clearScheduleCache()
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  describe('getDefaultScheduleConfig', () => {
    it('returns valid config with all 5 platforms', () => {
      const config = getDefaultScheduleConfig()
      expect(config.timezone).toBe('America/Chicago')
      const platforms = Object.keys(config.platforms)
      expect(platforms).toContain('linkedin')
      expect(platforms).toContain('tiktok')
      expect(platforms).toContain('instagram')
      expect(platforms).toContain('youtube')
      expect(platforms).toContain('twitter')
      expect(platforms).toHaveLength(5)
    })

    it('passes its own validation', () => {
      const config = getDefaultScheduleConfig()
      expect(() => validateScheduleConfig(config)).not.toThrow()
    })
  })

  describe('validateScheduleConfig', () => {
    it('rejects invalid time formats', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['mon'], time: '25:00', label: 'Bad' }],
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/HH:MM/)
    })

    it('rejects invalid day names', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['monday'], time: '08:00', label: 'Bad day' }],
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/invalid day/)
    })

    it('rejects invalid avoidDays', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['mon'], time: '08:00', label: 'Good' }],
            avoidDays: ['funday'],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/invalid day/)
    })

    it('rejects non-object config', () => {
      expect(() => validateScheduleConfig(null)).toThrow(/non-null object/)
      expect(() => validateScheduleConfig('string')).toThrow(/non-null object/)
    })

    it('rejects missing timezone', () => {
      expect(() => validateScheduleConfig({ platforms: {} })).toThrow(/timezone/)
    })

    it('rejects empty timezone string', () => {
      expect(() => validateScheduleConfig({ timezone: '  ', platforms: {} })).toThrow(/timezone/)
    })

    it('rejects platforms that is an array', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: [] })).toThrow(/platforms/)
    })

    it('rejects missing platforms key', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC' })).toThrow(/platforms/)
    })

    it('rejects platform value that is not an object', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: { test: 'bad' } })).toThrow(/must be an object/)
    })

    it('rejects platform value that is an array', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: { test: [] } })).toThrow(/must be an object/)
    })

    it('rejects platform missing slots array', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: { test: { avoidDays: [] } } })).toThrow(/slots/)
    })

    it('rejects platform missing avoidDays array', () => {
      expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: { test: { slots: [] } } })).toThrow(/avoidDays/)
    })

    it('rejects slot with empty days array', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: [], time: '08:00', label: 'Empty days' }],
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/non-empty "days"/)
    })

    it('rejects slot with empty label', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['mon'], time: '08:00', label: '' }],
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/non-empty "label"/)
    })

    it('rejects slot with missing label', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['mon'], time: '08:00' }],
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/non-empty "label"/)
    })
  })

  describe('loadScheduleConfig', () => {
    it('creates default file if missing', async () => {
      const filePath = path.join(tmpDir, 'new-schedule.json')
      const config = await loadScheduleConfig(filePath)

      expect(config.timezone).toBe('America/Chicago')
      expect(Object.keys(config.platforms)).toHaveLength(5)

      // File should have been written
      const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      expect(onDisk.timezone).toBe('America/Chicago')
    })

    it('reads existing file', async () => {
      const customConfig = {
        timezone: 'Europe/London',
        platforms: {
          twitter: {
            slots: [{ days: ['mon'], time: '09:00', label: 'Morning' }],
            avoidDays: [],
          },
        },
      }
      const filePath = path.join(tmpDir, 'existing-schedule.json')
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')

      const config = await loadScheduleConfig(filePath)
      expect(config.timezone).toBe('Europe/London')
      expect(config.platforms.twitter.slots[0].time).toBe('09:00')
    })
  })

  describe('clearScheduleCache', () => {
    it('forces reload on next call', async () => {
      const filePath = path.join(tmpDir, 'cached-schedule.json')

      // First load creates defaults
      const config1 = await loadScheduleConfig(filePath)
      expect(config1.timezone).toBe('America/Chicago')

      // Overwrite file
      const updated = { ...config1, timezone: 'Asia/Tokyo' }
      await fs.writeFile(filePath, JSON.stringify(updated), 'utf-8')

      // Still cached — same timezone
      clearScheduleCache()

      // Now reloads
      const config2 = await loadScheduleConfig(filePath)
      expect(config2.timezone).toBe('Asia/Tokyo')
    })
  })

  describe('getPlatformSchedule', () => {
    it('returns null when cache is empty', () => {
      clearScheduleCache()
      expect(getPlatformSchedule('twitter')).toBeNull()
    })

    it('returns schedule for known platform after load', async () => {
      const filePath = path.join(tmpDir, 'schedule-for-get.json')
      await loadScheduleConfig(filePath)
      const schedule = getPlatformSchedule('twitter')
      expect(schedule).toBeDefined()
      expect(schedule!.slots.length).toBeGreaterThan(0)
    })

    it('returns null for unknown platform after load', async () => {
      const filePath = path.join(tmpDir, 'schedule-for-unknown.json')
      await loadScheduleConfig(filePath)
      expect(getPlatformSchedule('nonexistent')).toBeNull()
    })
  })
})

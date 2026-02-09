import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  getDefaultScheduleConfig,
  validateScheduleConfig,
  loadScheduleConfig,
  clearScheduleCache,
} from '../services/scheduleConfig.js'

const tmpDir = path.join(os.tmpdir(), `vidpipe-schedule-${Date.now()}`)

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
            maxPerDay: 1,
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
            maxPerDay: 1,
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
            maxPerDay: 1,
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

    it('rejects maxPerDay < 1', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          test: {
            slots: [{ days: ['mon'], time: '08:00', label: 'Test' }],
            maxPerDay: 0,
            avoidDays: [],
          },
        },
      }
      expect(() => validateScheduleConfig(config)).toThrow(/maxPerDay/)
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
            maxPerDay: 2,
            avoidDays: [],
          },
        },
      }
      const filePath = path.join(tmpDir, 'existing-schedule.json')
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')

      const config = await loadScheduleConfig(filePath)
      expect(config.timezone).toBe('Europe/London')
      expect(config.platforms.twitter.maxPerDay).toBe(2)
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
})

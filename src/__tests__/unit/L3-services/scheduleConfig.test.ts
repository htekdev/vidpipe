import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { promises as fs, closeSync } from 'node:fs'
import path from 'node:path'
import tmp from 'tmp'

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

import {
  getDefaultScheduleConfig,
  validateScheduleConfig,
  loadScheduleConfig,
  clearScheduleCache,
  getPlatformSchedule,
} from '../../../L3-services/scheduler/scheduleConfig.js'
import logger from '../../../L1-infra/logger/configLogger.js'

const tmpDirObj = tmp.dirSync({ prefix: 'vidpipe-schedule-', unsafeCleanup: false })
const tmpDir = tmpDirObj.name

describe('scheduleConfig', () => {
  beforeEach(async () => {
    clearScheduleCache()
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    // Clean directory contents but keep the directory
    const entries = await fs.readdir(tmpDir)
    await Promise.all(
      entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })),
    )
  })

  afterAll(() => {
    tmpDirObj.removeCallback()
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

    it('validates config with byClipType nested format', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [{ days: ['mon'] as const, time: '08:00', label: 'Default' }],
            avoidDays: [],
            byClipType: {
              short: {
                slots: [{ days: ['mon'] as const, time: '15:00', label: 'Afternoon shorts' }],
                avoidDays: ['sat', 'sun'],
              },
              video: {
                slots: [{ days: ['tue'] as const, time: '09:00', label: 'Morning video' }],
                avoidDays: [],
              },
            },
          },
        },
      }
      expect(() => validateScheduleConfig(config)).not.toThrow()
    })

    it('validates config without byClipType (backward compat)', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          twitter: {
            slots: [{ days: ['mon'] as const, time: '08:00', label: 'Morning' }],
            avoidDays: [],
          },
        },
      }
      const validated = validateScheduleConfig(config)
      expect(validated.platforms.twitter.slots).toHaveLength(1)
      expect(validated.platforms.twitter.byClipType).toBeUndefined()
    })

    it('warns on overlapping times across clip types', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [],
            avoidDays: [],
            byClipType: {
              short: {
                slots: [{ days: ['mon'] as const, time: '09:00', label: 'Short morning' }],
                avoidDays: [],
              },
              video: {
                slots: [{ days: ['mon'] as const, time: '09:00', label: 'Video morning' }],
                avoidDays: [],
              },
            },
          },
        },
      }
      validateScheduleConfig(config)
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('overlap'))
    })

    it('defaults byClipType avoidDays to empty array when missing', () => {
      const config = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [],
            avoidDays: [],
            byClipType: {
              short: {
                slots: [{ days: ['mon'] as const, time: '15:00', label: 'Afternoon' }],
              },
            },
          },
        },
      }
      const validated = validateScheduleConfig(config)
      expect(validated.platforms.linkedin.byClipType?.short.avoidDays).toEqual([])
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
      const tmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.json', mode: 0o600 })
      const filePath = tmpFile.name
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')

      const config = await loadScheduleConfig(filePath)
      expect(config.timezone).toBe('Europe/London')
      expect(config.platforms.twitter.slots[0].time).toBe('09:00')
    })

    it('reads existing file with byClipType nested format', async () => {
      const customConfig = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [{ days: ['mon'], time: '08:00', label: 'Default' }],
            avoidDays: [],
            byClipType: {
              short: {
                slots: [{ days: ['tue'], time: '14:00', label: 'Short slot' }],
                avoidDays: ['sat'],
              },
            },
          },
        },
      }
      const tmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.json', mode: 0o600 })
      const filePath = tmpFile.name
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')

      const config = await loadScheduleConfig(filePath)
      expect(config.platforms.linkedin.byClipType).toBeDefined()
      expect(config.platforms.linkedin.byClipType!.short.slots[0].time).toBe('14:00')
      expect(config.platforms.linkedin.byClipType!.short.avoidDays).toEqual(['sat'])
    })

    it('reads existing flat config without byClipType (backward compat)', async () => {
      const customConfig = {
        timezone: 'UTC',
        platforms: {
          twitter: {
            slots: [{ days: ['mon'], time: '10:00', label: 'Morning' }],
            avoidDays: ['sun'],
          },
        },
      }
      const tmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.json', mode: 0o600 })
      const filePath = tmpFile.name
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')

      const config = await loadScheduleConfig(filePath)
      expect(config.platforms.twitter.slots).toHaveLength(1)
      expect(config.platforms.twitter.avoidDays).toEqual(['sun'])
      expect(config.platforms.twitter.byClipType).toBeUndefined()
    })
  })

  describe('clearScheduleCache', () => {
    it('forces reload on next call', async () => {
      const filePath = tmp.tmpNameSync({ dir: tmpDir, postfix: '.json' })

      // First load creates defaults
      const config1 = await loadScheduleConfig(filePath)
      expect(config1.timezone).toBe('America/Chicago')

      // Overwrite file
      const updated = { ...config1, timezone: 'Asia/Tokyo' }
      const updateTmp = tmp.fileSync({ dir: tmpDir, postfix: '.json', keep: true, mode: 0o600 })
      await fs.writeFile(updateTmp.name, JSON.stringify(updated), 'utf-8')
      closeSync(updateTmp.fd) // Close file descriptor on Windows before rename
      await fs.rename(updateTmp.name, filePath)

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

    it('returns clip-type-specific schedule when byClipType exists', async () => {
      clearScheduleCache()
      const customConfig = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [{ days: ['mon'], time: '08:00', label: 'Default morning' }],
            avoidDays: [],
            byClipType: {
              short: {
                slots: [{ days: ['mon'], time: '15:00', label: 'Short afternoon' }],
                avoidDays: ['sat'],
              },
            },
          },
        },
      }
      const tmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.json', mode: 0o600 })
      const filePath = tmpFile.name
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')
      await loadScheduleConfig(filePath)

      const schedule = getPlatformSchedule('linkedin', 'short')
      expect(schedule).toBeDefined()
      expect(schedule!.slots).toHaveLength(1)
      expect(schedule!.slots[0].time).toBe('15:00')
      expect(schedule!.avoidDays).toEqual(['sat'])
    })

    it('falls back to flat schedule when clipType not in byClipType', async () => {
      clearScheduleCache()
      const customConfig = {
        timezone: 'UTC',
        platforms: {
          linkedin: {
            slots: [{ days: ['mon'], time: '08:00', label: 'Default morning' }],
            avoidDays: ['sun'],
            byClipType: {
              short: {
                slots: [{ days: ['mon'], time: '15:00', label: 'Short afternoon' }],
                avoidDays: ['sat'],
              },
            },
          },
        },
      }
      const tmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.json', mode: 0o600 })
      const filePath = tmpFile.name
      await fs.writeFile(filePath, JSON.stringify(customConfig), 'utf-8')
      await loadScheduleConfig(filePath)

      const schedule = getPlatformSchedule('linkedin', 'nonexistent')
      expect(schedule).toBeDefined()
      // Falls back to the flat schedule
      expect(schedule!.slots[0].time).toBe('08:00')
      expect(schedule!.avoidDays).toEqual(['sun'])
    })
  })
})

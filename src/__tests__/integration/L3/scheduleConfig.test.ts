/**
 * L3 Integration Test — scheduleConfig service
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, logger)
 * Real code:     L3 scheduleConfig validation + defaults
 *
 * Validates schedule config loading, validation, caching, and
 * per-platform schedule retrieval.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteFileRaw = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeFileRaw: mockWriteFileRaw,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import {
  getDefaultScheduleConfig,
  validateScheduleConfig,
  loadScheduleConfig,
  getPlatformSchedule,
  clearScheduleCache,
} from '../../../L3-services/scheduler/scheduleConfig.js'
import type { ScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: scheduleConfig', () => {
  beforeEach(() => {
    clearScheduleCache()
    vi.clearAllMocks()
  })

  // ── getDefaultScheduleConfig ──────────────────────────────────────

  test('returns valid config with all expected platforms', () => {
    const config = getDefaultScheduleConfig()

    expect(config.timezone).toBe('America/Chicago')
    expect(Object.keys(config.platforms)).toEqual(
      expect.arrayContaining(['linkedin', 'tiktok', 'instagram', 'youtube', 'twitter']),
    )
  })

  test('default config passes validation', () => {
    const defaults = getDefaultScheduleConfig()
    const validated = validateScheduleConfig(defaults)

    expect(validated.timezone).toBe(defaults.timezone)
    expect(Object.keys(validated.platforms)).toEqual(Object.keys(defaults.platforms))
  })

  test('every default platform has non-empty slots array', () => {
    const config = getDefaultScheduleConfig()

    for (const [name, platform] of Object.entries(config.platforms)) {
      expect(platform.slots.length).toBeGreaterThan(0)
      for (const slot of platform.slots) {
        expect(slot.days.length).toBeGreaterThan(0)
        expect(slot.time).toMatch(/^\d{2}:\d{2}$/)
        expect(slot.label.length).toBeGreaterThan(0)
      }
      expect(Array.isArray(platform.avoidDays)).toBe(true)
      // Tag the platform name for debug clarity on failure
      expect({ name, valid: true }).toEqual(expect.objectContaining({ valid: true }))
    }
  })

  // ── validateScheduleConfig ────────────────────────────────────────

  test('accepts valid minimal config', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        test: {
          slots: [{ days: ['mon'], time: '09:00', label: 'Morning' }],
          avoidDays: [],
        },
      },
    }

    const validated = validateScheduleConfig(config)
    expect(validated.timezone).toBe('UTC')
    expect(validated.platforms['test'].slots).toHaveLength(1)
  })

  test('rejects null config', () => {
    expect(() => validateScheduleConfig(null)).toThrow('non-null object')
  })

  test('rejects config with missing timezone', () => {
    expect(() => validateScheduleConfig({ platforms: {} })).toThrow('timezone')
  })

  test('rejects config with empty timezone', () => {
    expect(() => validateScheduleConfig({ timezone: '', platforms: {} })).toThrow('timezone')
  })

  test('rejects config with missing platforms', () => {
    expect(() => validateScheduleConfig({ timezone: 'UTC' })).toThrow('platforms')
  })

  test('rejects config with platforms as array', () => {
    expect(() => validateScheduleConfig({ timezone: 'UTC', platforms: [] })).toThrow('platforms')
  })

  test('rejects platform with missing slots', () => {
    const config = {
      timezone: 'UTC',
      platforms: { bad: { avoidDays: [] } },
    }
    expect(() => validateScheduleConfig(config)).toThrow('slots')
  })

  test('rejects platform with missing avoidDays', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: { slots: [{ days: ['mon'], time: '09:00', label: 'Test' }] },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('avoidDays')
  })

  test('rejects invalid time format', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: {
          slots: [{ days: ['mon'], time: '25:00', label: 'Bad time' }],
          avoidDays: [],
        },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('HH:MM')
  })

  test('rejects invalid day name', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: {
          slots: [{ days: ['monday'], time: '09:00', label: 'Test' }],
          avoidDays: [],
        },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('invalid day')
  })

  test('rejects empty days array in slot', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: {
          slots: [{ days: [], time: '09:00', label: 'Test' }],
          avoidDays: [],
        },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('non-empty "days"')
  })

  test('rejects empty label in slot', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: {
          slots: [{ days: ['mon'], time: '09:00', label: '' }],
          avoidDays: [],
        },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('non-empty "label"')
  })

  test('rejects invalid day in avoidDays', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        bad: {
          slots: [{ days: ['mon'], time: '09:00', label: 'Test' }],
          avoidDays: ['sunday'],
        },
      },
    }
    expect(() => validateScheduleConfig(config)).toThrow('invalid day')
  })

  test('validates byClipType sub-schedules', () => {
    const config = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          byClipType: {
            shorts: {
              slots: [{ days: ['fri'], time: '15:00', label: 'Shorts' }],
              avoidDays: ['mon'],
            },
            medium: {
              slots: [{ days: ['thu'], time: '20:00', label: 'Medium' }],
              avoidDays: [],
            },
          },
        },
      },
    }

    const validated = validateScheduleConfig(config)
    expect(validated.platforms['youtube'].byClipType).toBeDefined()
    expect(validated.platforms['youtube'].byClipType!['shorts'].slots).toHaveLength(1)
    expect(validated.platforms['youtube'].byClipType!['medium'].slots).toHaveLength(1)
  })

  // ── loadScheduleConfig ────────────────────────────────────────────

  test('loads config from file when it exists', async () => {
    const fileConfig: ScheduleConfig = {
      timezone: 'Europe/London',
      platforms: {
        linkedin: {
          slots: [{ days: ['mon'], time: '10:00', label: 'Monday morning' }],
          avoidDays: ['sat', 'sun'],
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(fileConfig))

    const config = await loadScheduleConfig('/test/schedule.json')

    expect(config.timezone).toBe('Europe/London')
    expect(config.platforms['linkedin'].slots).toHaveLength(1)
    expect(mockReadTextFile).toHaveBeenCalledWith('/test/schedule.json')
  })

  test('creates default config when file is missing', async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error('ENOENT'))
    mockWriteFileRaw.mockResolvedValueOnce(undefined)

    const config = await loadScheduleConfig('/test/schedule.json')

    expect(config.timezone).toBe('America/Chicago')
    expect(Object.keys(config.platforms)).toHaveLength(5)
    expect(mockWriteFileRaw).toHaveBeenCalledWith(
      '/test/schedule.json',
      expect.any(String),
      expect.objectContaining({ flag: 'wx' }),
    )
  })

  test('caches loaded config on subsequent calls', async () => {
    const fileConfig: ScheduleConfig = {
      timezone: 'Asia/Tokyo',
      platforms: {
        tiktok: {
          slots: [{ days: ['wed'], time: '19:00', label: 'Evening' }],
          avoidDays: [],
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(fileConfig))

    const first = await loadScheduleConfig('/test/schedule.json')
    const second = await loadScheduleConfig('/test/schedule.json')

    expect(first).toBe(second) // Same reference (cached)
    expect(mockReadTextFile).toHaveBeenCalledTimes(1)
  })

  test('rejects invalid JSON from file', async () => {
    mockReadTextFile.mockResolvedValueOnce('not valid json')

    await expect(loadScheduleConfig('/test/schedule.json')).rejects.toThrow()
  })

  // ── getPlatformSchedule ───────────────────────────────────────────

  test('returns correct slots for platform after load', async () => {
    const fileConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        linkedin: {
          slots: [{ days: ['tue'], time: '08:00', label: 'Morning' }],
          avoidDays: ['sat', 'sun'],
        },
        tiktok: {
          slots: [{ days: ['fri'], time: '19:00', label: 'Evening' }],
          avoidDays: [],
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(fileConfig))
    await loadScheduleConfig('/test/schedule.json')

    const linkedin = getPlatformSchedule('linkedin')
    expect(linkedin).not.toBeNull()
    expect(linkedin!.slots[0].time).toBe('08:00')
    expect(linkedin!.avoidDays).toEqual(['sat', 'sun'])

    const tiktok = getPlatformSchedule('tiktok')
    expect(tiktok).not.toBeNull()
    expect(tiktok!.slots[0].time).toBe('19:00')
  })

  test('returns null for unknown platform', async () => {
    mockReadTextFile.mockResolvedValueOnce(
      JSON.stringify(getDefaultScheduleConfig()),
    )
    await loadScheduleConfig('/test/schedule.json')

    expect(getPlatformSchedule('mastodon')).toBeNull()
  })

  test('returns null when cache is empty', () => {
    expect(getPlatformSchedule('linkedin')).toBeNull()
  })

  test('returns clip-type-specific schedule when available', async () => {
    const fileConfig: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [{ days: ['fri'], time: '15:00', label: 'Default' }],
          avoidDays: ['mon'],
          byClipType: {
            shorts: {
              slots: [{ days: ['wed'], time: '18:00', label: 'Shorts prime' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockReadTextFile.mockResolvedValueOnce(JSON.stringify(fileConfig))
    await loadScheduleConfig('/test/schedule.json')

    const shorts = getPlatformSchedule('youtube', 'shorts')
    expect(shorts).not.toBeNull()
    expect(shorts!.slots[0].label).toBe('Shorts prime')

    // Falls back to default when clip type not found
    const unknown = getPlatformSchedule('youtube', 'unknown-type')
    expect(unknown).not.toBeNull()
    expect(unknown!.slots[0].label).toBe('Default')
  })

  // ── clearScheduleCache ────────────────────────────────────────────

  test('forces reload on next call', async () => {
    const configA: ScheduleConfig = {
      timezone: 'UTC',
      platforms: {
        test: {
          slots: [{ days: ['mon'], time: '09:00', label: 'First' }],
          avoidDays: [],
        },
      },
    }
    const configB: ScheduleConfig = {
      timezone: 'US/Pacific',
      platforms: {
        test: {
          slots: [{ days: ['tue'], time: '10:00', label: 'Second' }],
          avoidDays: [],
        },
      },
    }

    mockReadTextFile
      .mockResolvedValueOnce(JSON.stringify(configA))
      .mockResolvedValueOnce(JSON.stringify(configB))

    const first = await loadScheduleConfig('/test/schedule.json')
    expect(first.timezone).toBe('UTC')

    clearScheduleCache()

    const second = await loadScheduleConfig('/test/schedule.json')
    expect(second.timezone).toBe('US/Pacific')
    expect(mockReadTextFile).toHaveBeenCalledTimes(2)
  })
})

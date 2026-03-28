import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadScheduleFile = vi.hoisted(() => vi.fn())
const mockWriteScheduleFile = vi.hoisted(() => vi.fn())
const mockResolveSchedulePath = vi.hoisted(() => vi.fn((configPath?: string) => configPath ?? 'schedule.json'))

vi.mock('../../../../L2-clients/scheduleStore/scheduleStore.js', () => ({
  readScheduleFile: mockReadScheduleFile,
  writeScheduleFile: mockWriteScheduleFile,
  resolveSchedulePath: mockResolveSchedulePath,
}))

import {
  clearScheduleCache,
  getDisplacementConfig,
  getIdeaSpacingConfig,
  loadScheduleConfig,
  validateScheduleConfig,
} from '../../../../L3-services/scheduler/scheduleConfig.js'

describe('scheduleConfig spacing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
    mockWriteScheduleFile.mockResolvedValue(undefined)
  })

  it('accepts configs with ideaSpacing and displacement', () => {
    const validated = validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: {
        samePlatformHours: 24,
        crossPlatformHours: 6,
      },
      displacement: {
        enabled: true,
        canDisplace: 'non-idea-only',
      },
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    })

    expect(validated.ideaSpacing).toEqual({
      samePlatformHours: 24,
      crossPlatformHours: 6,
    })
    expect(validated.displacement).toEqual({
      enabled: true,
      canDisplace: 'non-idea-only',
    })
  })

  it('accepts zero crossPlatformHours in ideaSpacing', () => {
    const validated = validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: { samePlatformHours: 6, crossPlatformHours: 0 },
      platforms: { x: { slots: [], avoidDays: [] } },
    })
    expect(validated.ideaSpacing?.crossPlatformHours).toBe(0)
  })

  it('rejects negative ideaSpacing hours', () => {
    expect(() => validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: { samePlatformHours: -1, crossPlatformHours: 6 },
      platforms: { x: { slots: [], avoidDays: [] } },
    })).toThrow('non-negative')
  })

  it('rejects invalid ideaSpacing with negative numbers', () => {
    expect(() => validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: {
        samePlatformHours: -1,
        crossPlatformHours: 6,
      },
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    })).toThrow(/ideaSpacing\.samePlatformHours/)
  })

  it('rejects invalid ideaSpacing with missing fields', () => {
    expect(() => validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: {
        samePlatformHours: 24,
      },
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    })).toThrow(/ideaSpacing\.crossPlatformHours/)
  })

  it('rejects invalid displacement values', () => {
    expect(() => validateScheduleConfig({
      timezone: 'UTC',
      displacement: {
        enabled: true,
        canDisplace: 'all',
      },
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    })).toThrow(/displacement\.canDisplace/)
  })

  it('returns default idea spacing when config does not set it', async () => {
    mockReadScheduleFile.mockResolvedValueOnce(JSON.stringify({
      timezone: 'UTC',
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    }))

    await loadScheduleConfig('missing-idea-spacing.json')

    expect(getIdeaSpacingConfig()).toEqual({
      samePlatformHours: 24,
      crossPlatformHours: 6,
    })
  })

  it('returns default displacement when config does not set it', async () => {
    mockReadScheduleFile.mockResolvedValueOnce(JSON.stringify({
      timezone: 'UTC',
      platforms: {
        x: {
          slots: [],
          avoidDays: [],
        },
      },
    }))

    await loadScheduleConfig('missing-displacement.json')

    expect(getDisplacementConfig()).toEqual({
      enabled: true,
      canDisplace: 'non-idea-only',
    })
  })

  it('accepts zero for crossPlatformHours in validateScheduleConfig', () => {
    const validated = validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: { samePlatformHours: 6, crossPlatformHours: 0 },
      platforms: { x: { slots: [], avoidDays: [] } },
    })
    expect(validated.ideaSpacing?.crossPlatformHours).toBe(0)
  })

  it('rejects negative spacing hours in validateScheduleConfig', () => {
    expect(() => validateScheduleConfig({
      timezone: 'UTC',
      ideaSpacing: { samePlatformHours: -1, crossPlatformHours: 6 },
      platforms: { x: { slots: [], avoidDays: [] } },
    })).toThrow('non-negative')
  })
})

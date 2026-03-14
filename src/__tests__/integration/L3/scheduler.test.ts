import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock L1 infrastructure (ESM imports verified)
vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

const mockOutputDir = vi.hoisted(() => {
  const os = require('node:os')
  const path = require('node:path')
  return path.join(os.tmpdir(), 'vidpipe-scheduler-l3-test')
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: mockOutputDir,
    LATE_API_KEY: '',
  }),
  initConfig: vi.fn(),
}))

import { findNextSlot, getScheduleCalendar, type SlotOptions } from '../../../L3-services/scheduler/scheduler.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

describe('L3 Integration: scheduler calendar with no Late API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
  })

  it('returns empty calendar when Late API is unreachable and no local items', async () => {
    const calendar = await getScheduleCalendar()
    expect(calendar).toEqual([])
  })

  it('findNextSlot accepts SlotOptions with ideaIds and publishBy', async () => {
    const slot = await findNextSlot('linkedin', 'medium-clip', {
      ideaIds: ['idea-123'],
      publishBy: '2099-12-31T23:59:59Z',
    })

    expect(slot).toBeTruthy()
    expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('findNextSlot without ideaIds behaves identically to no options', async () => {
    const slotWithoutOptions = await findNextSlot('linkedin', 'medium-clip')

    clearScheduleCache()

    const slotWithoutIdeaIds = await findNextSlot('linkedin', 'medium-clip', {})

    expect(slotWithoutIdeaIds).toBe(slotWithoutOptions)
  })

  it('SlotOptions type is properly exported', () => {
    const slotOptions: SlotOptions = {
      ideaIds: ['idea-123'],
      publishBy: '2099-12-31T23:59:59Z',
    }

    expect(slotOptions).toEqual({
      ideaIds: ['idea-123'],
      publishBy: '2099-12-31T23:59:59Z',
    })
  })
})

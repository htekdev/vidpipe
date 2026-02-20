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

import { getScheduleCalendar } from '../../../L3-services/scheduler/scheduler.js'
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
})

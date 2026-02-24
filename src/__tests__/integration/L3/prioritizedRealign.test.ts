import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock L1 infrastructure
vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

const mockOutputDir = vi.hoisted(() => {
  const os = require('node:os')
  const path = require('node:path')
  return path.join(os.tmpdir(), 'vidpipe-prioritized-realign-l3-test')
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: mockOutputDir,
    LATE_API_KEY: '',
  }),
  initConfig: vi.fn(),
}))

import { buildPrioritizedRealignPlan } from '../../../L3-services/scheduler/realign.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

describe('L3 Integration: prioritized realign with no Late API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
  })

  it('requires Late API key for prioritized realign', async () => {
    await expect(
      buildPrioritizedRealignPlan({
        priorities: [{ keywords: ['devops'], saturation: 1.0 }],
      }),
    ).rejects.toThrow('LATE_API_KEY')
  })
})

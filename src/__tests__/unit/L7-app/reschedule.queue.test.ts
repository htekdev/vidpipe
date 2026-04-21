import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockSyncQueuesToLate = vi.hoisted(() => vi.fn())
const mockRescheduleIdeaPosts = vi.hoisted(() => vi.fn())
const mockLoadScheduleConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ timezone: 'America/Chicago', platforms: {} }))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L3-services/queueSync/queueSync.js', () => ({
  syncQueuesToLate: mockSyncQueuesToLate,
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  rescheduleIdeaPosts: mockRescheduleIdeaPosts,
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { runReschedule } from '../../../L7-app/commands/reschedule.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('reschedule --queue', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockSyncQueuesToLate.mockResolvedValue({
      created: [],
      updated: ['linkedin-short'],
      deleted: [],
      unchanged: [],
      errors: [],
    })
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('calls syncQueuesToLate with reshuffle when queue flag is set', async () => {
    await runReschedule({ queue: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledOnce()
    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffle: true }),
    )
  })

  it('passes dryRun through to syncQueuesToLate', async () => {
    await runReschedule({ queue: true, dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffle: true, dryRun: true }),
    )
  })

  it('does NOT call the legacy reschedule path when --queue is set', async () => {
    await runReschedule({ queue: true })

    expect(mockRescheduleIdeaPosts).not.toHaveBeenCalled()
    expect(mockLoadScheduleConfig).not.toHaveBeenCalled()
  })
})

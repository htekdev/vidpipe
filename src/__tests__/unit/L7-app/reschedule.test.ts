import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockRescheduleIdeaPosts = vi.hoisted(() => vi.fn())
const mockLoadScheduleConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ timezone: 'America/Chicago', platforms: {} }))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  rescheduleIdeaPosts: mockRescheduleIdeaPosts,
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

// ── Import after mocks ────────────────────────────────────────────────

import type { RescheduleResult } from '../../../L3-services/scheduler/scheduler.js'

// ── Helpers ───────────────────────────────────────────────────────────

function makeResult(overrides: Partial<RescheduleResult> = {}): RescheduleResult {
  return {
    rescheduled: 0,
    unchanged: 0,
    failed: 0,
    details: [],
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('reschedule command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  function getOutput(): string {
    return consoleLogSpy.mock.calls.map((call: unknown[]) => String(call[0])).join('\n')
  }

  it('calls initConfig before rescheduleIdeaPosts', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockRescheduleIdeaPosts).toHaveBeenCalled()

    const initOrder = mockInitConfig.mock.invocationCallOrder[0]
    const reschedOrder = mockRescheduleIdeaPosts.mock.invocationCallOrder[0]
    expect(initOrder).toBeLessThan(reschedOrder)
  })

  it('passes dryRun option to rescheduleIdeaPosts', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule({ dryRun: true })

    expect(mockRescheduleIdeaPosts).toHaveBeenCalledWith({ dryRun: true })
  })

  it('prints dry run banner when dryRun is true', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule({ dryRun: true })

    expect(getOutput()).toContain('Dry run')
  })

  it('displays "no posts found" when details are empty', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    expect(getOutput()).toContain('No idea-linked posts found')
  })

  it('groups results by platform and shows rescheduled posts', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 1,
      unchanged: 1,
      details: [
        {
          itemId: 'item-tiktok-1',
          platform: 'tiktok',
          latePostId: 'late-1',
          oldSlot: '2026-03-01T19:00:00-06:00',
          newSlot: '2026-03-02T19:00:00-06:00',
        },
        {
          itemId: 'item-tiktok-2',
          platform: 'tiktok',
          latePostId: 'late-2',
          oldSlot: '2026-03-03T19:00:00-06:00',
          newSlot: '2026-03-03T19:00:00-06:00',
        },
      ],
    }))

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    const output = getOutput()
    expect(output).toContain('tiktok')
    expect(output).toContain('item-tiktok-1')
    expect(output).toContain('🔄') // rescheduled indicator
    expect(output).toContain('item-tiktok-2')
    expect(output).toContain('✅') // unchanged indicator
    expect(output).toContain('1 moved')
    expect(output).toContain('1 unchanged')
    expect(output).toContain('0 failed')
  })

  it('shows error icon for failed items', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      failed: 1,
      details: [
        {
          itemId: 'item-fail',
          platform: 'youtube',
          latePostId: 'late-fail',
          oldSlot: null,
          newSlot: null,
          error: 'No schedule config',
        },
      ],
    }))

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    const output = getOutput()
    expect(output).toContain('❌')
    expect(output).toContain('No schedule config')
    expect(output).toContain('1 failed')
  })

  it('shows platform icons for known platforms', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 2,
      details: [
        {
          itemId: 'item-li',
          platform: 'linkedin',
          latePostId: 'late-li',
          oldSlot: '2026-03-01T08:00:00-06:00',
          newSlot: '2026-03-02T08:00:00-06:00',
        },
        {
          itemId: 'item-ig',
          platform: 'instagram',
          latePostId: 'late-ig',
          oldSlot: '2026-03-01T10:00:00-06:00',
          newSlot: '2026-03-02T10:00:00-06:00',
        },
      ],
    }))

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    const output = getOutput()
    expect(output).toContain('💼') // linkedin icon
    expect(output).toContain('📸') // instagram icon
  })

  it('defaults to empty options when none provided', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    expect(mockRescheduleIdeaPosts).toHaveBeenCalledWith({ dryRun: undefined })
  })

  it('formats dates using timezone from schedule config', async () => {
    mockLoadScheduleConfig.mockResolvedValue({ timezone: 'Asia/Tokyo', platforms: {} })
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 1,
      details: [
        {
          itemId: 'tz-item',
          platform: 'tiktok',
          latePostId: 'late-tz',
          oldSlot: '2026-03-01T10:00:00Z',
          newSlot: '2026-03-02T10:00:00Z',
        },
      ],
    }))

    const { runReschedule } = await import('../../../L7-app/commands/reschedule.js')
    await runReschedule()

    expect(mockLoadScheduleConfig).toHaveBeenCalled()
    const output = getOutput()
    // Tokyo is UTC+9, so 10:00 UTC → 19:00 JST (7:00 PM)
    expect(output).toContain('7:00')
  })
})

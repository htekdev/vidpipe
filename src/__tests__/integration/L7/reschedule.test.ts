/**
 * L7 Integration Test — reschedule command
 *
 * Mock boundary: L1 infrastructure + L3 services
 * Real code:     L7 reschedule command logic
 *
 * Validates the reschedule CLI command correctly delegates to
 * rescheduleIdeaPosts and formats output for the user.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: () => ({
    OUTPUT_DIR: '/tmp/vidpipe-reschedule-test',
    LATE_API_KEY: 'test-key',
  }),
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── Mock L3 services ──────────────────────────────────────────────────

const mockRescheduleIdeaPosts = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  rescheduleIdeaPosts: mockRescheduleIdeaPosts,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { runReschedule } from '../../../L7-app/commands/reschedule.js'
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

describe('L7 Integration: reschedule command', () => {
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

  it('initializes config before calling rescheduleIdeaPosts', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    await runReschedule()

    expect(mockInitConfig).toHaveBeenCalledOnce()
    expect(mockRescheduleIdeaPosts).toHaveBeenCalledOnce()
  })

  it('passes dryRun: true through to rescheduleIdeaPosts', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    await runReschedule({ dryRun: true })

    expect(mockRescheduleIdeaPosts).toHaveBeenCalledWith({ dryRun: true })
  })

  it('displays dry run banner when dryRun is set', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    await runReschedule({ dryRun: true })

    expect(getOutput()).toContain('Dry run')
  })

  it('reports no posts found message when result has empty details', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult())

    await runReschedule()

    expect(getOutput()).toContain('No idea-linked posts found')
  })

  it('displays summary with correct counts for mixed results', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 2,
      unchanged: 1,
      failed: 1,
      details: [
        {
          itemId: 'item-1',
          platform: 'tiktok',
          latePostId: 'late-1',
          oldSlot: '2026-03-01T19:00:00-06:00',
          newSlot: '2026-03-02T19:00:00-06:00',
        },
        {
          itemId: 'item-2',
          platform: 'tiktok',
          latePostId: 'late-2',
          oldSlot: '2026-03-03T19:00:00-06:00',
          newSlot: '2026-03-04T19:00:00-06:00',
        },
        {
          itemId: 'item-3',
          platform: 'linkedin',
          latePostId: 'late-3',
          oldSlot: '2026-03-05T08:00:00-06:00',
          newSlot: '2026-03-05T08:00:00-06:00',
        },
        {
          itemId: 'item-4',
          platform: 'youtube',
          latePostId: 'late-4',
          oldSlot: null,
          newSlot: null,
          error: 'No slot found',
        },
      ],
    }))

    await runReschedule()

    const output = getOutput()
    // Summary line
    expect(output).toContain('2 moved')
    expect(output).toContain('1 unchanged')
    expect(output).toContain('1 failed')
    // Platform grouping
    expect(output).toContain('tiktok')
    expect(output).toContain('linkedin')
    expect(output).toContain('youtube')
  })

  it('shows rescheduled items with arrow indicator', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 1,
      details: [
        {
          itemId: 'moved-item',
          platform: 'instagram',
          latePostId: 'late-moved',
          oldSlot: '2026-04-01T10:00:00-06:00',
          newSlot: '2026-04-03T10:00:00-06:00',
        },
      ],
    }))

    await runReschedule()

    const output = getOutput()
    expect(output).toContain('🔄')
    expect(output).toContain('moved-item')
    expect(output).toContain('→')
  })

  it('shows failed items with error message', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      failed: 1,
      details: [
        {
          itemId: 'fail-item',
          platform: 'twitter',
          latePostId: 'late-fail',
          oldSlot: '2026-04-01T08:30:00-06:00',
          newSlot: null,
          error: 'API timeout',
        },
      ],
    }))

    await runReschedule()

    const output = getOutput()
    expect(output).toContain('❌')
    expect(output).toContain('API timeout')
  })

  it('shows unchanged items with checkmark', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      unchanged: 1,
      details: [
        {
          itemId: 'same-item',
          platform: 'linkedin',
          latePostId: 'late-same',
          oldSlot: '2026-04-01T08:00:00-06:00',
          newSlot: '2026-04-01T08:00:00-06:00',
        },
      ],
    }))

    await runReschedule()

    const output = getOutput()
    expect(output).toContain('✅')
    expect(output).toContain('same-item')
    expect(output).toContain('unchanged')
  })

  it('handles unscheduled posts (oldSlot is null)', async () => {
    mockRescheduleIdeaPosts.mockResolvedValue(makeResult({
      rescheduled: 1,
      details: [
        {
          itemId: 'unsched-item',
          platform: 'tiktok',
          latePostId: 'late-unsched',
          oldSlot: null,
          newSlot: '2026-04-05T19:00:00-06:00',
        },
      ],
    }))

    await runReschedule()

    const output = getOutput()
    // When oldSlot is null and newSlot differs, it should show the move
    expect(output).toContain('unsched-item')
    expect(output).toContain('unscheduled')
  })
})

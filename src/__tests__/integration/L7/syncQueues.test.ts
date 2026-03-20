import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks (L1 + L3) ────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockSyncQueuesToLate = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/queueSync.js', () => ({
  syncQueuesToLate: mockSyncQueuesToLate,
}))

// ── Import after mocks ─────────────────────────────────────────────────

import { runSyncQueues } from '../../../L7-app/commands/syncQueues.js'

// ── Helpers ─────────────────────────────────────────────────────────────

function makePlan(overrides: {
  toCreate?: Array<{ name: string; platform: string; clipType: string; slots: unknown[] }>
  toUpdate?: Array<{ queueId: string; name: string; currentSlots: unknown[]; slots: unknown[] }>
  unchanged?: Array<{ queueId: string; name: string }>
  toDelete?: Array<{ queueId: string; name: string }>
} = {}) {
  return {
    toCreate: overrides.toCreate ?? [],
    toUpdate: overrides.toUpdate ?? [],
    unchanged: overrides.unchanged ?? [],
    toDelete: overrides.toDelete ?? [],
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

let consoleLogSpy: ReturnType<typeof vi.spyOn>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  process.exitCode = undefined
})

// ── Tests ───────────────────────────────────────────────────────────────

describe('L7 Unit: runSyncQueues', () => {
  it('prints plan and dry-run message when dryRun is true', async () => {
    const plan = makePlan({
      toCreate: [{ name: 'tiktok-shorts', platform: 'tiktok', clipType: 'short', slots: [{ dayOfWeek: 1, time: '09:00' }] }],
    })
    mockSyncQueuesToLate.mockResolvedValue({ plan, result: undefined })

    await runSyncQueues({ dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true }),
    )
    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
    expect(output).toContain('DRY RUN')
    expect(output).toContain('tiktok-shorts')
  })

  it('prints result counts on successful sync', async () => {
    const plan = makePlan({
      toCreate: [{ name: 'yt-shorts', platform: 'youtube', clipType: 'short', slots: [] }],
      unchanged: [{ queueId: 'q-1', name: 'ig-shorts' }],
    })
    const result = { created: 1, updated: 0, unchanged: 1, errors: [] }
    mockSyncQueuesToLate.mockResolvedValue({ plan, result })

    await runSyncQueues()

    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
    expect(output).toContain('1 created')
    expect(output).toContain('1 unchanged')
    expect(output).not.toContain('DRY RUN')
  })

  it('prints result counts and error details when sync has errors', async () => {
    const plan = makePlan({
      toUpdate: [{ queueId: 'q-1', name: 'x-shorts', currentSlots: [], slots: [{ dayOfWeek: 0, time: '10:00' }] }],
      toDelete: [{ queueId: 'q-del', name: 'old-queue' }],
    })
    const result = {
      created: 0,
      updated: 1,
      unchanged: 0,
      errors: [{ name: 'bad-queue', error: 'API timeout' }],
    }
    mockSyncQueuesToLate.mockResolvedValue({ plan, result })

    await runSyncQueues({ reshuffle: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffleExisting: true }),
    )
    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
    expect(output).toContain('1 updated')
    expect(output).toContain('1 failed')
    expect(output).toContain('bad-queue')
    expect(output).toContain('API timeout')
    expect(output).toContain('old-queue')
  })

  it('logs error and sets exitCode when syncQueuesToLate throws', async () => {
    mockSyncQueuesToLate.mockRejectedValue(new Error('Network down'))

    await runSyncQueues()

    const errOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
    expect(errOutput).toContain('Queue sync failed')
    expect(errOutput).toContain('Network down')
    expect(process.exitCode).toBe(1)
  })

  it('handles non-Error thrown values', async () => {
    mockSyncQueuesToLate.mockRejectedValue('raw string error')

    await runSyncQueues()

    const errOutput = consoleErrorSpy.mock.calls.map((c: unknown[]) => c[0]).join('\n')
    expect(errOutput).toContain('raw string error')
    expect(process.exitCode).toBe(1)
  })
})

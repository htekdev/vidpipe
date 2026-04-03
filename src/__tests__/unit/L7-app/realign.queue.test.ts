import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockSyncQueuesToLate = vi.hoisted(() => vi.fn())
const mockBuildRealignPlan = vi.hoisted(() => vi.fn())
const mockExecuteRealignPlan = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../L3-services/queueSync/queueSync.js', () => ({
  syncQueuesToLate: mockSyncQueuesToLate,
}))

vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: mockBuildRealignPlan,
  executeRealignPlan: mockExecuteRealignPlan,
}))

// ── Import after mocks ────────────────────────────────────────────────

import { runRealign } from '../../../L7-app/commands/realign.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('realign --queue', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    mockSyncQueuesToLate.mockResolvedValue({
      created: [],
      updated: ['linkedin-short', 'youtube-short'],
      deleted: [],
      unchanged: [],
      errors: [],
    })
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  it('calls syncQueuesToLate with reshuffle when queue flag is set', async () => {
    await runRealign({ queue: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledOnce()
    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffle: true }),
    )
  })

  it('passes dryRun through to syncQueuesToLate', async () => {
    await runRealign({ queue: true, dryRun: true })

    expect(mockSyncQueuesToLate).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffle: true, dryRun: true }),
    )
  })

  it('does NOT call the legacy realign path when --queue is set', async () => {
    await runRealign({ queue: true })

    expect(mockBuildRealignPlan).not.toHaveBeenCalled()
    expect(mockExecuteRealignPlan).not.toHaveBeenCalled()
  })

  it('prints queue reshuffle summary', async () => {
    await runRealign({ queue: true })

    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('queue reshuffle')
    expect(output).toContain('2 queues reshuffled')
  })

  it('prints errors from queue sync', async () => {
    mockSyncQueuesToLate.mockResolvedValue({
      created: [],
      updated: [],
      deleted: [],
      unchanged: [],
      errors: [{ queueName: 'x-short', error: 'Rate limited' }],
    })

    await runRealign({ queue: true })

    const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
    expect(output).toContain('x-short')
    expect(output).toContain('Rate limited')
  })
})

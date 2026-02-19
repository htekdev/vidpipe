/**
 * L3 Integration Test — processingState service
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L3 processingState business logic
 *
 * Validates that the state machine correctly transitions videos
 * through pending → processing → completed/failed when given
 * controlled file I/O.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const mockState: Record<string, unknown> = {}

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: vi.fn(async (_path: string, fallback: unknown) => mockState.data ?? fallback),
  writeJsonFile: vi.fn(async (_path: string, data: unknown) => { mockState.data = data }),
  fileExistsSync: vi.fn(() => mockState.data !== undefined),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: '/test/output' }),
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import {
  getVideoStatus,
  getUnprocessed,
  isCompleted,
  markPending,
  markProcessing,
  markCompleted,
  markFailed,
  getFullState,
} from '../../../L3-services/processingState/processingState.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: processingState', () => {
  beforeEach(() => {
    mockState.data = undefined
    vi.clearAllMocks()
  })

  it('returns empty state when no file exists', async () => {
    const state = await getFullState()
    expect(state).toEqual({ videos: {} })
  })

  it('transitions through full lifecycle: pending → processing → completed', async () => {
    await markPending('my-video', '/path/to/video.mp4')

    let status = await getVideoStatus('my-video')
    expect(status?.status).toBe('pending')
    expect(status?.sourcePath).toBe('/path/to/video.mp4')

    await markProcessing('my-video')
    status = await getVideoStatus('my-video')
    expect(status?.status).toBe('processing')
    expect(status?.startedAt).toBeDefined()

    await markCompleted('my-video')
    status = await getVideoStatus('my-video')
    expect(status?.status).toBe('completed')
    expect(status?.completedAt).toBeDefined()

    expect(await isCompleted('my-video')).toBe(true)
  })

  it('tracks failed videos with error message', async () => {
    await markPending('fail-video', '/path/to/fail.mp4')
    await markProcessing('fail-video')
    await markFailed('fail-video', 'FFmpeg crashed')

    const status = await getVideoStatus('fail-video')
    expect(status?.status).toBe('failed')
    expect(status?.error).toBe('FFmpeg crashed')
  })

  it('getUnprocessed returns pending and failed videos only', async () => {
    await markPending('pending-one', '/a.mp4')
    await markPending('will-complete', '/b.mp4')
    await markPending('will-fail', '/c.mp4')

    await markProcessing('will-complete')
    await markCompleted('will-complete')

    await markProcessing('will-fail')
    await markFailed('will-fail', 'out of disk')

    const unprocessed = await getUnprocessed()
    expect(Object.keys(unprocessed)).toContain('pending-one')
    expect(Object.keys(unprocessed)).toContain('will-fail')
    expect(Object.keys(unprocessed)).not.toContain('will-complete')
  })

  it('handles unknown slug gracefully', async () => {
    await markProcessing('ghost')
    const status = await getVideoStatus('ghost')
    expect(status).toBeUndefined()
  })
})

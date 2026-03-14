/**
 * processingState service integration-style tests with a stateful L2 videoStore mock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStore } = vi.hoisted(() => {
  type Status = 'pending' | 'processing' | 'completed' | 'failed'
  type Row = {
    slug: string
    source_path: string
    status: Status
    started_at: string | null
    completed_at: string | null
    error: string | null
    created_at: string
    updated_at: string
  }

  const rows = new Map<string, Row>()

  function cloneRow(row: Row): Row {
    return { ...row }
  }

  function sortRows(values: Iterable<Row>): Row[] {
    return Array.from(values)
      .map(cloneRow)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
  }

  return {
    mockStore: {
      reset() {
        rows.clear()
      },
      getVideo(slug: string) {
        const row = rows.get(slug)
        return row ? cloneRow(row) : undefined
      },
      getVideosByStatus(status: Status) {
        return sortRows(Array.from(rows.values()).filter(row => row.status === status))
      },
      getUnprocessedVideos() {
        return sortRows(Array.from(rows.values()).filter(row => row.status === 'pending' || row.status === 'failed'))
      },
      upsertVideo(slug: string, sourcePath: string, status: Status) {
        const existing = rows.get(slug)
        const now = new Date().toISOString()
        rows.set(slug, {
          slug,
          source_path: sourcePath,
          status,
          started_at: null,
          completed_at: null,
          error: null,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        })
      },
      updateVideoStatus(slug: string, status: Status, extras?: { startedAt?: string; completedAt?: string; error?: string }) {
        const existing = rows.get(slug)
        if (!existing) {
          return
        }

        rows.set(slug, {
          ...existing,
          status,
          started_at: extras?.startedAt ?? existing.started_at,
          completed_at: extras?.completedAt ?? existing.completed_at,
          error: extras?.error ?? existing.error,
          updated_at: new Date().toISOString(),
        })
      },
      getAllVideos() {
        return sortRows(rows.values())
      },
    },
  }
})

vi.mock('../../../L2-clients/dataStore/videoStore.js', () => ({
  getVideo: (slug: string) => mockStore.getVideo(slug),
  getVideosByStatus: (status: 'pending' | 'processing' | 'completed' | 'failed') => mockStore.getVideosByStatus(status),
  getUnprocessedVideos: () => mockStore.getUnprocessedVideos(),
  upsertVideo: (slug: string, sourcePath: string, status: 'pending' | 'processing' | 'completed' | 'failed') => mockStore.upsertVideo(slug, sourcePath, status),
  updateVideoStatus: (slug: string, status: 'pending' | 'processing' | 'completed' | 'failed', extras?: { startedAt?: string; completedAt?: string; error?: string }) => mockStore.updateVideoStatus(slug, status, extras),
  getAllVideos: () => mockStore.getAllVideos(),
}))

import {
  getFullState,
  getUnprocessed,
  getVideoStatus,
  isCompleted,
  markCompleted,
  markFailed,
  markPending,
  markProcessing,
} from '../../../L3-services/processingState/processingState.js'

describe('L3 Integration: processingState', () => {
  beforeEach(() => {
    mockStore.reset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty state when no videos exist', async () => {
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
    expect(status?.startedAt).toBe('2025-06-01T12:00:00.000Z')

    await markCompleted('my-video')
    status = await getVideoStatus('my-video')
    expect(status?.status).toBe('completed')
    expect(status?.completedAt).toBe('2025-06-01T12:00:00.000Z')

    expect(await isCompleted('my-video')).toBe(true)
  })

  it('tracks failed videos with error message', async () => {
    await markPending('fail-video', '/path/to/fail.mp4')
    await markProcessing('fail-video')
    await markFailed('fail-video', 'FFmpeg crashed')

    const status = await getVideoStatus('fail-video')
    expect(status).toEqual({
      status: 'failed',
      sourcePath: '/path/to/fail.mp4',
      startedAt: '2025-06-01T12:00:00.000Z',
      completedAt: '2025-06-01T12:00:00.000Z',
      error: 'FFmpeg crashed',
    })
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeDatabase, getDatabase, initializeDatabase, resetDatabaseSingleton } from '../../../L1-infra/database/index.js'
import {
  getAllVideos,
  getUnprocessedVideos,
  getVideo,
  getVideosByStatus,
  isVideoCompleted,
  updateVideoStatus,
  upsertVideo,
} from '../../../L2-clients/dataStore/videoStore.js'

describe('videoStore', () => {
  beforeEach(() => {
    closeDatabase()
    resetDatabaseSingleton()
    initializeDatabase({ inMemory: true })
  })

  afterEach(() => {
    closeDatabase()
    resetDatabaseSingleton()
  })

  it('VideoStore.REQ-001 - upserts and fetches a video row by slug', () => {
    upsertVideo('alpha', 'C:/videos/alpha.mp4', 'pending')

    expect(getVideo('alpha')).toEqual(
      expect.objectContaining({
        slug: 'alpha',
        source_path: 'C:/videos/alpha.mp4',
        status: 'pending',
        started_at: null,
        completed_at: null,
        error: null,
      }),
    )
  })

  it('VideoStore.REQ-005 - preserves created_at when upserting an existing row', () => {
    upsertVideo('alpha', 'C:/videos/alpha.mp4', 'pending')
    const initial = getVideo('alpha')

    expect(initial).toBeDefined()

    updateVideoStatus('alpha', 'processing', { startedAt: '2026-02-10T09:00:00.000Z', error: 'old error' })
    upsertVideo('alpha', 'C:/videos/alpha-v2.mp4', 'completed')

    const updated = getVideo('alpha')
    expect(updated).toMatchObject({
      slug: 'alpha',
      source_path: 'C:/videos/alpha-v2.mp4',
      status: 'completed',
      started_at: null,
      completed_at: null,
      error: null,
      created_at: initial!.created_at,
    })
  })

  it('VideoStore.REQ-002/REQ-003 - filters videos by status and unprocessed states', () => {
    upsertVideo('pending-video', 'C:/videos/pending.mp4', 'pending')
    upsertVideo('failed-video', 'C:/videos/failed.mp4', 'failed')
    upsertVideo('done-video', 'C:/videos/done.mp4', 'completed')

    expect(getVideosByStatus('failed').map(video => video.slug)).toEqual(['failed-video'])
    expect(getUnprocessedVideos().map(video => video.slug).sort()).toEqual(['failed-video', 'pending-video'])
  })

  it('VideoStore.REQ-004 - reports whether a video completed', () => {
    upsertVideo('done-video', 'C:/videos/done.mp4', 'completed')
    upsertVideo('pending-video', 'C:/videos/pending.mp4', 'pending')

    expect(isVideoCompleted('done-video')).toBe(true)
    expect(isVideoCompleted('pending-video')).toBe(false)
    expect(isVideoCompleted('missing-video')).toBe(false)
  })

  it('VideoStore.REQ-006 - updates status with optional extras and preserves omitted fields', () => {
    upsertVideo('alpha', 'C:/videos/alpha.mp4', 'pending')

    updateVideoStatus('alpha', 'processing', { startedAt: '2026-02-10T10:00:00.000Z', error: 'transient failure' })
    updateVideoStatus('alpha', 'completed', { completedAt: '2026-02-10T10:15:00.000Z' })

    expect(getVideo('alpha')).toMatchObject({
      slug: 'alpha',
      status: 'completed',
      started_at: '2026-02-10T10:00:00.000Z',
      completed_at: '2026-02-10T10:15:00.000Z',
      error: 'transient failure',
    })
  })

  it('VideoStore.REQ-007 - returns all videos ordered by created_at descending', () => {
    const db = getDatabase()
    const insert = db.prepare(`
      INSERT INTO videos (
        slug,
        source_path,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `)

    insert.run('older', 'C:/videos/older.mp4', 'pending', '2026-02-10 10:00:00', '2026-02-10 10:00:00')
    insert.run('newer', 'C:/videos/newer.mp4', 'completed', '2026-02-10 12:00:00', '2026-02-10 12:00:00')

    expect(getAllVideos().map(video => video.slug)).toEqual(['newer', 'older'])
  })
})

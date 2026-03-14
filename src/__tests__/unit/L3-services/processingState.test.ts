import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetAllVideos,
  mockGetUnprocessedVideos,
  mockGetVideo,
  mockGetVideosByStatus,
  mockUpdateVideoStatus,
  mockUpsertVideo,
} = vi.hoisted(() => ({
  mockGetAllVideos: vi.fn() as ReturnType<typeof vi.fn>,
  mockGetUnprocessedVideos: vi.fn() as ReturnType<typeof vi.fn>,
  mockGetVideo: vi.fn() as ReturnType<typeof vi.fn>,
  mockGetVideosByStatus: vi.fn() as ReturnType<typeof vi.fn>,
  mockUpdateVideoStatus: vi.fn() as ReturnType<typeof vi.fn>,
  mockUpsertVideo: vi.fn() as ReturnType<typeof vi.fn>,
}))

vi.mock('../../../L2-clients/dataStore/videoStore.js', () => ({
  getAllVideos: mockGetAllVideos,
  getUnprocessedVideos: mockGetUnprocessedVideos,
  getVideo: mockGetVideo,
  getVideosByStatus: mockGetVideosByStatus,
  updateVideoStatus: mockUpdateVideoStatus,
  upsertVideo: mockUpsertVideo,
}))

import {
  getFullState,
  getUnprocessed,
  getVideoStatus,
  getVideosByStatus,
  isCompleted,
  markCompleted,
  markFailed,
  markPending,
  markProcessing,
} from '../../../L3-services/processingState/processingState.js'

function createRow(overrides: Partial<{
  slug: string
  source_path: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
  updated_at: string
}> = {}) {
  return {
    slug: 'video',
    source_path: 'C:/videos/video.mp4',
    status: 'pending' as const,
    started_at: null,
    completed_at: null,
    error: null,
    created_at: '2025-06-01T10:00:00.000Z',
    updated_at: '2025-06-01T10:00:00.000Z',
    ...overrides,
  }
}

describe('processingState', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('markPending', () => {
    it('creates a new entry with status pending', async () => {
      await markPending('my-video', '/source/my-video.mp4')

      expect(mockUpsertVideo).toHaveBeenCalledWith('my-video', '/source/my-video.mp4', 'pending')
    })

    it('preserves existing entries when adding a new one', async () => {
      const rows = new Map([
        ['existing-video', createRow({ slug: 'existing-video', source_path: '/old.mp4', status: 'completed' })],
      ])

      mockUpsertVideo.mockImplementation((slug: string, sourcePath: string, status: string) => {
        rows.set(slug, createRow({ slug, source_path: sourcePath, status: status as 'pending' | 'processing' | 'completed' | 'failed' }))
      })
      mockGetAllVideos.mockImplementation(() => Array.from(rows.values()))

      await markPending('new-video', '/source/new-video.mp4')

      expect(await getFullState()).toEqual({
        videos: {
          'existing-video': {
            status: 'completed',
            sourcePath: '/old.mp4',
          },
          'new-video': {
            status: 'pending',
            sourcePath: '/source/new-video.mp4',
          },
        },
      })
    })
  })

  describe('markProcessing', () => {
    it('transitions from pending to processing with startedAt', async () => {
      await markProcessing('my-video')

      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('my-video', 'processing', {
        startedAt: '2025-06-01T12:00:00.000Z',
      })
    })

    it('handles unknown slug gracefully', async () => {
      await expect(markProcessing('unknown-slug')).resolves.toBeUndefined()
      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('unknown-slug', 'processing', {
        startedAt: '2025-06-01T12:00:00.000Z',
      })
    })
  })

  describe('markCompleted', () => {
    it('transitions to completed with completedAt', async () => {
      await markCompleted('my-video')

      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('my-video', 'completed', {
        completedAt: '2025-06-01T12:00:00.000Z',
      })
    })

    it('handles unknown slug gracefully', async () => {
      await expect(markCompleted('unknown-slug')).resolves.toBeUndefined()
      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('unknown-slug', 'completed', {
        completedAt: '2025-06-01T12:00:00.000Z',
      })
    })
  })

  describe('markFailed', () => {
    it('transitions to failed with error message and completedAt', async () => {
      await markFailed('my-video', 'FFmpeg crashed')

      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('my-video', 'failed', {
        completedAt: '2025-06-01T12:00:00.000Z',
        error: 'FFmpeg crashed',
      })
    })

    it('handles unknown slug gracefully', async () => {
      await expect(markFailed('unknown-slug', 'some error')).resolves.toBeUndefined()
      expect(mockUpdateVideoStatus).toHaveBeenCalledWith('unknown-slug', 'failed', {
        completedAt: '2025-06-01T12:00:00.000Z',
        error: 'some error',
      })
    })
  })

  describe('state transitions', () => {
    it('pending → processing → completed', async () => {
      const rows = new Map<string, ReturnType<typeof createRow>>()

      mockUpsertVideo.mockImplementation((slug: string, sourcePath: string, status: string) => {
        rows.set(slug, createRow({ slug, source_path: sourcePath, status: status as 'pending' | 'processing' | 'completed' | 'failed' }))
      })
      mockUpdateVideoStatus.mockImplementation((slug: string, status: string, extras?: { startedAt?: string; completedAt?: string; error?: string }) => {
        const existing = rows.get(slug)
        if (!existing) {
          return
        }

        rows.set(slug, {
          ...existing,
          status: status as 'pending' | 'processing' | 'completed' | 'failed',
          started_at: extras?.startedAt ?? existing.started_at,
          completed_at: extras?.completedAt ?? existing.completed_at,
          error: extras?.error ?? existing.error,
        })
      })
      mockGetVideo.mockImplementation((slug: string) => rows.get(slug))

      await markPending('vid', '/source/vid.mp4')
      expect((await getVideoStatus('vid'))?.status).toBe('pending')

      await markProcessing('vid')
      expect(await getVideoStatus('vid')).toEqual({
        status: 'processing',
        sourcePath: '/source/vid.mp4',
        startedAt: '2025-06-01T12:00:00.000Z',
      })

      await markCompleted('vid')
      expect(await getVideoStatus('vid')).toEqual({
        status: 'completed',
        sourcePath: '/source/vid.mp4',
        startedAt: '2025-06-01T12:00:00.000Z',
        completedAt: '2025-06-01T12:00:00.000Z',
      })
    })

    it('pending → processing → failed', async () => {
      const rows = new Map<string, ReturnType<typeof createRow>>()

      mockUpsertVideo.mockImplementation((slug: string, sourcePath: string, status: string) => {
        rows.set(slug, createRow({ slug, source_path: sourcePath, status: status as 'pending' | 'processing' | 'completed' | 'failed' }))
      })
      mockUpdateVideoStatus.mockImplementation((slug: string, status: string, extras?: { startedAt?: string; completedAt?: string; error?: string }) => {
        const existing = rows.get(slug)
        if (!existing) {
          return
        }

        rows.set(slug, {
          ...existing,
          status: status as 'pending' | 'processing' | 'completed' | 'failed',
          started_at: extras?.startedAt ?? existing.started_at,
          completed_at: extras?.completedAt ?? existing.completed_at,
          error: extras?.error ?? existing.error,
        })
      })
      mockGetVideo.mockImplementation((slug: string) => rows.get(slug))

      await markPending('vid', '/source/vid.mp4')
      await markProcessing('vid')
      await markFailed('vid', 'out of memory')

      expect(await getVideoStatus('vid')).toEqual({
        status: 'failed',
        sourcePath: '/source/vid.mp4',
        startedAt: '2025-06-01T12:00:00.000Z',
        completedAt: '2025-06-01T12:00:00.000Z',
        error: 'out of memory',
      })
    })
  })

  describe('getVideoStatus', () => {
    it('returns state for an existing slug', async () => {
      mockGetVideo.mockReturnValue(createRow({
        slug: 'my-video',
        source_path: '/source/my-video.mp4',
        status: 'completed',
      }))

      const result = await getVideoStatus('my-video')

      expect(result).toEqual({ status: 'completed', sourcePath: '/source/my-video.mp4' })
    })

    it('returns undefined for a non-existent slug', async () => {
      mockGetVideo.mockReturnValue(undefined)

      const result = await getVideoStatus('no-such-video')

      expect(result).toBeUndefined()
    })
  })

  describe('getUnprocessed', () => {
    it('returns only pending and failed videos', async () => {
      mockGetUnprocessedVideos.mockReturnValue([
        createRow({ slug: 'vid-pending', source_path: '/a.mp4', status: 'pending' }),
        createRow({ slug: 'vid-failed', source_path: '/d.mp4', status: 'failed', error: 'err' }),
      ])

      const result = await getUnprocessed()

      expect(result).toEqual({
        'vid-pending': { status: 'pending', sourcePath: '/a.mp4' },
        'vid-failed': { status: 'failed', sourcePath: '/d.mp4', error: 'err' },
      })
    })

    it('returns empty object when no videos exist', async () => {
      mockGetUnprocessedVideos.mockReturnValue([])

      const result = await getUnprocessed()

      expect(result).toEqual({})
    })
  })

  describe('isCompleted', () => {
    it('returns true for a completed video', async () => {
      mockGetVideo.mockReturnValue(createRow({ slug: 'my-video', status: 'completed', source_path: '/a.mp4' }))

      expect(await isCompleted('my-video')).toBe(true)
    })

    it('returns false for a non-completed video', async () => {
      mockGetVideo.mockReturnValue(createRow({ slug: 'my-video', status: 'processing', source_path: '/a.mp4' }))

      expect(await isCompleted('my-video')).toBe(false)
    })

    it('returns false for a non-existent slug', async () => {
      mockGetVideo.mockReturnValue(undefined)

      expect(await isCompleted('no-such-video')).toBe(false)
    })
  })

  describe('getVideosByStatus', () => {
    it('returns only videos matching the requested status', async () => {
      mockGetVideosByStatus.mockReturnValue([
        createRow({ slug: 'vid-a', status: 'pending', source_path: '/a.mp4' }),
        createRow({ slug: 'vid-c', status: 'pending', source_path: '/c.mp4' }),
      ])

      const result = await getVideosByStatus('pending')

      expect(result).toEqual({
        'vid-a': { status: 'pending', sourcePath: '/a.mp4' },
        'vid-c': { status: 'pending', sourcePath: '/c.mp4' },
      })
    })

    it('returns empty object when no videos match', async () => {
      mockGetVideosByStatus.mockReturnValue([])

      const result = await getVideosByStatus('failed')

      expect(result).toEqual({})
    })
  })

  describe('getFullState', () => {
    it('returns all videos keyed by slug', async () => {
      mockGetAllVideos.mockReturnValue([
        createRow({ slug: 'older', status: 'pending', source_path: '/older.mp4' }),
        createRow({ slug: 'newer', status: 'completed', source_path: '/newer.mp4', completed_at: '2025-06-01T11:00:00.000Z' }),
      ])

      expect(await getFullState()).toEqual({
        videos: {
          older: { status: 'pending', sourcePath: '/older.mp4' },
          newer: {
            status: 'completed',
            sourcePath: '/newer.mp4',
            completedAt: '2025-06-01T11:00:00.000Z',
          },
        },
      })
    })
  })
})

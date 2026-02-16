import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks (Vitest ESM requirement) ─────────────────────────────

const { mockReadJsonFile, mockWriteJsonFile, mockFileExistsSync } = vi.hoisted(() => ({
  mockReadJsonFile: vi.fn() as ReturnType<typeof vi.fn>,
  mockWriteJsonFile: vi.fn() as ReturnType<typeof vi.fn>,
  mockFileExistsSync: vi.fn() as ReturnType<typeof vi.fn>,
}))

// ── Module mocks ───────────────────────────────────────────────────────

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../config/environment.js', () => ({
  getConfig: vi.fn(() => ({ OUTPUT_DIR: '/test-output' })),
}))

vi.mock('../core/fileSystem.js', () => ({
  readJsonFile: mockReadJsonFile,
  writeJsonFile: mockWriteJsonFile,
  fileExistsSync: mockFileExistsSync,
}))

vi.mock('../core/paths.js', () => ({
  join: (...segments: string[]) => segments.join('/'),
}))

// ── Import after mocks ─────────────────────────────────────────────────

import {
  markPending,
  markProcessing,
  markCompleted,
  markFailed,
  getVideoStatus,
  getUnprocessed,
  isCompleted,
  getVideosByStatus,
} from '../services/processingState.js'

import logger from '../config/logger.js'

// ── Helpers ────────────────────────────────────────────────────────────

const STATE_PATH = '/test-output/processing-state.json'

function emptyState() {
  return { videos: {} }
}

function stateWith(videos: Record<string, unknown>) {
  return { videos }
}

function setupReadState(state: ReturnType<typeof emptyState>) {
  mockFileExistsSync.mockReturnValue(true)
  mockReadJsonFile.mockResolvedValue(state)
  mockWriteJsonFile.mockResolvedValue(undefined)
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('processingState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── markPending ────────────────────────────────────────────────────

  describe('markPending', () => {
    it('creates a new entry with status pending', async () => {
      setupReadState(emptyState())

      await markPending('my-video', '/source/my-video.mp4')

      expect(mockWriteJsonFile).toHaveBeenCalledWith(STATE_PATH, {
        videos: {
          'my-video': {
            status: 'pending',
            sourcePath: '/source/my-video.mp4',
          },
        },
      })
    })

    it('preserves existing entries when adding a new one', async () => {
      setupReadState(stateWith({
        'existing-video': { status: 'completed', sourcePath: '/old.mp4' },
      }))

      await markPending('new-video', '/source/new-video.mp4')

      const written = mockWriteJsonFile.mock.calls[0][1]
      expect(written.videos['existing-video']).toBeDefined()
      expect(written.videos['new-video'].status).toBe('pending')
    })
  })

  // ── markProcessing ─────────────────────────────────────────────────

  describe('markProcessing', () => {
    it('transitions from pending to processing with startedAt', async () => {
      setupReadState(stateWith({
        'my-video': { status: 'pending', sourcePath: '/source/my-video.mp4' },
      }))

      await markProcessing('my-video')

      expect(mockWriteJsonFile).toHaveBeenCalledWith(STATE_PATH, {
        videos: {
          'my-video': {
            status: 'processing',
            sourcePath: '/source/my-video.mp4',
            startedAt: '2025-06-01T12:00:00.000Z',
          },
        },
      })
    })

    it('warns and returns without writing for unknown slug', async () => {
      setupReadState(emptyState())

      await markProcessing('unknown-slug')

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unknown slug: unknown-slug'),
      )
      expect(mockWriteJsonFile).not.toHaveBeenCalled()
    })
  })

  // ── markCompleted ──────────────────────────────────────────────────

  describe('markCompleted', () => {
    it('transitions to completed with completedAt and clears error', async () => {
      setupReadState(stateWith({
        'my-video': {
          status: 'processing',
          sourcePath: '/source/my-video.mp4',
          startedAt: '2025-06-01T11:00:00.000Z',
          error: 'previous failure',
        },
      }))

      await markCompleted('my-video')

      const written = mockWriteJsonFile.mock.calls[0][1]
      expect(written.videos['my-video']).toEqual({
        status: 'completed',
        sourcePath: '/source/my-video.mp4',
        startedAt: '2025-06-01T11:00:00.000Z',
        completedAt: '2025-06-01T12:00:00.000Z',
        error: undefined,
      })
    })

    it('warns and returns without writing for unknown slug', async () => {
      setupReadState(emptyState())

      await markCompleted('unknown-slug')

      expect(logger.warn).toHaveBeenCalled()
      expect(mockWriteJsonFile).not.toHaveBeenCalled()
    })
  })

  // ── markFailed ─────────────────────────────────────────────────────

  describe('markFailed', () => {
    it('transitions to failed with error message and completedAt', async () => {
      setupReadState(stateWith({
        'my-video': {
          status: 'processing',
          sourcePath: '/source/my-video.mp4',
          startedAt: '2025-06-01T11:00:00.000Z',
        },
      }))

      await markFailed('my-video', 'FFmpeg crashed')

      const written = mockWriteJsonFile.mock.calls[0][1]
      expect(written.videos['my-video']).toEqual({
        status: 'failed',
        sourcePath: '/source/my-video.mp4',
        startedAt: '2025-06-01T11:00:00.000Z',
        completedAt: '2025-06-01T12:00:00.000Z',
        error: 'FFmpeg crashed',
      })
    })

    it('warns and returns without writing for unknown slug', async () => {
      setupReadState(emptyState())

      await markFailed('unknown-slug', 'some error')

      expect(logger.warn).toHaveBeenCalled()
      expect(mockWriteJsonFile).not.toHaveBeenCalled()
    })
  })

  // ── State transitions ──────────────────────────────────────────────

  describe('state transitions', () => {
    it('pending → processing → completed', async () => {
      // Start with pending
      setupReadState(emptyState())
      await markPending('vid', '/source/vid.mp4')

      const pendingState = mockWriteJsonFile.mock.calls[0][1]
      expect(pendingState.videos['vid'].status).toBe('pending')

      // Transition to processing
      setupReadState(pendingState)
      await markProcessing('vid')

      const processingState = mockWriteJsonFile.mock.calls[1][1]
      expect(processingState.videos['vid'].status).toBe('processing')
      expect(processingState.videos['vid'].startedAt).toBeDefined()

      // Transition to completed
      setupReadState(processingState)
      await markCompleted('vid')

      const completedState = mockWriteJsonFile.mock.calls[2][1]
      expect(completedState.videos['vid'].status).toBe('completed')
      expect(completedState.videos['vid'].completedAt).toBeDefined()
    })

    it('pending → processing → failed', async () => {
      setupReadState(emptyState())
      await markPending('vid', '/source/vid.mp4')

      const pendingState = mockWriteJsonFile.mock.calls[0][1]
      setupReadState(pendingState)
      await markProcessing('vid')

      const processingState = mockWriteJsonFile.mock.calls[1][1]
      setupReadState(processingState)
      await markFailed('vid', 'out of memory')

      const failedState = mockWriteJsonFile.mock.calls[2][1]
      expect(failedState.videos['vid'].status).toBe('failed')
      expect(failedState.videos['vid'].error).toBe('out of memory')
    })
  })

  // ── getVideoStatus ─────────────────────────────────────────────────

  describe('getVideoStatus', () => {
    it('returns state for an existing slug', async () => {
      setupReadState(stateWith({
        'my-video': { status: 'completed', sourcePath: '/source/my-video.mp4' },
      }))

      const result = await getVideoStatus('my-video')

      expect(result).toEqual({ status: 'completed', sourcePath: '/source/my-video.mp4' })
    })

    it('returns undefined for a non-existent slug', async () => {
      setupReadState(emptyState())

      const result = await getVideoStatus('no-such-video')

      expect(result).toBeUndefined()
    })
  })

  // ── getUnprocessed ─────────────────────────────────────────────────

  describe('getUnprocessed', () => {
    it('returns only pending and failed videos', async () => {
      setupReadState(stateWith({
        'vid-pending': { status: 'pending', sourcePath: '/a.mp4' },
        'vid-processing': { status: 'processing', sourcePath: '/b.mp4' },
        'vid-completed': { status: 'completed', sourcePath: '/c.mp4' },
        'vid-failed': { status: 'failed', sourcePath: '/d.mp4', error: 'err' },
      }))

      const result = await getUnprocessed()

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['vid-pending']).toBeDefined()
      expect(result['vid-failed']).toBeDefined()
      expect(result['vid-processing']).toBeUndefined()
      expect(result['vid-completed']).toBeUndefined()
    })

    it('returns empty object when no videos exist', async () => {
      setupReadState(emptyState())

      const result = await getUnprocessed()

      expect(result).toEqual({})
    })
  })

  // ── isCompleted ────────────────────────────────────────────────────

  describe('isCompleted', () => {
    it('returns true for a completed video', async () => {
      setupReadState(stateWith({
        'my-video': { status: 'completed', sourcePath: '/a.mp4' },
      }))

      expect(await isCompleted('my-video')).toBe(true)
    })

    it('returns false for a non-completed video', async () => {
      setupReadState(stateWith({
        'my-video': { status: 'processing', sourcePath: '/a.mp4' },
      }))

      expect(await isCompleted('my-video')).toBe(false)
    })

    it('returns false for a non-existent slug', async () => {
      setupReadState(emptyState())

      expect(await isCompleted('no-such-video')).toBe(false)
    })
  })

  // ── getVideosByStatus ──────────────────────────────────────────────

  describe('getVideosByStatus', () => {
    it('returns only videos matching the requested status', async () => {
      setupReadState(stateWith({
        'vid-a': { status: 'pending', sourcePath: '/a.mp4' },
        'vid-b': { status: 'completed', sourcePath: '/b.mp4' },
        'vid-c': { status: 'pending', sourcePath: '/c.mp4' },
      }))

      const result = await getVideosByStatus('pending')

      expect(Object.keys(result)).toHaveLength(2)
      expect(result['vid-a']).toBeDefined()
      expect(result['vid-c']).toBeDefined()
    })

    it('returns empty object when no videos match', async () => {
      setupReadState(stateWith({
        'vid-a': { status: 'completed', sourcePath: '/a.mp4' },
      }))

      const result = await getVideosByStatus('failed')

      expect(result).toEqual({})
    })
  })

  // ── readState with missing file ────────────────────────────────────

  describe('readState when file does not exist', () => {
    it('returns empty state without calling readJsonFile', async () => {
      mockFileExistsSync.mockReturnValue(false)

      const result = await getVideoStatus('anything')

      expect(result).toBeUndefined()
      expect(mockReadJsonFile).not.toHaveBeenCalled()
    })
  })
})

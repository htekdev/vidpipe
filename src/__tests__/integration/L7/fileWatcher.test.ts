import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  eventHandlers,
  mockWatcher,
  mockWatch,
  mockFileExistsSync,
  mockEnsureDirectorySync,
  mockGetFileStatsSync,
  mockListDirectorySync,
} = vi.hoisted(() => {
  const eventHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  const mockWatcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      eventHandlers[event] = handler
      return mockWatcher
    }),
    close: vi.fn(),
  }

  return {
    eventHandlers,
    mockWatcher,
    mockWatch: vi.fn(() => mockWatcher),
    mockFileExistsSync: vi.fn(() => true),
    mockEnsureDirectorySync: vi.fn(),
    mockGetFileStatsSync: vi.fn(() => ({ size: 2 * 1024 * 1024 })),
    mockListDirectorySync: vi.fn(() => [] as string[]),
  }
})

vi.mock('../../../L1-infra/watcher/watcher.js', async () => {
  const { EventEmitter } = await import('node:events')
  return { watch: mockWatch, EventEmitter }
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ WATCH_FOLDER: '/watch' }),
}))

vi.mock('../../../L1-infra/paths/paths.js', async () => {
  const path = await import('node:path')
  return { join: path.posix.join, extname: path.posix.extname }
})

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExistsSync: mockFileExistsSync,
  ensureDirectorySync: mockEnsureDirectorySync,
  getFileStatsSync: mockGetFileStatsSync,
  listDirectorySync: mockListDirectorySync,
}))

import { FileWatcher } from '../../../L7-app/fileWatcher.js'

async function fireWatcherEvent(event: string, ...args: unknown[]): Promise<void> {
  const handler = eventHandlers[event]
  expect(handler).toBeTypeOf('function')
  handler(...args)
  await vi.runAllTimersAsync()
  await Promise.resolve()
}

describe('L7 Integration: FileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key]
    }

    mockWatch.mockReturnValue(mockWatcher)
    mockFileExistsSync.mockReturnValue(true)
    mockGetFileStatsSync.mockReturnValue({ size: 2 * 1024 * 1024 })
    mockListDirectorySync.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is importable and constructable', () => {
    expect(FileWatcher).toBeTypeOf('function')

    const watcher = new FileWatcher()

    expect(watcher).toBeInstanceOf(EventEmitter)
    expect(mockEnsureDirectorySync).not.toHaveBeenCalled()
    expect(mockWatch).not.toHaveBeenCalled()
  })

  it('emits new-video for .webm files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    const webmPath = '/watch/meeting.webm'

    await fireWatcherEvent('add', webmPath)

    expect(emitted).toEqual([webmPath])
  })

  it('emits new-video for .mp4 files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    const mp4Path = '/watch/meeting.mp4'

    await fireWatcherEvent('add', mp4Path)

    expect(emitted).toEqual([mp4Path])
  })
})

import { win32 } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  watchFolder,
  stableFileSize,
  eventHandlers,
  mockWatcher,
  mockWatch,
  mockGetConfig,
  mockFileExistsSync,
  mockEnsureDirectorySync,
  mockGetFileStatsSync,
  mockListDirectorySync,
} = vi.hoisted(() => {
  const watchFolder = 'C:\\watch'
  const stableFileSize = 2 * 1024 * 1024
  const eventHandlers: Record<string, (...args: unknown[]) => unknown> = {}
  const mockWatcher = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      eventHandlers[event] = handler
      return mockWatcher
    }),
    close: vi.fn(),
  }

  return {
    watchFolder,
    stableFileSize,
    eventHandlers,
    mockWatcher,
    mockWatch: vi.fn(() => mockWatcher),
    mockGetConfig: vi.fn(() => ({ WATCH_FOLDER: watchFolder })),
    mockFileExistsSync: vi.fn(() => true),
    mockEnsureDirectorySync: vi.fn(),
    mockGetFileStatsSync: vi.fn(() => ({ size: stableFileSize })),
    mockListDirectorySync: vi.fn((): string[] => []),
  }
})

vi.mock('../../../L1-infra/watcher/watcher.js', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    watch: mockWatch,
    EventEmitter,
  }
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/paths/paths.js', async () => {
  const path = await import('node:path')
  return {
    join: path.win32.join,
    extname: path.win32.extname,
  }
})

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExistsSync: mockFileExistsSync,
  ensureDirectorySync: mockEnsureDirectorySync,
  getFileStatsSync: mockGetFileStatsSync,
  listDirectorySync: mockListDirectorySync,
}))

import logger from '../../../L1-infra/logger/configLogger.js'
import { FileWatcher } from '../../../L7-app/fileWatcher.js'

function getHandler(event: string): (...args: unknown[]) => unknown {
  const handler = eventHandlers[event]
  expect(handler).toBeTypeOf('function')
  return handler
}

async function fireWatcherEvent(event: string, ...args: unknown[]): Promise<void> {
  getHandler(event)(...args)
  await vi.runAllTimersAsync()
  await Promise.resolve()
}

describe('FileWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()

    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key]
    }

    mockWatch.mockReturnValue(mockWatcher)
    mockGetConfig.mockReturnValue({ WATCH_FOLDER: watchFolder })
    mockFileExistsSync.mockReturnValue(true)
    mockGetFileStatsSync.mockReturnValue({ size: stableFileSize })
    mockListDirectorySync.mockReturnValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handleDetectedFile accepts .webm files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    const webmPath = `${watchFolder}\\meeting.webm`

    await fireWatcherEvent('add', webmPath)

    expect(emitted).toEqual([webmPath])
  })

  it('handleDetectedFile accepts .mp4 files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    const mp4Path = `${watchFolder}\\meeting.mp4`

    await fireWatcherEvent('add', mp4Path)

    expect(emitted).toEqual([mp4Path])
  })

  it('handleDetectedFile ignores non-video files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()

    await fireWatcherEvent('add', `${watchFolder}\\notes.txt`)

    expect(emitted).toEqual([])
  })

  it('scanExistingFiles picks up .webm files', async () => {
    mockListDirectorySync.mockReturnValue(['existing.mp4', 'existing.webm', 'notes.txt'])

    const watcher = new FileWatcher({ processExisting: true })
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    await fireWatcherEvent('ready')

    expect(mockListDirectorySync).toHaveBeenCalledWith(watchFolder)
    expect(emitted).toEqual([
      win32.join(watchFolder, 'existing.mp4'),
      win32.join(watchFolder, 'existing.webm'),
    ])
  })

  it('change event accepts .webm files', async () => {
    const watcher = new FileWatcher()
    const emitted: string[] = []
    watcher.on('new-video', (filePath: string) => emitted.push(filePath))

    watcher.start()
    const webmPath = `${watchFolder}\\updated.webm`

    await fireWatcherEvent('change', webmPath)

    expect(emitted).toEqual([webmPath])
  })

  it('start() logs "Watching for new video files"', () => {
    const watcher = new FileWatcher()

    watcher.start()

    const infoCalls = vi.mocked(logger.info).mock.calls
    const watchMessage = infoCalls.at(-1)?.[0]

    expect(watchMessage).toContain('Watching for new video files in:')
    expect(watchMessage).not.toContain('.mp4 files')
  })
})

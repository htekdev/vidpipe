import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

const mockInitConfig = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn().mockReturnValue({
  OUTPUT_DIR: 'C:\\VidPipe\\output',
}))
const mockPushConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ uploaded: 2 }))
const mockPullConfig = vi.hoisted(() => vi.fn().mockResolvedValue({ downloaded: 3 }))
const mockMigrateLocalContent = vi.hoisted(() => vi.fn().mockResolvedValue({ uploaded: 5, errors: [] }))
const mockIsAzureConfigured = vi.hoisted(() => vi.fn().mockReturnValue(true))
const mockGetContentItems = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockListVideos = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockListConfigFiles = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockUploadVideoFile = vi.hoisted(() => vi.fn().mockResolvedValue('https://blob.url'))
const mockGetRunId = vi.hoisted(() => vi.fn().mockReturnValue('test-run-id'))
const mockDownloadBlobToFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockFileStat = vi.hoisted(() => vi.fn().mockResolvedValue({ size: 1024 * 1024 }))
const mockReaddir = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockReadFile = vi.hoisted(() => vi.fn().mockResolvedValue('{}'))
const mockExecFile = vi.hoisted(() => vi.fn())

// ── L1 mocks ────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/cli/cli.js', async () => {
  const { Command } = await import('commander')
  return { Command }
})

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ── L3 mocks ────────────────────────────────────────────────────────────

vi.mock('../../../L3-services/azureStorage/azureConfigService.js', () => ({
  pushConfig: mockPushConfig,
  pullConfig: mockPullConfig,
  listConfigFiles: mockListConfigFiles,
}))

const mockUploadContentItem = vi.hoisted(() => vi.fn().mockResolvedValue('content/item/'))

vi.mock('../../../L3-services/azureStorage/azureStorageService.js', () => ({
  migrateLocalContent: mockMigrateLocalContent,
  isAzureConfigured: mockIsAzureConfigured,
  getContentItems: mockGetContentItems,
  listVideos: mockListVideos,
  uploadVideoFile: mockUploadVideoFile,
  getRunId: mockGetRunId,
  downloadBlobToFile: mockDownloadBlobToFile,
  uploadContentItem: mockUploadContentItem,
}))

vi.mock('node:fs/promises', () => ({
  stat: mockFileStat,
  readdir: mockReaddir,
  readFile: mockReadFile,
}))

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

import { createCloudCommand } from '../../../L7-app/commands/cloud.js'

describe('L7 Unit: Cloud command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Re-establish default mock implementations after clearAllMocks
    mockIsAzureConfigured.mockReturnValue(true)
    mockGetConfig.mockReturnValue({ OUTPUT_DIR: 'C:\\VidPipe\\output' })
    mockReaddir.mockResolvedValue([])
    mockReadFile.mockResolvedValue('{}')
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    process.exitCode = undefined
  })

  afterEach(() => {
    exitSpy.mockRestore()
    consoleSpy.mockRestore()
    process.exitCode = undefined
  })

  describe('push-config', () => {
    test('pushes config files and logs success', async () => {
      const cloud = createCloudCommand()
      await cloud.parseAsync(['push-config'], { from: 'user' })

      expect(mockInitConfig).toHaveBeenCalled()
      expect(mockPushConfig).toHaveBeenCalledWith('C:\\VidPipe')
    })

    test('handles push-config error gracefully', async () => {
      mockPushConfig.mockRejectedValueOnce(new Error('Network error'))

      const cloud = createCloudCommand()
      await cloud.parseAsync(['push-config'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('pull-config', () => {
    test('pulls config files and logs success', async () => {
      const cloud = createCloudCommand()
      await cloud.parseAsync(['pull-config'], { from: 'user' })

      expect(mockInitConfig).toHaveBeenCalled()
      expect(mockPullConfig).toHaveBeenCalledWith('C:\\VidPipe')
    })

    test('handles pull-config error gracefully', async () => {
      mockPullConfig.mockRejectedValueOnce(new Error('Network error'))

      const cloud = createCloudCommand()
      await cloud.parseAsync(['pull-config'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('migrate', () => {
    test('migrates local content to Azure', async () => {
      const cloud = createCloudCommand()
      await cloud.parseAsync(['migrate'], { from: 'user' })

      expect(mockInitConfig).toHaveBeenCalled()
      expect(mockMigrateLocalContent).toHaveBeenCalledWith('C:\\VidPipe\\output')
    })

    test('logs warnings when migration has errors', async () => {
      mockMigrateLocalContent.mockResolvedValueOnce({
        uploaded: 3,
        errors: ['item-1: failed', 'item-2: failed'],
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['migrate'], { from: 'user' })

      expect(mockMigrateLocalContent).toHaveBeenCalled()
    })

    test('handles migrate error gracefully', async () => {
      mockMigrateLocalContent.mockRejectedValueOnce(new Error('Azure offline'))

      const cloud = createCloudCommand()
      await cloud.parseAsync(['migrate'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('status', () => {
    test('shows status when Azure is configured', async () => {
      mockIsAzureConfigured.mockReturnValue(true)
      mockListConfigFiles.mockResolvedValueOnce(['schedule.json', 'brand.json'])
      mockGetContentItems.mockResolvedValueOnce([{ rowKey: 'item-1' }])
      mockListVideos.mockResolvedValueOnce([{ rowKey: 'vid-1' }])

      const cloud = createCloudCommand()
      await cloud.parseAsync(['status'], { from: 'user' })

      expect(mockInitConfig).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Configured'))
    })

    test('shows not configured message when Azure is not configured', async () => {
      mockIsAzureConfigured.mockReturnValue(false)

      const cloud = createCloudCommand()
      await cloud.parseAsync(['status'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Not configured'))
    })

    test('handles status error gracefully', async () => {
      mockIsAzureConfigured.mockImplementation(() => { throw new Error('Config error') })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['status'], { from: 'user' })

      expect(process.exitCode).toBe(1)
      mockIsAzureConfigured.mockReturnValue(true) // restore
    })
  })

  describe('process', () => {
    test('uploads video and triggers workflow', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, 'Workflow triggered', '')
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['process', 'C:\\videos\\test.mp4'], { from: 'user' })

      expect(mockUploadVideoFile).toHaveBeenCalled()
      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['workflow', 'run', 'process-video.yml']),
        expect.any(Function),
      )
    })

    test('exits when Azure not configured', async () => {
      mockIsAzureConfigured.mockReturnValueOnce(false)

      const cloud = createCloudCommand()
      await cloud.parseAsync(['process', 'C:\\videos\\test.mp4'], { from: 'user' })

      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(mockUploadVideoFile).not.toHaveBeenCalled()
    })

    test('handles process error gracefully', async () => {
      mockUploadVideoFile.mockRejectedValueOnce(new Error('Upload failed'))

      const cloud = createCloudCommand()
      await cloud.parseAsync(['process', 'C:\\videos\\test.mp4'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })

    test('passes spec and ideas options to workflow', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync([
        'process', 'C:\\videos\\test.mp4',
        '--spec', 'quick',
        '--ideas', 'idea-1,idea-2',
        '--publish-by', '2026-03-01',
      ], { from: 'user' })

      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          '-f', 'spec=quick',
          '-f', 'ideas=idea-1,idea-2',
          '-f', 'publish_by=2026-03-01',
        ]),
        expect.any(Function),
      )
    })

    test('handles gh CLI failure', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('gh not found'), '', 'command not found')
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['process', 'C:\\videos\\test.mp4'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('download', () => {
    test('downloads blob:// URL via Azure', async () => {
      const cloud = createCloudCommand()
      await cloud.parseAsync(['download', 'blob://raw/test.mp4', 'C:\\output\\test.mp4'], { from: 'user' })

      expect(mockDownloadBlobToFile).toHaveBeenCalledWith('raw/test.mp4', 'C:\\output\\test.mp4')
    })

    test('downloads HTTP URL via curl', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, '', '')
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['download', 'https://example.com/video.mp4', 'C:\\output\\video.mp4'], { from: 'user' })

      expect(mockExecFile).toHaveBeenCalledWith(
        'curl',
        expect.arrayContaining(['-L', '--fail', '-o', 'C:\\output\\video.mp4', 'https://example.com/video.mp4']),
        expect.any(Function),
      )
    })

    test('handles download error gracefully', async () => {
      mockDownloadBlobToFile.mockRejectedValueOnce(new Error('Blob not found'))

      const cloud = createCloudCommand()
      await cloud.parseAsync(['download', 'blob://raw/missing.mp4', 'C:\\output\\out.mp4'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })

    test('handles curl download error', async () => {
      mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('curl failed'), '', 'Connection refused')
      })

      const cloud = createCloudCommand()
      await cloud.parseAsync(['download', 'https://example.com/video.mp4', 'C:\\output\\out.mp4'], { from: 'user' })

      expect(process.exitCode).toBe(1)
    })
  })

  describe('upload', () => {
    test('exits with error when Azure not configured', async () => {
      mockIsAzureConfigured.mockReturnValueOnce(false)
      mockReaddir.mockResolvedValueOnce(['video.mp4'])

      const cloud = createCloudCommand()
      await cloud.parseAsync(['upload', 'C:\\VidPipe\\recordings\\my-video'], { from: 'user' })

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    test('exits with error when no mp4 found', async () => {
      mockReaddir.mockResolvedValueOnce(['README.md', 'notes.txt'])

      const cloud = createCloudCommand()
      await cloud.parseAsync(['upload', 'C:\\VidPipe\\recordings\\no-video'], { from: 'user' })

      expect(exitSpy).toHaveBeenCalledWith(1)
    })
  })
})

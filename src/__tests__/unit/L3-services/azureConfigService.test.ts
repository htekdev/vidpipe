import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockUploadFile = vi.hoisted(() => vi.fn().mockResolvedValue('https://blob.url'))
const mockListBlobs = vi.hoisted(() => vi.fn().mockResolvedValue([]))
const mockDownloadToFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockStat = vi.hoisted(() => vi.fn())
const mockReaddir = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('node:fs/promises', () => ({
  readdir: mockReaddir,
  stat: mockStat,
  mkdir: mockMkdir,
}))

vi.mock('../../../L2-clients/azure/blobClient.js', () => ({
  uploadFile: mockUploadFile,
  listBlobs: mockListBlobs,
  downloadToFile: mockDownloadToFile,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { pushConfig, pullConfig, listConfigFiles } from '../../../L3-services/azureStorage/azureConfigService.js'

describe('L3 Unit: Azure Config Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('pushConfig', () => {
    test('uploads existing config files', async () => {
      // stat succeeds for schedule.json and brand.json
      mockStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true })
      // stat fails for assets/ dir (not found)
      mockStat
        .mockResolvedValueOnce({}) // schedule.json exists
        .mockResolvedValueOnce({}) // brand.json exists
        .mockRejectedValueOnce(new Error('ENOENT')) // assets/ missing

      const result = await pushConfig('C:\\VidPipe')

      expect(result.uploaded).toBe(2)
      expect(mockUploadFile).toHaveBeenCalledWith('config/schedule.json', expect.stringContaining('schedule.json'))
      expect(mockUploadFile).toHaveBeenCalledWith('config/brand.json', expect.stringContaining('brand.json'))
    })

    test('skips missing config files', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'))

      const result = await pushConfig('C:\\VidPipe')

      expect(result.uploaded).toBe(0)
      expect(mockUploadFile).not.toHaveBeenCalled()
    })

    test('uploads assets directory recursively', async () => {
      // schedule.json and brand.json missing
      mockStat
        .mockRejectedValueOnce(new Error('ENOENT')) // schedule.json
        .mockRejectedValueOnce(new Error('ENOENT')) // brand.json
        .mockResolvedValueOnce({}) // assets/ exists

      // readdir for assets/
      mockReaddir.mockResolvedValueOnce(['logo.png', 'fonts'])
      // stat for logo.png
      mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })
      // stat for fonts/
      mockStat.mockResolvedValueOnce({ isDirectory: () => true, isFile: () => false })
      // readdir for fonts/
      mockReaddir.mockResolvedValueOnce(['main.ttf'])
      // stat for main.ttf
      mockStat.mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true })

      const result = await pushConfig('C:\\VidPipe')

      expect(result.uploaded).toBe(2) // logo.png + main.ttf
      expect(mockUploadFile).toHaveBeenCalledWith('config/assets/logo.png', expect.any(String))
      expect(mockUploadFile).toHaveBeenCalledWith('config/assets/fonts/main.ttf', expect.any(String))
    })
  })

  describe('pullConfig', () => {
    test('downloads all config blobs to local directory', async () => {
      mockListBlobs.mockResolvedValueOnce([
        'config/schedule.json',
        'config/brand.json',
        'config/assets/logo.png',
      ])

      const result = await pullConfig('C:\\VidPipe')

      expect(result.downloaded).toBe(3)
      expect(mockMkdir).toHaveBeenCalledTimes(3) // one per file
      expect(mockDownloadToFile).toHaveBeenCalledTimes(3)
      expect(mockDownloadToFile).toHaveBeenCalledWith('config/schedule.json', expect.stringContaining('schedule.json'))
      expect(mockDownloadToFile).toHaveBeenCalledWith('config/brand.json', expect.stringContaining('brand.json'))
    })

    test('returns zero when no blobs found', async () => {
      mockListBlobs.mockResolvedValueOnce([])

      const result = await pullConfig('C:\\VidPipe')

      expect(result.downloaded).toBe(0)
      expect(mockDownloadToFile).not.toHaveBeenCalled()
    })
  })

  describe('listConfigFiles', () => {
    test('returns relative paths with config prefix stripped', async () => {
      mockListBlobs.mockResolvedValueOnce([
        'config/schedule.json',
        'config/brand.json',
        'config/assets/logo.png',
      ])

      const files = await listConfigFiles()

      expect(files).toEqual(['schedule.json', 'brand.json', 'assets/logo.png'])
      expect(mockListBlobs).toHaveBeenCalledWith('config/')
    })

    test('returns empty array when no config files', async () => {
      mockListBlobs.mockResolvedValueOnce([])

      const files = await listConfigFiles()

      expect(files).toEqual([])
    })
  })
})

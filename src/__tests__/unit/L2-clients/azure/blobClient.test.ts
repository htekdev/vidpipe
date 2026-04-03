import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockUpload = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUploadStream = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockDownloadToBuffer = vi.hoisted(() => vi.fn().mockResolvedValue(Buffer.from('test')))
const mockDownloadToFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockExists = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const mockDeleteIfExists = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockDownload = vi.hoisted(() => vi.fn())

vi.mock('@azure/storage-blob', () => {
  class MockStorageSharedKeyCredential {}
  class MockBlobServiceClient {
    getContainerClient() {
      return {
        getBlockBlobClient: () => ({
          upload: mockUpload,
          uploadStream: mockUploadStream,
          downloadToBuffer: mockDownloadToBuffer,
          downloadToFile: mockDownloadToFile,
          exists: mockExists,
          deleteIfExists: mockDeleteIfExists,
          url: 'https://test.blob.core.windows.net/container/blob',
          download: mockDownload,
        }),
        listBlobsFlat: () => ({
          [Symbol.asyncIterator]: async function*() {
            yield { name: 'test/file1.txt' }
            yield { name: 'test/file2.txt' }
          },
        }),
      }
    }
  }
  return {
    StorageSharedKeyCredential: MockStorageSharedKeyCredential,
    BlobServiceClient: MockBlobServiceClient,
  }
})

vi.mock('node:fs', () => ({
  createReadStream: vi.fn().mockReturnValue('mock-stream'),
}))

vi.mock('node:fs/promises', () => ({
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}))

const mockGetConfig = vi.hoisted(() => vi.fn().mockReturnValue({
  AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
  AZURE_STORAGE_ACCOUNT_KEY: 'dGVzdGtleQ==',
  AZURE_CONTAINER_NAME: 'vidpipe',
}))

vi.mock('../../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

import {
  uploadBuffer,
  uploadFile,
  downloadToBuffer,
  downloadToFile,
  downloadStream,
  listBlobs,
  deleteBlob,
  blobExists,
  getBlobUrl,
  isAzureConfigured,
} from '../../../../L2-clients/azure/blobClient.js'

describe('L2 Unit: Azure Blob Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetConfig.mockReturnValue({
      AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
      AZURE_STORAGE_ACCOUNT_KEY: 'dGVzdGtleQ==',
      AZURE_CONTAINER_NAME: 'vidpipe',
    })
    mockDownload.mockResolvedValue({
      readableStreamBody: (async function*() { yield Buffer.from('data') })(),
    })
  })

  test('uploadBuffer uploads data and returns URL', async () => {
    const result = await uploadBuffer('test/path.txt', Buffer.from('hello'), 'text/plain')
    expect(result).toContain('blob.core.windows.net')
    expect(mockUpload).toHaveBeenCalledOnce()
  })

  test('uploadBuffer without contentType passes undefined headers', async () => {
    await uploadBuffer('test/path.txt', Buffer.from('hello'))
    expect(mockUpload).toHaveBeenCalledWith(
      expect.any(Buffer),
      5,
      expect.objectContaining({ blobHTTPHeaders: undefined }),
    )
  })

  test('uploadFile uploads via stream and returns URL', async () => {
    const result = await uploadFile('test/video.mp4', '/local/video.mp4', 'video/mp4')
    expect(result).toContain('blob.core.windows.net')
    expect(mockUploadStream).toHaveBeenCalledWith(
      'mock-stream',
      4 * 1024 * 1024,
      5,
      expect.objectContaining({
        blobHTTPHeaders: { blobContentType: 'video/mp4' },
      }),
    )
  })

  test('uploadFile without contentType passes undefined headers', async () => {
    await uploadFile('test/file.bin', '/local/file.bin')
    expect(mockUploadStream).toHaveBeenCalledWith(
      'mock-stream',
      4 * 1024 * 1024,
      5,
      expect.objectContaining({ blobHTTPHeaders: undefined }),
    )
  })

  test('downloadToBuffer returns buffer from blob', async () => {
    const result = await downloadToBuffer('test/data.bin')
    expect(result).toEqual(Buffer.from('test'))
    expect(mockDownloadToBuffer).toHaveBeenCalledOnce()
  })

  test('downloadToFile downloads blob to local path', async () => {
    await downloadToFile('test/video.mp4', '/local/video.mp4')
    expect(mockDownloadToFile).toHaveBeenCalledWith('/local/video.mp4')
  })

  test('downloadStream returns Readable from blob body', async () => {
    const stream = await downloadStream('test/video.mp4')
    expect(stream).toBeDefined()
    // Consume the stream to verify it works
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).toString()).toBe('data')
  })

  test('downloadStream throws when readableStreamBody is missing', async () => {
    mockDownload.mockResolvedValueOnce({ readableStreamBody: null })
    await expect(downloadStream('test/missing.mp4')).rejects.toThrow(
      'Failed to get readable stream for blob: test/missing.mp4',
    )
  })

  test('listBlobs returns blob names with prefix', async () => {
    const blobs = await listBlobs('test/')
    expect(blobs).toEqual(['test/file1.txt', 'test/file2.txt'])
  })

  test('blobExists returns true when blob exists', async () => {
    const exists = await blobExists('test/path.txt')
    expect(exists).toBe(true)
  })

  test('deleteBlob calls deleteIfExists', async () => {
    await deleteBlob('test/path.txt')
    expect(mockDeleteIfExists).toHaveBeenCalledOnce()
  })

  test('getBlobUrl returns blob URL', () => {
    const url = getBlobUrl('test/path.txt')
    expect(url).toContain('blob.core.windows.net')
  })

  test('isAzureConfigured returns true when credentials set', () => {
    expect(isAzureConfigured()).toBe(true)
  })

  test('isAzureConfigured returns false when account name missing', () => {
    mockGetConfig.mockReturnValueOnce({
      AZURE_STORAGE_ACCOUNT_NAME: '',
      AZURE_STORAGE_ACCOUNT_KEY: 'dGVzdGtleQ==',
    })
    expect(isAzureConfigured()).toBe(false)
  })

  test('isAzureConfigured returns false when account key missing', () => {
    mockGetConfig.mockReturnValueOnce({
      AZURE_STORAGE_ACCOUNT_NAME: 'testaccount',
      AZURE_STORAGE_ACCOUNT_KEY: '',
    })
    expect(isAzureConfigured()).toBe(false)
  })

  test('getClient throws when credentials are not configured', () => {
    mockGetConfig.mockReturnValueOnce({
      AZURE_STORAGE_ACCOUNT_NAME: '',
      AZURE_STORAGE_ACCOUNT_KEY: '',
      AZURE_CONTAINER_NAME: 'vidpipe',
    })
    expect(() => getBlobUrl('test/path.txt')).toThrow('Azure Storage credentials not configured')
  })
})

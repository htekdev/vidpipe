import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { initConfig } from '../../../L1-infra/config/environment.js'

const mocks = vi.hoisted(() => ({
  getItem: vi.fn(), createItem: vi.fn(), updateItem: vi.fn(), incrementCounter: vi.fn(), queryAll: vi.fn(), scanAll: vi.fn(),
  uploadFile: vi.fn(), deleteObject: vi.fn(), uploadBuffer: vi.fn(), downloadToFile: vi.fn(), getMediaStream: vi.fn(), downloadToBuffer: vi.fn(), downloadStream: vi.fn(),
}))
const azureMocks = vi.hoisted(() => ({
  getEntity: vi.fn(), queryEntities: vi.fn(), createEntity: vi.fn(), updateEntity: vi.fn(),
  uploadFile: vi.fn(), uploadBuffer: vi.fn(), deleteBlob: vi.fn(), downloadStream: vi.fn(), downloadToBuffer: vi.fn(), downloadToFile: vi.fn(), isAzureConfigured: vi.fn(),
}))
vi.mock('../../../L2-clients/azure/tableClient.js', () => ({
  getEntity: azureMocks.getEntity, queryEntities: azureMocks.queryEntities, createEntity: azureMocks.createEntity,
  updateEntity: azureMocks.updateEntity, upsertEntity: azureMocks.createEntity,
}))
vi.mock('../../../L2-clients/azure/blobClient.js', () => ({
  uploadFile: azureMocks.uploadFile, uploadBuffer: azureMocks.uploadBuffer, deleteBlob: azureMocks.deleteBlob,
  downloadStream: azureMocks.downloadStream, downloadToBuffer: azureMocks.downloadToBuffer, downloadToFile: azureMocks.downloadToFile, isAzureConfigured: azureMocks.isAzureConfigured,
}))
vi.mock('../../../L2-clients/aws/dynamoClient.js', () => ({
  getItem: mocks.getItem, createItem: mocks.createItem, updateItem: mocks.updateItem,
  incrementCounter: mocks.incrementCounter,
  queryAll: mocks.queryAll, scanAll: mocks.scanAll,
  validateMetadata: (value: unknown) => { if (JSON.stringify(value).length > 390 * 1024) throw new Error('metadata too large') },
}))
vi.mock('../../../L2-clients/aws/s3Client.js', () => ({
  uploadFile: mocks.uploadFile, deleteObject: mocks.deleteObject, uploadBuffer: mocks.uploadBuffer,
  downloadToFile: mocks.downloadToFile, getMediaStream: mocks.getMediaStream, downloadToBuffer: mocks.downloadToBuffer, downloadStream: mocks.downloadStream,
}))
import * as storage from '../../../L3-services/storage/storageService.js'
import * as review from '../../../L3-services/storage/reviewDataSource.js'
import * as aws from '../../../L3-services/awsStorage/awsStorageService.js'
import * as legacyAzureReview from '../../../L3-services/azureStorage/azureReviewDataSource.js'

const root = resolve('.test-aws-storage')
async function fixture(folder: string, metadata: Record<string, unknown> = {}, media = 'media.png'): Promise<string> {
  const path = join(root, folder)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, 'metadata.json'), JSON.stringify({ platform: 'linkedin', mediaType: media ? 'image' : 'text', createdAt: '2025-01-01', ...metadata }))
  await writeFile(join(path, 'post.md'), 'original')
  if (media) await writeFile(join(path, media), 'asset')
  return path
}
const record = {
  itemId: 'item', videoSlug: 'video', partitionKey: 'video', rowKey: 'item',
  status: 'pending_review', createdAt: '2025-01-01', platform: 'linkedin', clipType: 'short',
  blobBasePath: 'content/video/item/attempt/', mediaFilename: 'media.png', thumbnailFilename: '',
  postContent: 'original', hashtags: '', ideaIds: '',
}
beforeEach(() => {
  vi.resetAllMocks()
  Object.assign(process.env, { STORAGE_PROVIDER: 'aws', AWS_REGION: 'us-east-1', AWS_S3_BUCKET: 'bucket', AWS_S3_PREFIX: '', AWS_DYNAMODB_CONTENT_TABLE: 'content', AWS_DYNAMODB_VIDEOS_TABLE: 'videos' })
  initConfig()
  mocks.getItem.mockResolvedValue(null)
  mocks.createItem.mockResolvedValue(true)
  mocks.uploadFile.mockResolvedValue('s3://bucket/file')
  mocks.deleteObject.mockResolvedValue(undefined)
  azureMocks.getEntity.mockResolvedValue(null)
  azureMocks.createEntity.mockResolvedValue(undefined)
  azureMocks.uploadFile.mockResolvedValue('https://azure/file')
  azureMocks.deleteBlob.mockResolvedValue(undefined)
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

test('storageService.REQ-001: AWS selection needs no Azure settings', () => {
  expect(storage.getStorageProviderName()).toBe('aws')
  expect(storage.isStorageConfigured()).toBe(true)
})
test('storageService.REQ-002: publishes metadata after all assets and preserves source metadata and text-only support', async () => {
  const path = await fixture('text', { custom: 'preserved', latePostId: 'late-id' }, '')
  await storage.uploadContentItem(path, 'item', 'video', 'run')
  expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ custom: 'preserved', latePostId: 'late-id', mediaFilename: '', postContent: 'original' })
  expect(mocks.createItem.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...mocks.uploadFile.mock.invocationCallOrder))
  expect(await readFile(join(path, 'metadata.json'), 'utf8')).toContain('preserved')
})
test('storageService.REQ-003: races isolate attempt prefixes and clean only losing assets', async () => {
  const path = await fixture('item')
  mocks.createItem.mockResolvedValue(false)
  mocks.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...record, blobBasePath: 'winner/' })
  await storage.uploadContentItem(path, 'item', 'video', 'run')
  const keys = mocks.uploadFile.mock.calls.map(call => call[0] as string)
  expect(keys.every(key => key.startsWith('content/video/item/'))).toBe(true)
  expect(mocks.deleteObject.mock.calls.map(call => call[0]).sort()).toEqual([...keys].sort())
  mocks.createItem.mockResolvedValue(true)
  await storage.uploadContentItem(path, 'item', 'video', 'run')
  expect(mocks.uploadFile.mock.calls[keys.length][0]).not.toBe(keys[0])
})

test('storageService.REQ-003: SDK retry conditional conflicts retain the same attempt already committed', async () => {
  const path = await fixture('retry')
  mocks.createItem.mockResolvedValue(false)
  mocks.getItem.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
    ...record, blobBasePath: (mocks.uploadFile.mock.calls[0][0] as string).replace(/[^/]+$/, ''),
  }))
  const base = await storage.uploadContentItem(path, 'item', 'video', 'run')
  expect(base).toBe((mocks.uploadFile.mock.calls[0][0] as string).replace(/[^/]+$/, ''))
  expect(mocks.deleteObject).not.toHaveBeenCalled()
})
test('storageService.REQ-004: newest duplicate lookup is deterministic and stale index statuses are removed', async () => {
  mocks.queryAll.mockResolvedValue([{ ...record, videoSlug: 'a' }, { ...record, videoSlug: 'z' }])
  expect(await storage.findContentItemByRowKey('item')).toMatchObject({ partitionKey: 'z' })
  expect(mocks.queryAll.mock.lastCall?.[0]).not.toHaveProperty('IndexName')
  mocks.getItem.mockResolvedValue({ ...record, status: 'published' })
  expect(await storage.getContentItems({ status: 'pending_review' })).toEqual([])
})
test('storageService.REQ-005: published first, duplicate skipping, no-write dry run and per-item failures', async () => {
  await fixture('published/same', { id: 'same', sourceVideo: 'C:\\recordings\\video', latePostId: 'published-id' })
  await fixture('publish-queue/same', { id: 'same', sourceVideo: '/recordings/video' })
  await fixture('publish-queue/bad', { sourceVideo: 'video', mediaType: 'video' }, '')
  const dry = await storage.migrateLocalContent(root, { dryRun: true })
  expect(dry).toMatchObject({ uploaded: 0, skipped: 1, eligible: 1, invalid: 1, failed: 0 })
  expect(dry.errors).toHaveLength(1)
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  const result = await storage.migrateLocalContent(root)
  expect(result).toMatchObject({ uploaded: 1, skipped: 1 })
  expect(mocks.createItem.mock.calls[0][1]).toMatchObject({ itemId: 'same', videoSlug: 'video', status: 'published', latePostId: 'published-id' })
})
test('storageService.REQ-006: explicit source slug wins and missing media fails before upload', async () => {
  await fixture('published/item', { videoSlug: 'explicit', sourceVideo: 'C:\\recordings\\other.mp4' })
  await storage.migrateLocalContent(root)
  expect(mocks.createItem.mock.calls[0][1]).toMatchObject({ videoSlug: 'explicit' })
  const bad = await fixture('invalid', { mediaType: 'video' }, '')
  await expect(storage.uploadContentItem(bad, 'bad', 'video', 'run')).rejects.toThrow(/media/i)
})
test('storageService.REQ-007: validates bucket, prefix, encoding and traversal before downloads', async () => {
  process.env.AWS_S3_PREFIX = 'tenant'
  initConfig()
  await storage.downloadStorageUrlToFile('s3://bucket/tenant/content/my%20file.mp4', 'download.mp4')
  expect(mocks.downloadToFile).toHaveBeenCalledWith('content/my file.mp4', 'download.mp4')
  for (const url of [
    's3://other/tenant/file', 's3://user@bucket/tenant/file', 's3://bucket/tenant-evil/file',
    's3://bucket/tenant/../file', 's3://bucket/tenant/%2e%2e/file',
    's3://bucket/tenant/file?x=y', 's3://bucket/tenant/file#hash', 's3://bucket/tenant/%zz',
    'blob://tenant/file',
  ]) await expect(storage.downloadStorageUrlToFile(url, 'download.mp4')).rejects.toThrow()
  expect(mocks.downloadToFile).toHaveBeenCalledTimes(1)
})
test('reviewDataSource.REQ-001: shared review mutations use selected backend', async () => {
  mocks.getItem.mockResolvedValue(record)
  await review.approveItem('video', 'item')
  await review.rejectItem('video', 'item')
  await review.markPublished('video', 'item', { latePostId: 'late', scheduledFor: 'tomorrow' })
  expect(mocks.updateItem.mock.calls.map(call => call[2].status)).toEqual(['approved', 'rejected', 'published'])
})
test('reviewDataSource.REQ-002: only recorded filenames resolve the owned attempt prefix and ranges', async () => {
  mocks.queryAll.mockResolvedValue([record])
  mocks.getMediaStream.mockResolvedValue({ stream: 'body', contentType: 'image/png', statusCode: 206 })
  await review.getMediaStream('item', 'media.png', 'bytes=0-9')
  expect(mocks.getMediaStream).toHaveBeenCalledWith(`${record.blobBasePath}media.png`, 'bytes=0-9')
  await expect(review.getMediaStream('item', '../metadata.json')).rejects.toThrow(/filename/i)
})
test('reviewDataSource.REQ-003: edit writes recorded post path; listing failures propagate', async () => {
  mocks.getItem.mockResolvedValue(record)
  await review.updateItem('video', 'item', { postContent: 'changed' })
  expect(mocks.uploadBuffer).toHaveBeenCalledWith(`${record.blobBasePath}post.md`, expect.any(Buffer), 'text/markdown')
  mocks.queryAll.mockRejectedValue(new Error('access denied'))
  await expect(review.listPendingItems()).rejects.toThrow('access denied')
})

test('storageService.REQ-001: Azure remains default, delegates signatures and supports legacy cloud URLs', async () => {
  process.env.STORAGE_PROVIDER = ''
  initConfig({ storageProvider: 'azure' })
  expect(storage.getStorageProviderName()).toBe('azure')
  azureMocks.isAzureConfigured.mockReturnValue(true)
  expect(storage.isAzureConfigured()).toBe(true)
  await storage.uploadVideoFile('local.mp4', 'raw/key')
  expect(azureMocks.uploadFile).toHaveBeenCalledWith('raw/key', 'local.mp4', 'video/mp4')
  await storage.downloadStorageUrlToFile('blob://raw/key', 'local.mp4')
  expect(azureMocks.downloadToFile).toHaveBeenCalledWith('raw/key', 'local.mp4')
  await expect(storage.downloadStorageUrlToFile('s3://bucket/key', 'local')).rejects.toThrow(/blob:/)
  await expect(storage.downloadStorageUrlToFile('blob://../key', 'local')).rejects.toThrow(/path/)
  await expect(storage.downloadStorageUrlToFile('blob://', 'local')).rejects.toThrow(/path/)
  const body = Readable.from('azure')
  azureMocks.downloadStream.mockResolvedValue(body)
  expect(await storage.getStorageMediaStream('key', 'bytes=0-1')).toEqual({ stream: body })
  await storage.uploadStorageBuffer('post.md', Buffer.from('edit'), 'text/markdown')
  expect(azureMocks.uploadBuffer).toHaveBeenCalled()
  await storage.getContentItems({ status: 'pending_review' })
  await storage.listVideos('completed')
  await storage.getVideoRecord('run')
  await storage.updateContentStatus('video', 'item', 'approved')
  await storage.uploadPublishQueue(join(root, 'not-present'), 'video', 'run')
})

test('storageService.REQ-002: skips an existing AWS record before file access and validates metadata before upload', async () => {
  mocks.getItem.mockResolvedValue({ ...record })
  expect(await storage.uploadContentItem('not-present', 'item', 'video', 'run')).toBe(record.blobBasePath)
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  mocks.getItem.mockResolvedValue(null)
  const path = await fixture('large', { note: 'a'.repeat(400 * 1024) })
  await expect(storage.uploadContentItem(path, 'item', 'video', 'run')).rejects.toThrow(/metadata/)
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  await writeFile(join(path, 'metadata.json'), 'malformed')
  await expect(storage.uploadContentItem(path, 'item', 'video', 'run')).rejects.toThrow()
})

test('storageService.REQ-003: partial asset failure creates no visible metadata and cleans owned attempt keys', async () => {
  const path = await fixture('partial')
  mocks.uploadFile.mockRejectedValueOnce(new Error('S3 access denied'))
  await expect(storage.uploadContentItem(path, 'item', 'video', 'run')).rejects.toThrow('S3 access denied')
  expect(mocks.createItem).not.toHaveBeenCalled()
  expect(mocks.deleteObject).toHaveBeenCalledWith(mocks.uploadFile.mock.calls[0][0])
  mocks.uploadFile.mockResolvedValue('ok')
  mocks.createItem.mockRejectedValueOnce(new Error('DynamoDB unavailable'))
  await expect(storage.uploadContentItem(path, 'item', 'video', 'run')).rejects.toThrow('DynamoDB unavailable')
  expect(mocks.deleteObject.mock.calls.length).toBe(4)
})

test('storageService.REQ-003: acknowledged-lost metadata writes retain assets referenced by committed records', async () => {
  const path = await fixture('uncertain')
  mocks.createItem.mockRejectedValueOnce(new Error('response lost'))
  mocks.getItem.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
    ...record, blobBasePath: (mocks.uploadFile.mock.calls[0][0] as string).replace(/[^/]+$/, ''),
  }))
  const base = await storage.uploadContentItem(path, 'item', 'video', 'run')
  expect(base).toBe((mocks.uploadFile.mock.calls[0][0] as string).replace(/[^/]+$/, ''))
  expect(mocks.deleteObject).not.toHaveBeenCalled()
})

test('storageService.REQ-003: unresolvable metadata outcomes retain isolated assets instead of breaking possibly committed content', async () => {
  const path = await fixture('unknown')
  mocks.createItem.mockRejectedValueOnce(new Error('timeout'))
  mocks.getItem.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('read timeout'))
  await expect(storage.uploadContentItem(path, 'item', 'video', 'run')).rejects.toThrow('timeout')
  expect(mocks.deleteObject).not.toHaveBeenCalled()
})

test('storageService.REQ-004: strong exact reads, video-slug GSI and administrative scans preserve compatibility keys', async () => {
  mocks.getItem.mockResolvedValueOnce(record)
  expect(await storage.getContentItem('video', 'item')).toMatchObject({ partitionKey: 'video', rowKey: 'item' })
  expect(mocks.getItem).toHaveBeenCalledWith('content', { itemId: 'item', videoSlug: 'video' })
  mocks.queryAll.mockResolvedValue([record])
  mocks.getItem.mockResolvedValue(record)
  expect(await storage.getContentItems({ videoSlug: 'video' })).toHaveLength(1)
  expect(mocks.queryAll.mock.lastCall?.[0].IndexName).toBe('videoSlug-itemId-index')
  mocks.scanAll.mockResolvedValue([record])
  expect(await storage.getContentItems()).toHaveLength(1)
  mocks.queryAll.mockResolvedValue([])
  expect(await storage.findContentItemByRowKey('missing')).toBeNull()
  mocks.getItem.mockResolvedValue(null)
  await expect(storage.updateContentStatus('video', 'missing', 'approved')).rejects.toThrow(/not found/)
})

test('storageService.REQ-002: raw uploads are idempotent and video APIs keep compatibility shape', async () => {
  const metadata = { originalFilename: 'original.mp4', slug: 'video', size: 12 }
  const path = await storage.uploadRawVideo('local.mp4', 'run', metadata)
  expect(path).toMatch(/^raw\/run\/[^/]+\/original\.mp4$/)
  expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ runId: 'run', status: 'completed', duration: 0 })
  mocks.getItem.mockResolvedValueOnce({ runId: 'run', blobPath: path })
  expect(await storage.uploadRawVideo('missing.mp4', 'run', metadata)).toBe(path)
  expect(mocks.uploadFile).toHaveBeenCalledTimes(1)
  mocks.getItem.mockResolvedValueOnce({ runId: 'run' })
  expect(await storage.getVideoRecord('run')).toMatchObject({ partitionKey: 'video', rowKey: 'run' })
  expect(await storage.getVideoRecord('absent')).toBeNull()
  mocks.scanAll.mockResolvedValue([{ runId: 'run' }])
  expect(await storage.listVideos()).toEqual([expect.objectContaining({ rowKey: 'run' })])
  mocks.queryAll.mockResolvedValue([{ runId: 'run' }, { runId: 'stale' }])
  mocks.getItem.mockResolvedValueOnce({ runId: 'run', status: 'completed' }).mockResolvedValueOnce({ runId: 'stale', status: 'failed' })
  expect(await storage.listVideos('completed')).toEqual([expect.objectContaining({ rowKey: 'run' })])
  await storage.uploadVideoFile('local.mp4', 'custom/key')
  expect(mocks.uploadFile.mock.lastCall).toEqual(['custom/key', 'local.mp4', 'video/mp4'])
  await storage.downloadBlobToFile('key', 'local')
  await storage.downloadContentMedia('key')
  expect(mocks.downloadStream).toHaveBeenCalledWith('key')
  expect(storage.getRunId()).toBeTruthy()
})

test('storageService.REQ-003: raw upload losers remove only their own object and return the winning record', async () => {
  mocks.createItem.mockResolvedValue(false)
  mocks.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce({ blobPath: 'winner/key' })
  expect(await storage.uploadRawVideo('local', 'run', { originalFilename: 'a.mp4', slug: 'v', size: 1 })).toBe('winner/key')
  expect(mocks.deleteObject).toHaveBeenCalledWith(mocks.uploadFile.mock.calls[0][0])
  mocks.uploadFile.mockRejectedValueOnce(new Error('failed upload'))
  await expect(storage.uploadRawVideo('local', 'other', { originalFilename: 'b.mp4', slug: 'v', size: 1 })).rejects.toThrow('failed upload')
})

test('storageService.REQ-003: raw uploads reconcile uncertain commits before deleting source assets', async () => {
  mocks.createItem.mockRejectedValueOnce(new Error('response lost'))
  mocks.getItem.mockResolvedValueOnce(null).mockImplementationOnce(async () => ({ blobPath: mocks.uploadFile.mock.calls[0][0] }))
  expect(await storage.uploadRawVideo('local', 'run', { originalFilename: 'a.mp4', slug: 'v', size: 1 })).toBe(mocks.uploadFile.mock.calls[0][0])
  expect(mocks.deleteObject).not.toHaveBeenCalled()
  mocks.createItem.mockRejectedValueOnce(new Error('write timeout'))
  mocks.getItem.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('read timeout'))
  await expect(storage.uploadRawVideo('local', 'other', { originalFilename: 'b.mp4', slug: 'v', size: 1 })).rejects.toThrow('write timeout')
  expect(mocks.deleteObject).not.toHaveBeenCalled()
})

test('storageService.REQ-005: repeat migration skips cloud identities without resetting published edits', async () => {
  await fixture('published/existing', { id: 'existing', sourceVideo: '/recordings/video', status: 'published' })
  mocks.getItem.mockResolvedValue({ ...record, status: 'rejected', postContent: 'cloud edit' })
  expect(await storage.migrateLocalContent(root)).toMatchObject({ uploaded: 0, skipped: 1, errors: [] })
  expect(mocks.uploadFile).not.toHaveBeenCalled()
  expect(mocks.updateItem).not.toHaveBeenCalled()
})

test('storageService.REQ-005: storage failures are itemized separately from invalid local source data', async () => {
  await fixture('published/valid-linkedin', { sourceVideo: 'video' })
  mocks.getItem.mockRejectedValueOnce(new Error('access denied'))
  expect(await storage.migrateLocalContent(root, { dryRun: true })).toMatchObject({
    uploaded: 0, skipped: 0, eligible: 0, invalid: 0, failed: 1,
    errors: [expect.stringContaining('access denied')],
  })
})

test('storageService.REQ-005: Azure migration uses conditional create, isolated paths and published-first skips', async () => {
  initConfig({ storageProvider: 'azure' })
  await fixture('published/same', { id: 'same', sourceVideo: 'video' })
  await fixture('publish-queue/same', { id: 'same', sourceVideo: 'video' })
  expect(await storage.migrateLocalContent(root)).toMatchObject({ uploaded: 1, skipped: 1, errors: [] })
  expect(azureMocks.createEntity.mock.lastCall?.[3]).toMatchObject({ status: 'published' })
  expect(azureMocks.uploadFile.mock.calls[0][0]).toMatch(/^content\/video\/same\/[^/]+\//)
  azureMocks.createEntity.mockRejectedValueOnce({ statusCode: 409 })
  expect(await storage.migrateLocalContent(root)).toMatchObject({ uploaded: 0, skipped: 2, errors: [] })
  expect(azureMocks.deleteBlob).toHaveBeenCalledTimes(3)
})

test('storageService.REQ-003: Azure migration also retains files after a committed metadata response is lost', async () => {
  initConfig({ storageProvider: 'azure' })
  await fixture('published/item', { sourceVideo: 'video' })
  azureMocks.getEntity.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockImplementationOnce(async () => ({
    ...record, blobBasePath: (azureMocks.uploadFile.mock.calls[0][0] as string).replace(/[^/]+$/, ''),
  }))
  azureMocks.createEntity.mockRejectedValueOnce(new Error('response lost'))
  expect(await storage.migrateLocalContent(root)).toMatchObject({ uploaded: 1, failed: 0 })
  expect(azureMocks.deleteBlob).not.toHaveBeenCalled()
})

test('storageService.REQ-006: legacy suffix source fallback and invalid sources/media produce itemized errors', async () => {
  await fixture('publish-queue/legacy-youtube-shorts', {})
  await fixture('publish-queue/ambiguous', {})
  const bad = await fixture('publish-queue/bad-linkedin', { mediaFilename: '../escape.mp4' })
  await fixture('publish-queue/array-linkedin')
  await writeFile(join(root, 'publish-queue', 'array-linkedin', 'metadata.json'), '[]')
  const result = await storage.migrateLocalContent(root)
  expect(result).toMatchObject({ uploaded: 1 })
  expect(result.errors).toHaveLength(3)
  expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ videoSlug: 'legacy' })
  await writeFile(join(bad, 'metadata.json'), JSON.stringify({ status: 'invalid' }))
  await expect(storage.uploadContentItem(bad, 'bad', 'video', 'run')).rejects.toThrow(/status/)
})

test('storageService.REQ-002: AWS publish queue filters source video and reports partial failures', async () => {
  await fixture('queue/good-linkedin', { sourceVideo: 'C:\\recordings\\video' })
  await fixture('queue/other-linkedin', { sourceVideo: '/recordings/other' })
  await fixture('queue/bad-linkedin', { sourceVideo: 'video', mediaType: 'video' }, '')
  expect(await storage.uploadPublishQueue(join(root, 'queue'), 'video', 'run')).toMatchObject({ uploaded: 1, errors: [expect.stringContaining('bad-linkedin')] })
  expect(await storage.uploadPublishQueue(join(root, 'missing'), 'video', 'run')).toMatchObject({ uploaded: 0, errors: [expect.any(String)] })
})

test('reviewDataSource.REQ-001: grouping maps AWS fields and newest duplicate ties consistently', async () => {
  mocks.queryAll.mockResolvedValue([record, { ...record, videoSlug: 'z' }, { ...record, itemId: 'text-x', mediaFilename: '', mediaType: 'text' }])
  mocks.getItem.mockImplementation(async (_table, key) => key.itemId === 'text-x' ? { ...record, ...key, mediaFilename: '', mediaType: 'text' } : { ...record, ...key })
  const groups = await review.getGroupedItems()
  expect(groups).toHaveLength(2)
  expect(groups[0].items[0]).toMatchObject({ id: 'item', videoSlug: 'z', blobBasePath: record.blobBasePath })
  expect((await review.getItemById('video', 'item'))?.mediaUrl).toContain('media.png')
  mocks.getItem.mockResolvedValue(null)
  expect(await review.getItemById('video', 'missing')).toBeNull()
  expect(await review.updateItem('video', 'missing', { postContent: 'edit' })).toBeNull()
})

test('reviewDataSource.REQ-002: downloads recorded media, refuses missing identities and retrieves authoritative post edits', async () => {
  mocks.queryAll.mockResolvedValue([record])
  await review.downloadMediaToFile('item', 'media.png', 'local.png')
  expect(mocks.downloadToFile).toHaveBeenCalledWith(`${record.blobBasePath}media.png`, 'local.png')
  expect(await review.getPostContent('item')).toBe('original')
  mocks.queryAll.mockResolvedValue([])
  expect(await review.getPostContent('missing')).toBe('')
  await expect(review.getMediaStream('missing', 'media.png')).rejects.toMatchObject({ statusCode: 404 })
})

test('storageService.REQ-001: missing AWS resources fail explicitly before client access', async () => {
  process.env.AWS_DYNAMODB_CONTENT_TABLE = ''
  initConfig()
  expect(aws.isStorageConfigured()).toBe(false)
  await expect(storage.getContentItems()).rejects.toThrow(/AWS_DYNAMODB_CONTENT_TABLE/)
  expect(mocks.scanAll).not.toHaveBeenCalled()
})

test('storageService.REQ-002: legacy intentional text-only records do not require a missing video asset', async () => {
  const path = await fixture('legacy-text', { mediaType: 'video', sourceMediaPath: null, textOnly: true }, '')
  await storage.uploadContentItem(path, 'text', 'video', 'run')
  expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ mediaFilename: '', mediaType: 'text', textOnly: true })
  const fallback = await fixture('cover-failed', { mediaType: 'video', sourceMediaPath: null }, '')
  await storage.uploadContentItem(fallback, 'fallback', 'video', 'run')
  expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ mediaType: 'text' })
})

test('storageService.REQ-005: dry-run validates DynamoDB metadata size without uploading assets', async () => {
  await fixture('publish-queue/large-linkedin', { sourceVideo: 'video', note: 'x'.repeat(400 * 1024) })
  expect(await storage.migrateLocalContent(root, { dryRun: true })).toMatchObject({ uploaded: 0, eligible: 0, errors: [expect.stringContaining('metadata')] })
  expect(mocks.uploadFile).not.toHaveBeenCalled()
})

test('storageService.REQ-008: content counts increment new uploads without recounting skipped identities', async () => {
  await fixture('queue/item', { sourceVideo: 'video' })
  mocks.getItem.mockImplementation(async (table) => table === 'videos' ? { runId: 'run', contentCount: 0 } : null)
  expect(await storage.uploadPublishQueue(join(root, 'queue'), 'video', 'run')).toMatchObject({ uploaded: 1 })
  expect(mocks.incrementCounter).toHaveBeenCalledWith('videos', { runId: 'run' }, 'contentCount', 1)
  mocks.getItem.mockResolvedValue(record)
  expect(await storage.uploadPublishQueue(join(root, 'queue'), 'video', 'run')).toMatchObject({ uploaded: 0 })
  expect(mocks.incrementCounter).toHaveBeenCalledTimes(1)
})

test.each([{ links: [] }, { links: [{ url: 'https://example.test/docs', title: 'Docs' }] }])('storageService.REQ-009: Azure migration handles ordinary links $links through the installed Azure serializer', async ({ links }) => {
  initConfig({ storageProvider: 'azure' })
  const platformSpecificData = { linkedin: { visibility: 'PUBLIC' } }
  const { serialize } = await import(pathToFileURL(resolve('node_modules', '@azure', 'data-tables', 'dist', 'esm', 'serialization.js')).href)
  azureMocks.createEntity.mockImplementation(async (_table, partitionKey, rowKey, fields) => {
    serialize({ partitionKey, rowKey, ...fields })
  })
  const path = await fixture('published/linked-item', { sourceVideo: 'video', links, platformSpecificData })
  expect(await storage.migrateLocalContent(root)).toMatchObject({ uploaded: 1, errors: [] })
  const fields = azureMocks.createEntity.mock.lastCall?.[3]
  expect(fields.links).toBe(JSON.stringify(links))
  expect(fields.platformSpecificData).toBe(JSON.stringify(platformSpecificData))
  expect(JSON.parse(await readFile(join(path, 'metadata.json'), 'utf8'))).toMatchObject({ links, platformSpecificData })
})

test.each(['azure', 'aws'] as const)('storageService.REQ-010: %s queue source filtering remains independent from the destination slug', async provider => {
  initConfig({ storageProvider: provider })
  await fixture('queue/item', { sourceVideo: 'C:\\recordings\\original', links: [] })
  await fixture('queue/unrelated', { sourceVideo: '/recordings/unrelated' })
  expect(await storage.uploadPublishQueue(join(root, 'queue'), 'renamed', 'run', { sourceVideoSlug: 'original' })).toMatchObject({ uploaded: 1, errors: [] })
  if (provider === 'aws') expect(mocks.createItem.mock.lastCall?.[1]).toMatchObject({ videoSlug: 'renamed', sourceVideo: 'C:\\recordings\\original' })
  else expect(azureMocks.createEntity).toHaveBeenCalledWith('Content', 'renamed', 'item', expect.objectContaining({ sourceVideoRunId: 'run' }))
})

test('reviewDataSource.REQ-004: an older pending card keeps its exact identity when a newer published duplicate exists', async () => {
  const older = { ...record, videoSlug: 'older', partitionKey: 'older', createdAt: '2025-01-01', blobBasePath: 'old/', postContent: 'Pending text' }
  const newer = { ...record, videoSlug: 'newer', partitionKey: 'newer', createdAt: '2026-01-01', status: 'published', blobBasePath: 'new/', postContent: 'Published text' }
  mocks.queryAll.mockImplementation(async input => input.IndexName ? [older] : [newer, older])
  mocks.getItem.mockImplementation(async (_table, key) => key.videoSlug === 'older' ? older : newer)
  const [item] = await review.listPendingItems()
  expect(item.postContent).toBe('Pending text')
  expect(item.mediaUrl).toContain('videoSlug=older')
  mocks.getMediaStream.mockResolvedValue({ stream: Readable.from('old'), contentType: 'image/png' })
  await review.getMediaStream(item.id, 'media.png', undefined, item.videoSlug)
  expect(mocks.getMediaStream).toHaveBeenLastCalledWith('old/media.png', undefined)
  expect(await storage.findContentItemByRowKey(item.id)).toMatchObject({ partitionKey: 'newer' })
  expect(await review.getPostContent(item.id, item.videoSlug)).toBe('Pending text')
  await review.downloadMediaToFile(item.id, 'media.png', 'local.png', item.videoSlug)
  expect(mocks.downloadToFile).toHaveBeenLastCalledWith('old/media.png', 'local.png')
})

test('storageService.REQ-007: percent escape text in a literal S3 key is decoded only once, not treated as filesystem traversal', async () => {
  await storage.downloadStorageUrlToFile('s3://bucket/objects/%252e%252e/My%2520Video%25%23.mp4', 'local.mp4')
  expect(mocks.downloadToFile).toHaveBeenCalledWith('objects/%2e%2e/My%20Video%#.mp4', 'local.mp4')
})

test('storageService.REQ-001: legacy Azure media streams preserve direct blob paths, MIME types and transport failures independently of the selected provider', async () => {
  const body = Readable.from([Buffer.from('image bytes')])
  azureMocks.downloadStream.mockResolvedValueOnce(body)
  const response = await legacyAzureReview.getMediaStream('legacy-item', 'thumbnail.png')
  expect(response.stream).toBe(body)
  expect(response.contentType).toBe('image/png')
  const chunks: Buffer[] = []
  for await (const chunk of response.stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString()).toBe('image bytes')
  expect(azureMocks.downloadStream).toHaveBeenCalledWith('content/legacy-item/thumbnail.png')

  const denied = Object.assign(new Error('Azure access denied'), { statusCode: 403 })
  azureMocks.downloadStream.mockRejectedValueOnce(denied)
  await expect(legacyAzureReview.getMediaStream('legacy-item', 'media.mp4')).rejects.toBe(denied)
  expect(mocks.getMediaStream).not.toHaveBeenCalled()
  expect(azureMocks.getEntity).not.toHaveBeenCalled()
})

test('storageService.REQ-001: legacy Azure post retrieval decodes UTF-8 blob bytes and preserves its empty-string fallback for unavailable markdown', async () => {
  azureMocks.downloadToBuffer.mockResolvedValueOnce(Buffer.from('Legacy post — café 🎬', 'utf8'))
  expect(await legacyAzureReview.getPostContent('legacy-item')).toBe('Legacy post — café 🎬')
  expect(azureMocks.downloadToBuffer).toHaveBeenCalledWith('content/legacy-item/post.md')

  azureMocks.downloadToBuffer.mockRejectedValueOnce(Object.assign(new Error('Blob missing'), { statusCode: 404 }))
  expect(await legacyAzureReview.getPostContent('missing-item')).toBe('')
  expect(azureMocks.downloadToBuffer).toHaveBeenLastCalledWith('content/missing-item/post.md')
  expect(mocks.downloadToBuffer).not.toHaveBeenCalled()
  expect(mocks.queryAll).not.toHaveBeenCalled()
})

test('storageService.REQ-001: legacy Azure media downloads preserve the caller destination and propagate download failures', async () => {
  const destination = join(root, 'legacy-download.mp4')
  azureMocks.downloadToFile.mockResolvedValueOnce(undefined)
  await legacyAzureReview.downloadMediaToFile('legacy-item', 'media.mp4', destination)
  expect(azureMocks.downloadToFile).toHaveBeenCalledWith('content/legacy-item/media.mp4', destination)

  const diskError = new Error('Destination is not writable')
  azureMocks.downloadToFile.mockRejectedValueOnce(diskError)
  await expect(legacyAzureReview.downloadMediaToFile('legacy-item', 'media.mp4', destination)).rejects.toBe(diskError)
  expect(mocks.downloadToFile).not.toHaveBeenCalled()
  expect(azureMocks.getEntity).not.toHaveBeenCalled()
})

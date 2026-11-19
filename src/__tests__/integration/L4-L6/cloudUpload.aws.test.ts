import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { initConfig } from '../../../L1-infra/config/environment.js'

const clients = vi.hoisted(() => ({
  getItem: vi.fn(),
  createItem: vi.fn(),
  incrementCounter: vi.fn(),
  uploadFile: vi.fn(),
  records: new Map<string, Record<string, unknown>>(),
  objects: new Map<string, Buffer>(),
}))

vi.mock('../../../L2-clients/aws/dynamoClient.js', () => ({
  getItem: clients.getItem,
  createItem: clients.createItem,
  incrementCounter: clients.incrementCounter,
  validateMetadata: vi.fn(),
  updateItem: vi.fn(),
  queryAll: vi.fn(),
  scanAll: vi.fn(),
}))
vi.mock('../../../L2-clients/aws/s3Client.js', () => ({
  uploadFile: clients.uploadFile,
  uploadBuffer: vi.fn(),
  downloadToFile: vi.fn(),
  downloadStream: vi.fn(),
  getMediaStream: vi.fn(),
  deleteObject: vi.fn(),
}))

import { isCloudEnabled, uploadToCloud } from '../../../L5-assets/bridges/cloudStorageBridge.js'

const root = resolve('.test-aws-integration-pipeline')
const videoPath = join(root, 'recording.mp4')
const queuePath = join(root, 'publish-queue')
const itemPath = join(queuePath, 'clip-linkedin')
const recording = Buffer.from('synthetic recording bytes')
const itemId = 'clip-linkedin'
const slug = 'integration-video'

function identity(table: string, value: Record<string, unknown>): string {
  return JSON.stringify([table, value.runId ?? value.itemId, value.videoSlug])
}

beforeAll(async () => {
  vi.stubEnv('GITHUB_RUN_ID', 'aws-pipeline-integration-run')
  initConfig({
    storageProvider: 'aws',
    awsRegion: 'us-east-1',
    awsS3Bucket: 'integration-bucket',
    awsS3Prefix: 'tenant',
    awsDynamodbContentTable: 'integration-content',
    awsDynamodbVideosTable: 'integration-videos',
    azureStorageAccountName: '',
    azureStorageAccountKey: '',
  })
  await mkdir(itemPath, { recursive: true })
  await writeFile(videoPath, recording)
  await writeFile(join(itemPath, 'metadata.json'), JSON.stringify({
    id: itemId,
    sourceVideo: `C:\\recordings\\${slug}`,
    platform: 'linkedin',
    clipType: 'short',
    mediaType: 'image',
    status: 'pending_review',
  }))
  await writeFile(join(itemPath, 'post.md'), 'Pipeline post')
  await writeFile(join(itemPath, 'media.png'), 'synthetic image')
  clients.getItem.mockImplementation(async (table: string, key: Record<string, unknown>) => clients.records.get(identity(table, key)) ?? null)
  clients.createItem.mockImplementation(async (table: string, item: Record<string, unknown>) => {
    const key = identity(table, item)
    if (clients.records.has(key)) return false
    clients.records.set(key, { ...item })
    return true
  })
  clients.uploadFile.mockImplementation(async (key: string, path: string) => {
    clients.objects.set(key, await readFile(path))
    return `s3://integration-bucket/tenant/${key}`
  })
})

afterAll(async () => {
  vi.unstubAllEnvs()
  initConfig()
  await rm(root, { recursive: true, force: true })
})

describe('Integration L4-L6: AWS cloud upload pipeline', () => {
  test('cloudStorageOperations.REQ-001 storageService.REQ-002 storageService.REQ-008: L5 bridge uploads raw video and queue through selected AWS L4/L3 services, preserving run identity on retry', async () => {
    expect(await isCloudEnabled()).toBe(true)
    const metadata = { originalFilename: 'recording.mp4', duration: 12, size: recording.length }
    const result = await uploadToCloud(videoPath, queuePath, slug, metadata)
    expect(result).toEqual({ runId: 'aws-pipeline-integration-run', videoUploaded: true, contentUploaded: 1, errors: [] })

    const video = clients.records.get(identity('integration-videos', { runId: result.runId }))
    const content = clients.records.get(identity('integration-content', { itemId, videoSlug: slug }))
    expect(video).toMatchObject({ ...metadata, runId: result.runId, slug, status: 'completed' })
    expect(content).toMatchObject({ itemId, videoSlug: slug, sourceVideoRunId: result.runId, postContent: 'Pipeline post', status: 'pending_review' })
    expect(clients.objects.get(String(video?.blobPath))).toEqual(recording)
    expect(clients.objects.get(`${String(content?.blobBasePath)}media.png`)?.toString()).toBe('synthetic image')
    expect(clients.uploadFile).toHaveBeenCalledWith(video?.blobPath, videoPath, 'video/mp4')
    expect(clients.incrementCounter).toHaveBeenCalledWith('integration-videos', { runId: result.runId }, 'contentCount', 1)

    const uploadsBeforeRetry = clients.uploadFile.mock.calls.length
    expect(await uploadToCloud(videoPath, queuePath, slug, metadata)).toEqual({ ...result, contentUploaded: 0 })
    expect(clients.uploadFile).toHaveBeenCalledTimes(uploadsBeforeRetry)
    expect(clients.incrementCounter).toHaveBeenCalledTimes(1)
  })
})

import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

const transport = vi.hoisted(() => ({
  send: vi.fn(),
  upload: vi.fn(),
  options: vi.fn(),
  objects: new Map<string, Buffer>(),
  record: undefined as Record<string, unknown> | undefined,
  indexRecord: undefined as Record<string, unknown> | undefined,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    STORAGE_PROVIDER: 'aws',
    AWS_REGION: 'us-east-1',
    AWS_S3_BUCKET: 'integration-bucket',
    AWS_S3_PREFIX: 'tenant',
    AWS_DYNAMODB_CONTENT_TABLE: 'integration-content',
    AWS_DYNAMODB_VIDEOS_TABLE: 'integration-videos',
    AZURE_STORAGE_ACCOUNT_NAME: '',
    AZURE_STORAGE_ACCOUNT_KEY: '',
    AZURE_CONTAINER_NAME: 'unused',
  }),
}))

vi.mock('../../../L1-infra/aws/awsSdk.js', () => {
  const command = (kind: string) => class {
    readonly kind = kind
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(options: unknown) { transport.options(options) }
      send = transport.send
    },
    DynamoDBClient: class {
      constructor(options: unknown) { transport.options(options) }
    },
    DynamoDBDocumentClient: { from: () => ({ send: transport.send }) },
    GetCommand: command('get'),
    PutCommand: command('put'),
    UpdateCommand: command('update'),
    QueryCommand: command('query'),
    ScanCommand: command('scan'),
    GetObjectCommand: command('getObject'),
    PutObjectCommand: command('putObject'),
    DeleteObjectCommand: command('deleteObject'),
    Upload: class {
      constructor(private options: { params: { Key: string; Body: AsyncIterable<Uint8Array> } }) {
        transport.upload(options)
      }
      async done(): Promise<void> {
        const chunks: Buffer[] = []
        for await (const chunk of this.options.params.Body) chunks.push(Buffer.from(chunk))
        transport.objects.set(this.options.params.Key, Buffer.concat(chunks))
      }
      abort = vi.fn().mockResolvedValue(undefined)
    },
  }
})

import * as storage from '../../../L3-services/storage/storageService.js'
import * as review from '../../../L3-services/storage/reviewDataSource.js'

const root = resolve('.test-aws-integration-l3')
const media = Buffer.from('synthetic-image-content')
const metadata = {
  id: 'clip-linkedin',
  videoSlug: 'recording',
  sourceVideo: 'C:\\recordings\\recording',
  platform: 'linkedin',
  clipType: 'short',
  mediaType: 'image',
  status: 'pending_review',
  createdAt: '2026-11-17T10:00:00.000Z',
  hashtags: ['#VidPipe'],
}

beforeAll(async () => {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'metadata.json'), JSON.stringify(metadata))
  await writeFile(join(root, 'post.md'), 'Original post')
  await writeFile(join(root, 'media.png'), media)

  transport.send.mockImplementation(async ({ kind, input }: { kind: string; input: Record<string, unknown> }) => {
    if (kind === 'getObject') {
      const body = transport.objects.get(String(input.Key))
      if (!body) throw new Error(`Missing uploaded object: ${String(input.Key)}`)
      return {
        Body: Readable.from(body.subarray(1, 4)),
        ContentType: 'image/png',
        ContentLength: 3,
        ContentRange: `bytes 1-3/${body.length}`,
        $metadata: { httpStatusCode: 206 },
      }
    }
    if (input.TableName !== 'integration-content') throw new Error(`Unexpected table: ${String(input.TableName)}`)
    if (kind === 'get') {
      const key = input.Key as Record<string, unknown>
      const item = transport.record
      return { Item: item && key.itemId === item.itemId && key.videoSlug === item.videoSlug ? structuredClone(item) : undefined }
    }
    if (kind === 'put') {
      transport.record = structuredClone(input.Item as Record<string, unknown>)
      transport.indexRecord = structuredClone(transport.record)
      return {}
    }
    if (kind === 'query') {
      const item = input.IndexName ? transport.indexRecord : transport.record
      const values = input.ExpressionAttributeValues as Record<string, unknown>
      const matches = item && (input.IndexName ? values[':status'] === item.status : values[':id'] === item.itemId)
      return { Items: matches ? [structuredClone(item)] : [] }
    }
    if (kind === 'update' && transport.record) {
      const names = input.ExpressionAttributeNames as Record<string, string>
      const values = input.ExpressionAttributeValues as Record<string, unknown>
      if (transport.record.status !== values[':expectedStatus']) throw new Error('Stale status update')
      for (const [alias, name] of Object.entries(names)) {
        if (alias.startsWith('#f')) transport.record[name] = values[`:v${alias.slice(2)}`]
      }
      return {}
    }
    throw new Error(`Unexpected SDK operation: ${kind}`)
  })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Integration L3: selected AWS storage with real clients', () => {
  test('storageService.REQ-001 storageService.REQ-002 storageService.REQ-004 reviewDataSource.REQ-001 reviewDataSource.REQ-002: uploads, reads, approves and streams through the L1 SDK boundary without Azure', async () => {
    const base = await storage.uploadContentItem(root, metadata.id, metadata.videoSlug, 'integration-run')
    expect(await storage.getContentItem(metadata.videoSlug, metadata.id)).toMatchObject({
      partitionKey: metadata.videoSlug,
      rowKey: metadata.id,
      sourceVideo: metadata.sourceVideo,
      status: 'pending_review',
      blobBasePath: base,
      postContent: 'Original post',
    })
    expect(transport.objects.get(`tenant/${base}media.png`)).toEqual(media)
    expect(JSON.parse(transport.objects.get(`tenant/${base}metadata.json`)!.toString())).toEqual(metadata)
    expect((await review.listPendingItems()).map(item => item.id)).toEqual([metadata.id])

    await review.approveItem(metadata.videoSlug, metadata.id)
    expect(await review.getItemById(metadata.videoSlug, metadata.id)).toMatchObject({ status: 'approved' })
    expect(await review.listPendingItems()).toEqual([])
    expect(transport.indexRecord?.status).toBe('pending_review')

    const response = await review.getMediaStream(metadata.id, 'media.png', 'bytes=1-3')
    const chunks: Buffer[] = []
    for await (const chunk of response.stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(media.subarray(1, 4))
    expect(response).toMatchObject({ statusCode: 206, contentLength: 3, contentRange: `bytes 1-3/${media.length}`, acceptRanges: 'bytes' })
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'getObject',
      input: expect.objectContaining({ Bucket: 'integration-bucket', Key: `tenant/${base}media.png`, Range: 'bytes=1-3' }),
    }))
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'get',
      input: expect.objectContaining({ Key: { itemId: metadata.id, videoSlug: metadata.videoSlug }, ConsistentRead: true }),
    }))
    expect(transport.send.mock.calls.filter(([call]) => call.kind === 'get').every(([call]) => call.input.ConsistentRead === true)).toBe(true)
    expect(transport.send.mock.calls.filter(([call]) => call.kind === 'query' && call.input.IndexName).every(([call]) => call.input.ConsistentRead === false)).toBe(true)
    expect(transport.upload.mock.invocationCallOrder.at(-1)).toBeLessThan(transport.send.mock.invocationCallOrder[1])
    expect(transport.options.mock.calls.every(([options]) => options.region === 'us-east-1' && !('credentials' in options))).toBe(true)
    expect(await readFile(join(root, 'post.md'), 'utf8')).toBe('Original post')
  })
})

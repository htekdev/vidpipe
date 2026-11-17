import { beforeEach, expect, test, vi } from 'vitest'
import { Readable } from 'node:stream'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { initConfig } from '../../../L1-infra/config/environment.js'

const mocks = vi.hoisted(() => ({ send: vi.fn(), done: vi.fn(), abort: vi.fn(), upload: vi.fn(), s3: vi.fn(), ddb: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { constructor(options: unknown) { mocks.s3(options) } send = mocks.send },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class { constructor(options: unknown) { mocks.ddb(options) } } }))
vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: () => ({ send: mocks.send }) },
  GetCommand: class { constructor(public input: unknown) {} },
  PutCommand: class { constructor(public input: unknown) {} },
  QueryCommand: class { constructor(public input: unknown) {} },
  ScanCommand: class { constructor(public input: unknown) {} },
  UpdateCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: class { constructor(options: unknown) { mocks.upload(options) } done = mocks.done; abort = mocks.abort },
}))
import * as db from '../../../L2-clients/aws/dynamoClient.js'
import * as s3 from '../../../L2-clients/aws/s3Client.js'

beforeEach(() => {
  vi.resetAllMocks()
  mocks.abort.mockResolvedValue(undefined)
  process.env.AWS_REGION = 'us-east-1'
  process.env.AWS_S3_BUCKET = 'bucket'
  process.env.AWS_S3_PREFIX = 'tenant/'
  initConfig()
})

test('awsClients.REQ-001: consumes empty pages and uses strong base reads', async () => {
  mocks.send.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { itemId: 'a' } }).mockResolvedValueOnce({ Items: [{ itemId: 'b' }] })
  expect(await db.queryAll({ TableName: 'content', KeyConditionExpression: 'itemId = :id' })).toEqual([{ itemId: 'b' }])
  expect(mocks.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ itemId: 'a' })
  mocks.send.mockResolvedValueOnce({ Item: { itemId: 'b' } })
  await db.getItem('content', { itemId: 'b', videoSlug: 'v' })
  expect(mocks.send.mock.lastCall?.[0].input.ConsistentRead).toBe(true)
})

test('awsClients.REQ-002: conditional conflicts skip and oversized metadata fails before writing', async () => {
  mocks.send.mockRejectedValueOnce(Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' }))
  expect(await db.createItem('content', { itemId: 'a', videoSlug: 'v' })).toBe(false)
  expect(mocks.send.mock.lastCall?.[0].input.ConditionExpression).toContain('attribute_not_exists')
  await expect(db.createItem('content', { itemId: 'a', text: 'a'.repeat(400 * 1024) })).rejects.toThrow(/metadata/i)
  expect(mocks.send).toHaveBeenCalledTimes(1)
})

test('awsClients.REQ-003: multipart failures abort and range responses preserve headers', async () => {
  mocks.done.mockRejectedValueOnce(new Error('upload failed'))
  await expect(s3.uploadBody('content/a', Readable.from('data'), 'text/plain')).rejects.toThrow('upload failed')
  expect(mocks.abort).toHaveBeenCalled()
  const stream = Readable.from('abc')
  mocks.send.mockResolvedValueOnce({ Body: stream, ContentType: 'video/mp4', ContentLength: 3, ContentRange: 'bytes 1-3/10', $metadata: { httpStatusCode: 206 } })
  expect(await s3.getMediaStream('content/a', 'bytes=1-3')).toMatchObject({ stream, contentLength: 3, contentRange: 'bytes 1-3/10', statusCode: 206 })
  await expect(s3.getMediaStream('a', 'bytes=1-2,4-5')).rejects.toThrow(/range/i)
})

test('awsClients.REQ-004: uses configured namespace and leaves credentials to default chain', async () => {
  mocks.send.mockResolvedValueOnce({})
  await s3.uploadBuffer('content/a', Buffer.from('ok'))
  expect(mocks.s3).toHaveBeenLastCalledWith({ region: 'us-east-1' })
  expect(mocks.send.mock.lastCall?.[0].input).toMatchObject({ Bucket: 'bucket', Key: 'tenant/content/a' })
})

test('awsClients.REQ-001: scans every empty continuation page and never strongly reads a GSI', async () => {
  mocks.send.mockResolvedValueOnce({ LastEvaluatedKey: { id: 'a' } }).mockResolvedValueOnce({ Items: [{ id: 'b' }] })
  expect(await db.scanAll({ TableName: 'content' })).toEqual([{ id: 'b' }])
  expect(mocks.send.mock.lastCall?.[0].input.ExclusiveStartKey).toEqual({ id: 'a' })
  mocks.send.mockResolvedValueOnce({ Items: [] })
  expect(await db.queryAll({ TableName: 'content', IndexName: 'status-createdAt-index' })).toEqual([])
  expect(mocks.send.mock.lastCall?.[0].input.ConsistentRead).toBe(false)
  mocks.send.mockResolvedValueOnce({})
  expect(await db.getItem('content', { itemId: 'missing' })).toBeNull()
})

test('awsClients.REQ-002: preserves updates with expected status and does not create missing records', async () => {
  mocks.send.mockResolvedValue({})
  await db.updateItem('content', { itemId: 'a', videoSlug: 'v' }, { postContent: 'edited', unused: undefined }, 'approved')
  expect(mocks.send.mock.lastCall?.[0].input).toMatchObject({
    ConditionExpression: 'attribute_exists(#key) AND #expectedStatus = :expectedStatus',
    UpdateExpression: 'SET #f0 = :v0',
    ExpressionAttributeValues: { ':v0': 'edited', ':expectedStatus': 'approved' },
  })
  await db.updateItem('videos', { runId: 'run' }, { contentCount: 2 })
  expect(mocks.send.mock.lastCall?.[0].input.ConditionExpression).toBe('attribute_exists(#key)')
  await db.updateItem('content', { itemId: 'a' }, {})
  expect(mocks.send).toHaveBeenCalledTimes(2)
  mocks.send.mockRejectedValueOnce(new Error('access denied'))
  await expect(db.createItem('content', { itemId: 'a' })).rejects.toThrow('access denied')
  mocks.send.mockResolvedValueOnce({})
  expect(await db.createItem('content', { itemId: 'a' })).toBe(true)
})

test('awsClients.REQ-002: counters increment atomically only on existing records', async () => {
  mocks.send.mockResolvedValueOnce({})
  await db.incrementCounter('videos', { runId: 'run' }, 'contentCount', 2)
  expect(mocks.send.mock.lastCall?.[0].input).toMatchObject({
    Key: { runId: 'run' }, UpdateExpression: 'ADD #counter :amount',
    ConditionExpression: 'attribute_exists(#key)', ExpressionAttributeValues: { ':amount': 2 },
  })
})

test('awsClients.REQ-003: streaming upload success releases input; downloads stream to disk and buffer small objects', async () => {
  const root = '.test-aws-client'
  await mkdir(root, { recursive: true })
  try {
    await writeFile(`${root}\\source.mp4`, 'source')
    mocks.done.mockResolvedValueOnce({})
    expect(await s3.uploadFile('video.mp4', `${root}\\source.mp4`, 'video/mp4')).toBe('s3://bucket/tenant/video.mp4')
    expect(mocks.upload.mock.lastCall?.[0]).toMatchObject({ leavePartsOnError: false, params: { ContentType: 'video/mp4' } })
    expect(mocks.upload.mock.lastCall?.[0].params.Body.destroyed).toBe(true)
    mocks.send.mockResolvedValueOnce({ Body: Readable.from(['one', 'two']), $metadata: {} })
    expect((await s3.downloadToBuffer('post.md')).toString()).toBe('onetwo')
    mocks.send.mockResolvedValueOnce({ Body: Readable.from('download'), $metadata: {} })
    await s3.downloadToFile('video.mp4', `${root}\\nested\\download.mp4`)
    expect(await readFile(`${root}\\nested\\download.mp4`, 'utf8')).toBe('download')
    mocks.send.mockResolvedValueOnce({})
    await s3.deleteObject('owned-key')
    expect(mocks.send.mock.lastCall?.[0].input.Key).toBe('tenant/owned-key')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('awsClients.REQ-003: forwards service range failures as HTTP 416 and rejects absent bodies', async () => {
  mocks.send.mockRejectedValueOnce(Object.assign(new Error('Requested Range Not Satisfiable'), { $metadata: { httpStatusCode: 416 } }))
  await expect(s3.getMediaStream('video', 'bytes=1000-')).rejects.toMatchObject({ statusCode: 416 })
  mocks.send.mockResolvedValueOnce({ $metadata: {} })
  await expect(s3.getMediaStream('video')).rejects.toThrow(/readable body/)
  await expect(s3.getMediaStream('video', 'bytes=9-1')).rejects.toMatchObject({ statusCode: 416 })
  const body = Readable.from('all')
  mocks.send.mockResolvedValueOnce({ Body: body, $metadata: {} })
  const response = await s3.getMediaStream('video')
  expect(response).toMatchObject({ contentType: 'application/octet-stream', statusCode: 200, acceptRanges: 'bytes' })
  response.stream.destroy()
  expect(body.destroyed).toBe(true)
})

test('awsClients.REQ-004: missing configuration releases opened multipart stream without network access', async () => {
  process.env.AWS_S3_BUCKET = ''
  initConfig()
  const body = Readable.from('source')
  await expect(s3.uploadBody('video', body)).rejects.toThrow(/AWS_S3_BUCKET/)
  expect(body.destroyed).toBe(true)
  expect(mocks.upload).not.toHaveBeenCalled()
})

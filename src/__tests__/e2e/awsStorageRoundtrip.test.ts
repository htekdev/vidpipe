import { execFile } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, expect, test } from 'vitest'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../../', import.meta.url))
const loader = pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
type Entity = Record<string, { S?: string; N?: string }>
const rows = new Map<string, Entity>()
const objects = new Map<string, Buffer>()
let workspace: string
let server: Server
let environment: NodeJS.ProcessEnv

function rowKey(table: string, key: Entity): string {
  return JSON.stringify([table, key.runId?.S, key.itemId?.S, key.videoSlug?.S])
}

beforeAll(async () => {
  workspace = await mkdtemp(join(root, '.aws-roundtrip-e2e-'))
  server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const target = String(req.headers['x-amz-target'] ?? '').split('.').at(-1)
      if (target) {
        const input = JSON.parse(body.toString())
        const key = rowKey(input.TableName, input.Key ?? input.Item ?? {})
        let output: Record<string, unknown> = {}
        if (target === 'GetItem') output = { Item: rows.get(key) }
        else if (target === 'PutItem') rows.set(key, input.Item)
        else if (target === 'UpdateItem') {
          const record = rows.get(key)
          if (!record) throw new Error('Update of missing offline record')
          if (input.UpdateExpression.startsWith('ADD')) {
            const name = input.ExpressionAttributeNames['#counter']
            record[name] = { N: String(Number(record[name]?.N ?? 0) + Number(input.ExpressionAttributeValues[':amount'].N)) }
          } else {
            for (const [alias, name] of Object.entries(input.ExpressionAttributeNames)) {
              if (alias.startsWith('#f')) record[String(name)] = input.ExpressionAttributeValues[`:v${alias.slice(2)}`]
            }
          }
        } else if (target === 'Query' || target === 'Scan') {
          const values = input.ExpressionAttributeValues as Entity | undefined
          const attribute = values?.[':status'] ? 'status' : 'itemId'
          const value = values?.[':status'] ?? values?.[':id']
          output = { Items: [...rows.entries()].filter(([id, row]) =>
            id.startsWith(`["${input.TableName}",`) && (!value || row[attribute]?.S === value.S),
          ).map(([, row]) => row) }
        } else throw new Error(`Unexpected offline DynamoDB operation: ${target}`)
        res.setHeader('content-type', 'application/x-amz-json-1.0')
        res.end(JSON.stringify(output))
        return
      }
      const key = decodeURIComponent(new URL(req.url!, 'http://127.0.0.1').pathname.replace(/^\/offline-bucket\//, ''))
      if (req.method === 'PUT') {
        objects.set(key, body)
        res.setHeader('ETag', '"offline-etag"')
        res.end()
      } else if (req.method === 'GET' && objects.has(key)) {
        const bytes = objects.get(key)!
        res.setHeader('Content-Length', bytes.length)
        res.setHeader('Content-Type', key.endsWith('.md') ? 'text/markdown' : 'video/mp4')
        res.end(bytes)
      } else {
        res.statusCode = 404
        res.end()
      }
    } catch (error) {
      res.statusCode = 500
      res.end(JSON.stringify({ message: String(error) }))
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Offline endpoint did not bind')
  environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/API_KEY|TOKEN|SECRET|PASSWORD|^AWS_|^AZURE_|^GH_|^GITHUB_|^LATE_/.test(key)) environment[key] = ''
  }
  Object.assign(environment, {
    VIDPIPE_CONFIG_DIR: join(workspace, 'config'), APPDATA: workspace, LOCALAPPDATA: workspace,
    STORAGE_PROVIDER: 'aws', AWS_REGION: 'us-east-1', AWS_S3_BUCKET: 'offline-bucket', AWS_S3_PREFIX: 'test-prefix',
    AWS_DYNAMODB_CONTENT_TABLE: 'content', AWS_DYNAMODB_VIDEOS_TABLE: 'videos',
    AWS_ACCESS_KEY_ID: 'offline-access', AWS_SECRET_ACCESS_KEY: 'offline-secret',
    AWS_ENDPOINT_URL: `http://127.0.0.1:${address.port}`, AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'false',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'WHEN_REQUIRED', AWS_EC2_METADATA_DISABLED: 'true',
    AWS_SHARED_CREDENTIALS_FILE: join(workspace, 'empty-credentials'), AWS_CONFIG_FILE: join(workspace, 'empty-aws-config'),
    OUTPUT_DIR: join(workspace, 'output'), GITHUB_RUN_ID: 'offline-run',
  })
  await Promise.all(['empty-credentials', 'empty-aws-config'].map(name => writeFile(join(workspace, name), '')))
})

afterAll(async () => {
  if (server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

test('CloudStorage.REQ-007 storageService.REQ-007 awsClients.REQ-005 reviewDataSource.REQ-004: real CLI renamed uploads and generated S3 URLs retain exact keys and review partitions', async () => {
  const recording = join(workspace, 'Original Folder')
  const itemDir = join(workspace, 'output', 'publish-queue', 'duplicate')
  const bytes = Buffer.from('offline recording bytes')
  const filename = 'My Video % #.mp4'
  await Promise.all([mkdir(recording, { recursive: true }), mkdir(itemDir, { recursive: true })])
  await Promise.all([
    writeFile(join(recording, filename), bytes),
    writeFile(join(itemDir, 'metadata.json'), JSON.stringify({
      id: 'duplicate', sourceVideo: recording, platform: 'linkedin', mediaType: 'video',
      mediaFilename: 'media.mp4', createdAt: '2025-01-01',
    })),
    writeFile(join(itemDir, 'post.md'), 'Displayed pending post'),
    writeFile(join(itemDir, 'media.mp4'), bytes),
  ])
  const result = await execute(process.execPath, ['--import', loader, join(root, 'src', 'L7-app', 'cli.ts'),
    'cloud', 'upload', recording, '--slug', 'renamed'], { cwd: workspace, env: environment, timeout: 45_000 })
  expect(result.stdout).toContain('Content uploaded: 1 item(s)')
  const uploaded = rows.get(rowKey('content', { itemId: { S: 'duplicate' }, videoSlug: { S: 'renamed' } }))!
  expect(uploaded.postContent.S).toBe('Displayed pending post')
  expect(uploaded.videoSlug.S).toBe('renamed')
  rows.set(rowKey('content', { itemId: { S: 'duplicate' }, videoSlug: { S: 'newer' } }), {
    ...uploaded, videoSlug: { S: 'newer' }, status: { S: 'published' },
    createdAt: { S: '2026-01-01' }, postContent: { S: 'Unrelated published history' },
  })
  const source = (...parts: string[]) => JSON.stringify(pathToFileURL(join(root, 'src', ...parts)).href)
  const script = join(workspace, 'roundtrip.mts')
  await writeFile(script, `
import { initConfig } from ${source('L1-infra', 'config', 'environment.ts')}
import * as storage from ${source('L3-services', 'storage', 'storageService.ts')}
import * as review from ${source('L3-services', 'storage', 'reviewDataSource.ts')}
initConfig()
const url = await storage.uploadVideoFile(${JSON.stringify(join(recording, filename))}, 'literal/My%20Video % #.mp4')
await storage.downloadStorageUrlToFile(url, ${JSON.stringify(join(workspace, 'download.mp4'))})
const [group] = await review.getGroupedItems()
const item = group.items[0]
const streamed = await review.getMediaStream(item.id, item.mediaFilename, undefined, item.videoSlug)
const chunks = []
for await (const chunk of streamed.stream) chunks.push(Buffer.from(chunk))
console.log('ROUNDTRIP=' + JSON.stringify({ url, item, media: Buffer.concat(chunks).toString(),
  post: await review.getPostContent(item.id, item.videoSlug),
  latest: (await storage.findContentItemByRowKey(item.id)).partitionKey }))
`)
  const { stdout } = await execute(process.execPath, ['--import', loader, script], { cwd: workspace, env: environment, timeout: 45_000 })
  const payload = JSON.parse(stdout.split(/\r?\n/).find(line => line.startsWith('ROUNDTRIP='))!.slice(10))
  expect(payload).toMatchObject({
    item: { id: 'duplicate', videoSlug: 'renamed', postContent: 'Displayed pending post' },
    post: 'Displayed pending post', latest: 'newer', media: bytes.toString(),
  })
  expect(payload.url).toContain('My%2520Video%20%25%20%23.mp4')
  expect(await readFile(join(workspace, 'download.mp4'))).toEqual(bytes)
  expect(objects.get('test-prefix/literal/My%20Video % #.mp4')).toEqual(bytes)
}, 120_000)

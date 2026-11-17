import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVidPipe } from '../../L7-app/sdk/VidPipeSDK.js'

describe('AWS SDK storage guards with real configuration', () => {
  const savedEnvironment = { ...process.env }
  let directory: string

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vidpipe-aws-guards-'))
    process.env.VIDPIPE_CONFIG_DIR = join(directory, 'config')
    process.env.AZURE_STORAGE_ACCOUNT_NAME = ''
    process.env.AZURE_STORAGE_ACCOUNT_KEY = ''
    process.env.AWS_EC2_METADATA_DISABLED = 'true'
  })

  afterAll(async () => {
    for (const key of new Set([...Object.keys(process.env), ...Object.keys(savedEnvironment)])) {
      if (savedEnvironment[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnvironment[key]
    }
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  function createAwsSdk() {
    return createVidPipe({
      storageProvider: 'aws',
      awsRegion: 'us-east-1',
      awsS3Bucket: 'vidpipe-test-bucket',
      awsS3Prefix: 'vidpipe',
      awsDynamodbContentTable: 'vidpipe-test-content',
      awsDynamodbVideosTable: 'vidpipe-test-videos',
      outputDir: join(directory, 'output'),
      watchFolder: join(directory, 'watch'),
    })
  }

  test('CloudStorage.REQ-006: AWS readiness and unsupported-operation guards work without Azure credentials', async () => {
    const sdk = createAwsSdk()
    const before = await readdir(directory)
    expect(sdk.cloud.isConfigured()).toBe(true)
    await expect(sdk.cloud.process(join(directory, 'missing.mp4'))).rejects.toThrow(/not supported.*AWS/i)
    await expect(sdk.cloud.pushConfig()).rejects.toThrow(/not supported.*AWS/i)
    await expect(sdk.cloud.pullConfig()).rejects.toThrow(/not supported.*AWS/i)
    expect(await readdir(directory)).toEqual(before)
  })

  test('CloudStorage.REQ-004: real storage selection rejects foreign buckets, prefixes and Azure URLs before downloading', async () => {
    const sdk = createAwsSdk()
    const output = join(directory, 'download.mp4')
    await expect(sdk.cloud.download('s3://another-bucket/vidpipe/video.mp4', output)).rejects.toThrow(/bucket/i)
    await expect(sdk.cloud.download('s3://vidpipe-test-bucket/another-prefix/video.mp4', output)).rejects.toThrow(/prefix/i)
    await expect(sdk.cloud.download('blob://raw/video.mp4', output)).rejects.toThrow(/S3|Azure|AWS/i)
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

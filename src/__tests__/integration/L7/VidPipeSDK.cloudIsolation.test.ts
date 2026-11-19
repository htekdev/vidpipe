import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getConfig } from '../../../L1-infra/config/environment.js'
import { createVidPipe } from '../../../L7-app/sdk/VidPipeSDK.js'
import type { VidPipeConfig, VidPipeSDK } from '../../../L7-app/sdk/types.js'

const mocks = vi.hoisted(() => ({
  upload: vi.fn(), migrate: vi.fn(), download: vi.fn(), content: vi.fn(), videos: vi.fn(),
  push: vi.fn(), pull: vi.fn(), files: vi.fn(), spawn: vi.fn(),
}))

// Keep real L1 configuration: mocked service boundaries read it again after awaits.
vi.mock('../../../L3-services/storage/storageService.js', () => ({
  getStorageProviderName: () => getConfig().STORAGE_PROVIDER,
  isStorageConfigured: () => {
    const config = getConfig()
    return config.STORAGE_PROVIDER === 'aws'
      ? Boolean(config.AWS_REGION && config.AWS_S3_BUCKET)
      : Boolean(config.AZURE_STORAGE_ACCOUNT_NAME && config.AZURE_STORAGE_ACCOUNT_KEY)
  },
  getRunId: () => 'isolation-run',
  uploadVideoFile: mocks.upload,
  migrateLocalContent: mocks.migrate,
  downloadStorageUrlToFile: mocks.download,
  getContentItems: mocks.content,
  listVideos: mocks.videos,
}))
vi.mock('../../../L3-services/azureStorage/azureConfigService.js', () => ({
  pushConfig: mocks.push, pullConfig: mocks.pull, listConfigFiles: mocks.files,
}))
vi.mock('../../../L1-infra/process/process.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../L1-infra/process/process.js')>(),
  spawnCommand: mocks.spawn,
}))

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function settings() {
  const config = getConfig()
  return {
    provider: config.STORAGE_PROVIDER, region: config.AWS_REGION, bucket: config.AWS_S3_BUCKET,
    prefix: config.AWS_S3_PREFIX, contentTable: config.AWS_DYNAMODB_CONTENT_TABLE,
    videosTable: config.AWS_DYNAMODB_VIDEOS_TABLE, account: config.AZURE_STORAGE_ACCOUNT_NAME,
    container: config.AZURE_CONTAINER_NAME,
  }
}

function options(id: string, storageProvider: 'aws' | 'azure'): VidPipeConfig {
  return {
    storageProvider, awsRegion: `region-${id}`, awsS3Bucket: `bucket-${id}`, awsS3Prefix: `prefix-${id}`,
    awsDynamodbContentTable: `content-${id}`, awsDynamodbVideosTable: `videos-${id}`,
  }
}

function expected(id: string, provider: 'aws' | 'azure') {
  return {
    provider, region: `region-${id}`, bucket: `bucket-${id}`, prefix: `prefix-${id}`,
    contentTable: `content-${id}`, videosTable: `videos-${id}`, account: 'fixture-account',
    container: 'fixture-container',
  }
}

beforeEach(() => {
  // Azure settings are resolved at construction from the supported environment inputs.
  vi.stubEnv('AZURE_STORAGE_ACCOUNT_NAME', 'fixture-account')
  vi.stubEnv('AZURE_STORAGE_ACCOUNT_KEY', 'fixture-key')
  vi.stubEnv('AZURE_CONTAINER_NAME', 'fixture-container')
  vi.resetAllMocks()
  mocks.upload.mockResolvedValue(undefined)
  mocks.migrate.mockResolvedValue({ uploaded: 0, errors: [] })
  mocks.download.mockResolvedValue(undefined)
  mocks.content.mockResolvedValue([])
  mocks.videos.mockResolvedValue([])
  mocks.push.mockResolvedValue({ uploaded: 0 })
  mocks.pull.mockResolvedValue({ downloaded: 0 })
  mocks.files.mockResolvedValue([])
  mocks.spawn.mockReturnValue({ status: 0 })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('SDK cloud instance isolation', () => {
  it('CloudStorage.REQ-008: AWS guards precede effects after constructing the default Azure instance', async () => {
    const aws = createVidPipe(options('a', 'aws'))
    const { storageProvider: _provider, ...azureOptions } = options('b', 'azure')
    const azure = createVidPipe(azureOptions)
    await expect(aws.cloud.process(import.meta.filename)).rejects.toThrow('not supported with AWS')
    await expect(aws.cloud.pushConfig()).rejects.toThrow('not supported with AWS')
    await expect(aws.cloud.pullConfig()).rejects.toThrow('not supported with AWS')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.pull).not.toHaveBeenCalled()
    await expect(azure.cloud.process(import.meta.filename)).resolves.toMatchObject({ workflowTriggered: true })
    expect(mocks.upload).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it('CloudStorage.REQ-008: synchronous readiness uses the invoking instance', () => {
    const configured = createVidPipe(options('a', 'aws'))
    const unconfigured = createVidPipe({ storageProvider: 'aws', awsRegion: '', awsS3Bucket: '' })
    expect(configured.cloud.isConfigured()).toBe(true)
    expect(unconfigured.cloud.isConfigured()).toBe(false)
  })

  it.each(['migrate', 'download', 'status', 'pushConfig', 'pullConfig', 'process'] as const)(
    'CloudStorage.REQ-008: interleaved %s retains provider and complete resource identity downstream',
    async (operation) => {
      const provider = operation === 'migrate' || operation === 'download' || operation === 'status' ? 'aws' : 'azure'
      const first = createVidPipe(options('a', provider))
      const entered = deferred()
      const release = deferred()
      const observations: ReturnType<typeof settings>[] = []
      const secondObservations: ReturnType<typeof settings>[] = []
      const boundary = {
        migrate: mocks.migrate, download: mocks.download, status: mocks.content,
        pushConfig: mocks.push, pullConfig: mocks.pull, process: mocks.upload,
      }[operation]
      boundary.mockImplementation(async () => {
        secondObservations.push(settings())
        await Promise.resolve()
        secondObservations.push(settings())
        return operation === 'status' ? [] : { uploaded: 0, errors: [] }
      })
      boundary.mockImplementationOnce(async () => {
        observations.push(settings())
        entered.resolve()
        await release.promise
        observations.push(settings())
        return operation === 'status' ? [] : { uploaded: 0, errors: [] }
      })
      const invoke = (sdk: VidPipeSDK, backend: 'aws' | 'azure') => {
        if (operation === 'download') return sdk.cloud.download(backend === 'aws'
          ? 's3://bucket-a/prefix-a/raw/video.mp4' : 'blob://raw/video.mp4', 'unused.mp4')
        if (operation === 'process') return sdk.cloud.process(import.meta.filename)
        return sdk.cloud[operation]()
      }

      const secondProvider = operation === 'migrate' ? 'aws' : 'azure'
      const running = invoke(first, provider)
      try {
        await entered.promise
        // Construction and the entire second operation occur while the first is suspended.
        const second = createVidPipe(options('b', secondProvider))
        await invoke(second, secondProvider)
      } finally {
        release.resolve()
      }
      await running
      expect(observations).toEqual([expected('a', provider), expected('a', provider)])
      expect(secondObservations).toEqual([expected('b', secondProvider), expected('b', secondProvider)])
      expect(settings()).toEqual(expected('b', secondProvider))
      if (operation === 'status') expect(mocks.files).toHaveBeenCalledOnce()
    },
  )
})

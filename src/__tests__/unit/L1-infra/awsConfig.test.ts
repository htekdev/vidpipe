import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const disk = vi.hoisted(() => ({ config: undefined as string | undefined }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn((path: string) => path === join('C:\\aws-config-test', 'config.json') && disk.config !== undefined),
    readFileSync: vi.fn(() => disk.config),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((path: string, value: string) => {
      if (path === join('C:\\aws-config-test', 'config.json')) disk.config = value
    }),
    chmodSync: vi.fn(),
  }
})

import { resolveConfig } from '../../../L1-infra/config/configResolver.js'
import { initConfig, getConfig } from '../../../L1-infra/config/environment.js'
import { loadGlobalConfig, saveGlobalConfig } from '../../../L1-infra/config/globalConfig.js'
import type { CLIOptions } from '../../../L1-infra/config/environment.js'

const settings = [
  ['awsRegion', 'AWS_REGION'],
  ['awsS3Bucket', 'AWS_S3_BUCKET'],
  ['awsS3Prefix', 'AWS_S3_PREFIX'],
  ['awsDynamodbContentTable', 'AWS_DYNAMODB_CONTENT_TABLE'],
  ['awsDynamodbVideosTable', 'AWS_DYNAMODB_VIDEOS_TABLE'],
] as const

describe('AWS configuration', () => {
  beforeEach(() => {
    disk.config = undefined
    vi.stubEnv('VIDPIPE_CONFIG_DIR', 'C:\\aws-config-test')
    vi.stubEnv('STORAGE_PROVIDER', '')
    for (const [, env] of settings) vi.stubEnv(env, '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('configResolver.REQ-001: defaults to Azure with empty AWS settings and resolves AWS without secrets', () => {
    const defaults = resolveConfig()
    expect(defaults.STORAGE_PROVIDER).toBe('azure')
    for (const [, env] of settings) expect(defaults[env]).toBe('')
    expect(resolveConfig({ storageProvider: 'aws' }).STORAGE_PROVIDER).toBe('aws')
  })

  it('configResolver.REQ-002: resolves provider at each precedence level', () => {
    disk.config = JSON.stringify({ credentials: {}, defaults: { storageProvider: 'aws' } })
    expect(resolveConfig().STORAGE_PROVIDER).toBe('aws')
    vi.stubEnv('STORAGE_PROVIDER', 'azure')
    expect(resolveConfig().STORAGE_PROVIDER).toBe('azure')
    expect(resolveConfig({ storageProvider: 'aws' }).STORAGE_PROVIDER).toBe('aws')
  })

  it.each(settings)('configResolver.REQ-002: resolves %s CLI > env > global > defaults including explicit empty CLI', (key, env) => {
    disk.config = JSON.stringify({ credentials: {}, defaults: { [key]: 'global-value' } })
    expect(resolveConfig()[env]).toBe('global-value')
    vi.stubEnv(env, 'env-value')
    expect(resolveConfig()[env]).toBe('env-value')
    const cli: Partial<CLIOptions> = { [key]: 'cli-value' }
    expect(resolveConfig(cli)[env]).toBe('cli-value')
    expect(resolveConfig({ [key]: '' })[env]).toBe('')
  })

  it.each(['cli', 'env', 'global'])('configResolver.REQ-003: rejects an invalid %s provider', (source) => {
    if (source === 'global') disk.config = JSON.stringify({ defaults: { storageProvider: 'gcp' } })
    if (source === 'env') vi.stubEnv('STORAGE_PROVIDER', 'gcp')
    expect(() => resolveConfig(source === 'cli' ? { storageProvider: 'gcp' } : {}))
      .toThrow(/STORAGE_PROVIDER.*azure.*aws/)
  })

  it('configResolver.REQ-003: rejects an explicitly empty CLI provider', () => {
    expect(() => resolveConfig({ storageProvider: '' })).toThrow(/STORAGE_PROVIDER/)
  })

  it('configResolver.REQ-004: leaves the AWS credential chain outside VidPipe configuration', () => {
    vi.stubEnv('AWS_PROFILE', 'developer-sso')
    vi.stubEnv('AWS_ACCESS_KEY_ID', undefined)
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', undefined)
    vi.stubEnv('AWS_SESSION_TOKEN', undefined)
    const config = resolveConfig({ storageProvider: 'aws' })
    expect(config).not.toHaveProperty('AWS_PROFILE')
    expect(config).not.toHaveProperty('AWS_ACCESS_KEY_ID')
    expect(config).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(process.env.AWS_PROFILE).toBe('developer-sso')
    expect(process.env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
  })

  it('environment.REQ-001: exposes selected storage settings through the public config API', () => {
    const config = initConfig({
      storageProvider: 'aws', awsRegion: 'us-west-2', awsS3Bucket: 'media',
      awsS3Prefix: 'vidpipe', awsDynamodbContentTable: 'content', awsDynamodbVideosTable: 'videos',
      azureStorageAccountName: '', azureStorageAccountKey: '',
    })
    expect(getConfig()).toBe(config)
    expect(config).toMatchObject({
      STORAGE_PROVIDER: 'aws', AWS_REGION: 'us-west-2', AWS_S3_BUCKET: 'media',
      AWS_S3_PREFIX: 'vidpipe', AWS_DYNAMODB_CONTENT_TABLE: 'content', AWS_DYNAMODB_VIDEOS_TABLE: 'videos',
    })
  })

  it('globalConfig.REQ-001: saves and reloads AWS settings as defaults, not credentials', () => {
    const defaults = {
      storageProvider: 'aws', awsRegion: 'us-west-2', awsS3Bucket: 'media',
      awsS3Prefix: 'vidpipe', awsDynamodbContentTable: 'content', awsDynamodbVideosTable: 'videos',
    }
    saveGlobalConfig({ credentials: {}, defaults })
    expect(loadGlobalConfig()).toEqual({ credentials: {}, defaults })
    expect(resolveConfig()).toMatchObject({ STORAGE_PROVIDER: 'aws', AWS_S3_BUCKET: 'media' })
  })
})

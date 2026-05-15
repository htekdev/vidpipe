import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  chmodSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}))

describe('L1 Unit: Azure config fields', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  test('AppEnvironment includes Azure fields', async () => {
    vi.stubEnv('AZURE_STORAGE_ACCOUNT_NAME', 'teststorage')
    vi.stubEnv('AZURE_STORAGE_ACCOUNT_KEY', 'testkey123')
    vi.stubEnv('AZURE_CONTAINER_NAME', 'mycontainer')

    const { resolveConfig } = await import('../../../L1-infra/config/configResolver.js')
    const config = resolveConfig({})

    expect(config.AZURE_STORAGE_ACCOUNT_NAME).toBe('teststorage')
    expect(config.AZURE_STORAGE_ACCOUNT_KEY).toBe('testkey123')
    expect(config.AZURE_CONTAINER_NAME).toBe('mycontainer')
  })

  test('Azure container name defaults to vidpipe', async () => {
    const { resolveConfig } = await import('../../../L1-infra/config/configResolver.js')
    const config = resolveConfig({})
    expect(config.AZURE_CONTAINER_NAME).toBe('vidpipe')
  })

  test('CLI options override Azure env vars', async () => {
    vi.stubEnv('AZURE_STORAGE_ACCOUNT_NAME', 'envname')
    const { resolveConfig } = await import('../../../L1-infra/config/configResolver.js')
    const config = resolveConfig({ azureStorageAccountName: 'cliname' })
    expect(config.AZURE_STORAGE_ACCOUNT_NAME).toBe('cliname')
  })
})

/**
 * E2E — Azure config resolution end-to-end.
 *
 * No mocks. Tests that Azure-related config fields resolve correctly
 * from environment variables and defaults, and that the CloudUpload
 * pipeline stage is properly registered.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { initConfig, getConfig } from '../../L1-infra/config/environment.js'

describe('E2E: Azure config resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    initConfig()
  })

  test('Azure fields resolve from environment variables', () => {
    vi.stubEnv('AZURE_STORAGE_ACCOUNT_NAME', 'e2e-test-account')
    vi.stubEnv('AZURE_STORAGE_ACCOUNT_KEY', 'e2e-test-key')
    vi.stubEnv('AZURE_CONTAINER_NAME', 'e2e-container')

    initConfig({})
    const config = getConfig()

    expect(config.AZURE_STORAGE_ACCOUNT_NAME).toBe('e2e-test-account')
    expect(config.AZURE_STORAGE_ACCOUNT_KEY).toBe('e2e-test-key')
    expect(config.AZURE_CONTAINER_NAME).toBe('e2e-container')
  })

  test('Azure container defaults to vidpipe when not set', () => {
    vi.stubEnv('AZURE_CONTAINER_NAME', '')
    initConfig({})
    expect(getConfig().AZURE_CONTAINER_NAME).toBe('vidpipe')
  })

  test('CloudUpload stage exists in pipeline stages', async () => {
    const { PIPELINE_STAGES, PipelineStage } = await import('../../L0-pure/types/index.js')
    const cloudStage = PIPELINE_STAGES.find(s => s.stage === PipelineStage.CloudUpload)
    expect(cloudStage).toBeDefined()
    expect(cloudStage!.stageNumber).toBe(18)
    expect(cloudStage!.name).toBe('Cloud Upload')
  })
})

/**
 * L3 Integration Test — Azure Config Service
 *
 * Mock boundary: L1 config (to control Azure credentials)
 * Real code:     L2 Azure blob client + L3 config service
 *
 * With empty Azure credentials, operations that directly call
 * blobClient methods (listBlobs, downloadToFile) throw.
 * pushConfig catches errors internally and returns zero uploads.
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    AZURE_STORAGE_ACCOUNT_NAME: '',
    AZURE_STORAGE_ACCOUNT_KEY: '',
    AZURE_CONTAINER_NAME: 'vidpipe',
  }),
}))

describe('Integration L3: Azure Config Service', () => {
  test('listConfigFiles throws when Azure not configured', async () => {
    const { listConfigFiles } = await import('../../../L3-services/azureStorage/azureConfigService.js')
    await expect(listConfigFiles()).rejects.toThrow('Azure Storage credentials not configured')
  })

  test('pullConfig throws when Azure not configured', async () => {
    const { pullConfig } = await import('../../../L3-services/azureStorage/azureConfigService.js')
    await expect(pullConfig('/nonexistent/target')).rejects.toThrow('Azure Storage credentials not configured')
  })

  test('pushConfig returns zero uploads when source path missing', async () => {
    const { pushConfig } = await import('../../../L3-services/azureStorage/azureConfigService.js')
    // pushConfig catches all errors internally (stat failures + Azure failures)
    const result = await pushConfig('/nonexistent/source')
    expect(result).toEqual({ uploaded: 0 })
  })
})

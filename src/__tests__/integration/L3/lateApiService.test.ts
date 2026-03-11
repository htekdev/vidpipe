/**
 * L3 Integration Test — lateApiService → L2 LateApiClient chain
 *
 * Mock boundary: L1 (config, logger)
 * Real code:     L2 LateApiClient, L3 lateApiService wrapper
 *
 * Validates that createLateApiClient() correctly instantiates
 * a real L2 LateApiClient through the L3 wrapper.
 */
import { vi, describe, test, expect } from 'vitest'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-integration-key' }),
}))

import { createLateApiClient } from '../../../L3-services/lateApi/lateApiService.js'

describe('L3 Integration: lateApiService → L2 LateApiClient', () => {
  test('createLateApiClient returns real LateApiClient instance', () => {
    const client = createLateApiClient('test-integration-key')
    expect(client).toBeDefined()
    expect(typeof client.listAccounts).toBe('function')
    expect(typeof client.createPost).toBe('function')
  })
})

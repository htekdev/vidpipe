/**
 * E2E Test — lateApiService wrapper creates real L2 LateApiClient
 *
 * No mocking — verifies that createLateApiClient() produces
 * a real LateApiClient instance with expected methods.
 */
import { describe, test, expect } from 'vitest'
import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'

describe('E2E: lateApiService wrappers', () => {
  test('createLateApiClient produces client with expected interface', () => {
    const client = createLateApiClient('e2e-test-key')
    expect(client).toBeDefined()
    expect(typeof client.listAccounts).toBe('function')
    expect(typeof client.createPost).toBe('function')
    expect(typeof client.validateConnection).toBe('function')
  })
})

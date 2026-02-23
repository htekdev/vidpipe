import { vi, describe, test, expect } from 'vitest'

const mockLateApiClient = vi.hoisted(() => vi.fn().mockImplementation(function(this: Record<string, unknown>, apiKey?: string) {
  this.apiKey = apiKey ?? 'default-key'
  this.getAccounts = vi.fn()
}))

vi.mock('../../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: mockLateApiClient,
}))

import { createLateApiClient } from '../../../../L3-services/lateApi/lateApiService.js'

describe('L3 lateApiService wrappers', () => {
  test('createLateApiClient delegates to L2 constructor with no args', () => {
    const client = createLateApiClient()
    expect(mockLateApiClient).toHaveBeenCalledWith()
    expect(client).toBeDefined()
  })

  test('createLateApiClient delegates to L2 constructor with apiKey', () => {
    const client = createLateApiClient('test-key')
    expect(mockLateApiClient).toHaveBeenCalledWith('test-key')
    expect(client).toBeDefined()
  })
})

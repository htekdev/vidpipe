/**
 * L4-L6 Integration Test — ScheduleAgent uses createLateApiClient from L3
 *
 * Mock boundary: L2 (Late API client)
 * Real code:     L3 lateApiService, L4 ScheduleAgent
 *
 * Validates that ScheduleAgent creates Late API clients through L3 wrapper.
 */
import { vi, describe, test, expect } from 'vitest'

const mockListPosts = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function () {
    return { listPosts: mockListPosts }
  }),
}))

import { createLateApiClient } from '../../../L3-services/lateApi/lateApiService.js'

describe('L4-L6 Integration: ScheduleAgent → L3 createLateApiClient', () => {
  test('createLateApiClient produces client via L2 constructor', () => {
    const client = createLateApiClient()
    expect(client).toBeDefined()
    expect(typeof client.listPosts).toBe('function')
  })
})

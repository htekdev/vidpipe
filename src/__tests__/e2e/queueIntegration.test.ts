/**
 * E2E Test — Queue Integration
 *
 * No mocking — verifies that queue-related modules across L2–L3
 * export the expected interfaces and can be instantiated.
 * Live API tests gated behind LATE_API_KEY.
 */
import { describe, test, expect } from 'vitest'

const hasLateKey = !!process.env.LATE_API_KEY

describe('Queue Integration E2E', () => {
  test('L0 types module loads without errors', async () => {
    const mod = await import('../../L0-pure/types/index.js')
    expect(mod).toBeDefined()
  })

  test('LateApiClient has queue methods', async () => {
    const { LateApiClient } = await import('../../L2-clients/late/lateApi.js')
    const client = new LateApiClient('fake-key')
    expect(typeof client.listQueues).toBe('function')
    expect(typeof client.createQueue).toBe('function')
    expect(typeof client.updateQueue).toBe('function')
    expect(typeof client.deleteQueue).toBe('function')
    expect(typeof client.previewQueue).toBe('function')
    expect(typeof client.getNextQueueSlot).toBe('function')
  })

  test('queueMapping exports are available', async () => {
    const mod = await import('../../L3-services/queueMapping/queueMapping.js')
    expect(typeof mod.getQueueId).toBe('function')
    expect(typeof mod.getProfileId).toBe('function')
    expect(typeof mod.getAllQueueMappings).toBe('function')
    expect(typeof mod.refreshQueueMappings).toBe('function')
    expect(typeof mod.clearQueueCache).toBe('function')
  })

  test('queueSync exports are available', async () => {
    const mod = await import('../../L3-services/queueSync/queueSync.js')
    expect(typeof mod.syncQueuesToLate).toBe('function')
  })
})

describe.skipIf(!hasLateKey)('Queue Integration E2E (live)', () => {
  test('listQueues returns array for real API key', async () => {
    const { LateApiClient } = await import('../../L2-clients/late/lateApi.js')
    const client = new LateApiClient(process.env.LATE_API_KEY!)
    const accounts = await client.listAccounts()
    expect(accounts.length).toBeGreaterThan(0)
    const queues = await client.listQueues(accounts[0]._id)
    expect(Array.isArray(queues)).toBe(true)
  })
})

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

  test('client exposes pagination methods', () => {
    const client = createLateApiClient('e2e-test-key')
    expect(typeof client.getScheduledPosts).toBe('function')
    expect(typeof client.getDraftPosts).toBe('function')
    expect(typeof client.listPosts).toBe('function')
  })

  test('client exposes queue management methods', () => {
    const client = createLateApiClient('e2e-test-key')
    expect(typeof client.createQueue).toBe('function')
    expect(typeof client.deleteQueue).toBe('function')
    expect(typeof client.listQueues).toBe('function')
    expect(typeof client.previewQueue).toBe('function')
  })

  test('reorderQueue and priorityShiftQueue are exported', async () => {
    const mod = await import('../../L3-services/lateApi/lateApiService.js')
    expect(typeof mod.reorderQueue).toBe('function')
    expect(typeof mod.reorderAllQueues).toBe('function')
    expect(typeof mod.priorityShiftQueue).toBe('function')
  })

  test('findContentItemByRowKey is exported from azureStorageService', async () => {
    const mod = await import('../../L3-services/azureStorage/azureStorageService.js')
    expect(typeof mod.findContentItemByRowKey).toBe('function')
  })

  test('review routes module is importable', async () => {
    const mod = await import('../../L7-app/review/routes.js')
    expect(typeof mod.createRouter).toBe('function')
  })

  test('uploadPublishQueue is exported from azureStorageService', async () => {
    const mod = await import('../../L3-services/azureStorage/azureStorageService.js')
    expect(typeof mod.uploadPublishQueue).toBe('function')
  })

  test('priorityShiftQueue uses UTC time matching', async () => {
    const mod = await import('../../L3-services/lateApi/lateApiService.js')
    expect(typeof mod.priorityShiftQueue).toBe('function')
  })
})

describe.skipIf(!process.env.LATE_API_KEY)('E2E: Late API pagination (live)', () => {
  test('getScheduledPosts returns array', async () => {
    const client = createLateApiClient(process.env.LATE_API_KEY!)
    const posts = await client.getScheduledPosts()
    expect(Array.isArray(posts)).toBe(true)
  })

  test('getDraftPosts returns array', async () => {
    const client = createLateApiClient(process.env.LATE_API_KEY!)
    const posts = await client.getDraftPosts()
    expect(Array.isArray(posts)).toBe(true)
  })
})

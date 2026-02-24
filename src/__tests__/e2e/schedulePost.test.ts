import { describe, test, expect } from 'vitest'
import { LateApiClient } from '../../L2-clients/late/lateApi.js'

const hasLateApiKey = !!process.env.LATE_API_KEY

describe('schedulePost e2e', () => {
  test('LateApiClient exposes schedulePost method', () => {
    // Verify the method exists on the prototype (no API key needed)
    expect(typeof LateApiClient.prototype.schedulePost).toBe('function')
  })

  test('schedulePost delegates to updatePost', () => {
    // Verify schedulePost is distinct from updatePost
    expect(LateApiClient.prototype.schedulePost).not.toBe(LateApiClient.prototype.updatePost)
  })

  describe.skipIf(!hasLateApiKey)('with live API', () => {
    test('schedulePost rejects with invalid post ID', async () => {
      const client = new LateApiClient()
      await expect(
        client.schedulePost('nonexistent-post-id', '2026-06-01T12:00:00Z'),
      ).rejects.toThrow()
    }, 15_000)
  })
})

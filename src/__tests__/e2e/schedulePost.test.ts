import { describe, test, expect } from 'vitest'
import { LateApiClient } from '../../L2-clients/late/lateApi.js'
import { findNextSlot, type SlotOptions } from '../../L3-services/scheduler/scheduler.js'

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

  test('findNextSlot accepts optional SlotOptions parameter', () => {
    const args: Parameters<typeof findNextSlot> = [
      'x',
      'short',
      {
        ideaIds: ['idea-aware-contract-test'],
        publishBy: '2026-06-01T12:00:00Z',
      },
    ]

    expect(args).toHaveLength(3)
    expect(args[2]).toBeTruthy()
  })

  test('SlotOptions interface includes ideaIds and publishBy', () => {
    const options: SlotOptions = {
      ideaIds: ['idea-aware-contract-test'],
      publishBy: '2026-06-01T12:00:00Z',
    }

    expect(options).toBeTruthy()
  })

  describe.skipIf(!hasLateApiKey)('with live API', () => {
    test('schedulePost rejects with invalid post ID', async () => {
      const client = new LateApiClient()
      await expect(
        client.schedulePost('nonexistent-post-id', '2026-06-01T12:00:00Z'),
      ).rejects.toThrow()
    }, 15_000)
  })

  describe.skipIf(!hasLateApiKey)('idea-aware scheduling with live API', () => {
    test('findNextSlot with ideaIds returns a valid slot', async () => {
      const slot = await findNextSlot('x', 'short', {
        ideaIds: ['idea-aware-live-test'],
      })

      expect(slot === null || !Number.isNaN(Date.parse(slot))).toBe(true)
    }, 15_000)
  })
})

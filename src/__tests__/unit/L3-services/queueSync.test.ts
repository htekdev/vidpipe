import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { DayOfWeek } from '../../../L3-services/scheduler/scheduleConfig.js'
import type { LateQueueSlot, LateQueue } from '../../../L2-clients/late/lateApi.js'

// Mock the L2 Late API client
const mockCreateQueue = vi.hoisted(() => vi.fn())
const mockUpdateQueue = vi.hoisted(() => vi.fn())
const mockListQueues = vi.hoisted(() => vi.fn())
const mockListProfiles = vi.hoisted(() => vi.fn())
const mockDeleteQueue = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    createQueue(...args: unknown[]) { return mockCreateQueue(...args) }
    updateQueue(...args: unknown[]) { return mockUpdateQueue(...args) }
    listQueues(...args: unknown[]) { return mockListQueues(...args) }
    listProfiles(...args: unknown[]) { return mockListProfiles(...args) }
    deleteQueue(...args: unknown[]) { return mockDeleteQueue(...args) }
  },
}))

// Mock schedule config loader (same-L3 import, but we need to control it)
const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

import { buildDesiredQueues, buildSyncPlan, executeSyncPlan, syncQueuesToLate, resolveQueueId } from '../../../L3-services/scheduler/queueSync.js'
import type { ScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'

// ── Test data ──────────────────────────────────────────────────────────

function makeConfig(platforms: ScheduleConfig['platforms']): ScheduleConfig {
  return { timezone: 'America/Chicago', platforms }
}

function makeLateQueue(overrides: Partial<LateQueue> & { _id: string; name: string }): LateQueue {
  return {
    profileId: 'profile-1',
    timezone: 'America/Chicago',
    slots: [],
    active: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('queueSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildDesiredQueues', () => {
    test('creates one queue per platform-clipType combination', () => {
      const config = makeConfig({
        x: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [
                { days: ['mon', 'tue', 'wed'] as DayOfWeek[], time: '07:00', label: 'Morning' },
              ],
              avoidDays: [],
            },
            'medium-clip': {
              slots: [
                { days: ['mon', 'fri'] as DayOfWeek[], time: '17:00', label: 'Evening' },
              ],
              avoidDays: [],
            },
          },
        },
      })

      const queues = buildDesiredQueues(config)
      expect(queues).toHaveLength(2)
      expect(queues[0].name).toBe('x-shorts')
      expect(queues[0].platform).toBe('x')
      expect(queues[0].clipType).toBe('short')
      expect(queues[1].name).toBe('x-medium-clips')
    })

    test('converts day names to Late API dayOfWeek numbers', () => {
      const config = makeConfig({
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [
                { days: ['sun', 'mon', 'sat'] as DayOfWeek[], time: '10:00', label: 'Test' },
              ],
              avoidDays: [],
            },
          },
        },
      })

      const queues = buildDesiredQueues(config)
      expect(queues[0].slots).toEqual([
        { dayOfWeek: 0, time: '10:00' },  // sun
        { dayOfWeek: 1, time: '10:00' },  // mon
        { dayOfWeek: 6, time: '10:00' },  // sat
      ])
    })

    test('sorts slots by dayOfWeek then time', () => {
      const config = makeConfig({
        x: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [
                { days: ['fri', 'mon'] as DayOfWeek[], time: '14:00', label: 'Afternoon' },
                { days: ['mon'] as DayOfWeek[], time: '07:00', label: 'Morning' },
              ],
              avoidDays: [],
            },
          },
        },
      })

      const queues = buildDesiredQueues(config)
      expect(queues[0].slots).toEqual([
        { dayOfWeek: 1, time: '07:00' },  // mon morning
        { dayOfWeek: 1, time: '14:00' },  // mon afternoon
        { dayOfWeek: 5, time: '14:00' },  // fri afternoon
      ])
    })

    test('skips clip types with empty slots', () => {
      const config = makeConfig({
        tiktok: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: { slots: [], avoidDays: [] },
            'medium-clip': {
              slots: [{ days: ['tue'] as DayOfWeek[], time: '15:00', label: 'Afternoon' }],
              avoidDays: [],
            },
          },
        },
      })

      const queues = buildDesiredQueues(config)
      expect(queues).toHaveLength(1)
      expect(queues[0].name).toBe('tiktok-medium-clips')
    })

    test('handles top-level platform slots as default clip type', () => {
      const config = makeConfig({
        linkedin: {
          slots: [
            { days: ['mon', 'wed'] as DayOfWeek[], time: '09:00', label: 'Morning' },
          ],
          avoidDays: [],
        },
      })

      const queues = buildDesiredQueues(config)
      expect(queues).toHaveLength(1)
      expect(queues[0].name).toBe('linkedin-default')
      expect(queues[0].clipType).toBe('default')
    })
  })

  describe('buildSyncPlan', () => {
    test('marks new queues as toCreate', () => {
      const desired = [
        { name: 'x-shorts', platform: 'x', clipType: 'short', slots: [{ dayOfWeek: 1, time: '07:00' }] },
      ]
      const existing: LateQueue[] = []

      const plan = buildSyncPlan(desired, existing)
      expect(plan.toCreate).toHaveLength(1)
      expect(plan.toCreate[0].name).toBe('x-shorts')
      expect(plan.toUpdate).toHaveLength(0)
      expect(plan.unchanged).toHaveLength(0)
    })

    test('marks matching queues as unchanged', () => {
      const slots: LateQueueSlot[] = [{ dayOfWeek: 1, time: '07:00' }]
      const desired = [{ name: 'x-shorts', platform: 'x', clipType: 'short', slots }]
      const existing = [makeLateQueue({ _id: 'q1', name: 'x-shorts', slots })]

      const plan = buildSyncPlan(desired, existing)
      expect(plan.unchanged).toHaveLength(1)
      expect(plan.toCreate).toHaveLength(0)
      expect(plan.toUpdate).toHaveLength(0)
    })

    test('marks queues with different slots as toUpdate', () => {
      const desired = [{ name: 'x-shorts', platform: 'x', clipType: 'short', slots: [{ dayOfWeek: 1, time: '08:00' }] }]
      const existing = [makeLateQueue({ _id: 'q1', name: 'x-shorts', slots: [{ dayOfWeek: 1, time: '07:00' }] })]

      const plan = buildSyncPlan(desired, existing)
      expect(plan.toUpdate).toHaveLength(1)
      expect(plan.toUpdate[0].queueId).toBe('q1')
    })

    test('marks extra Late queues as toDelete', () => {
      const desired: Array<{ name: string; platform: string; clipType: string; slots: LateQueueSlot[] }> = []
      const existing = [makeLateQueue({ _id: 'q1', name: 'old-queue' })]

      const plan = buildSyncPlan(desired, existing)
      expect(plan.toDelete).toHaveLength(1)
      expect(plan.toDelete[0].name).toBe('old-queue')
    })
  })

  describe('executeSyncPlan', () => {
    test('creates queues and returns mapping', async () => {
      mockCreateQueue.mockResolvedValueOnce({ _id: 'new-q1', name: 'x-shorts' })
      const { LateApiClient } = await import('../../../L2-clients/late/lateApi.js')
      const client = new LateApiClient()

      const plan = {
        toCreate: [{ name: 'x-shorts', platform: 'x', clipType: 'short', slots: [{ dayOfWeek: 1, time: '07:00' }] }],
        toUpdate: [],
        unchanged: [],
        toDelete: [],
      }

      const result = await executeSyncPlan(plan, client as any, 'profile-1', 'America/Chicago')
      expect(result.created).toBe(1)
      expect(result.mapping).toHaveLength(1)
      expect(result.mapping[0].queueId).toBe('new-q1')
      expect(mockCreateQueue).toHaveBeenCalledWith({
        profileId: 'profile-1',
        name: 'x-shorts',
        timezone: 'America/Chicago',
        slots: [{ dayOfWeek: 1, time: '07:00' }],
        active: true,
      })
    })

    test('records errors without throwing', async () => {
      mockCreateQueue.mockRejectedValueOnce(new Error('API error'))
      const { LateApiClient } = await import('../../../L2-clients/late/lateApi.js')
      const client = new LateApiClient()

      const plan = {
        toCreate: [{ name: 'fail-queue', platform: 'x', clipType: 'short', slots: [] }],
        toUpdate: [],
        unchanged: [],
        toDelete: [],
      }

      const result = await executeSyncPlan(plan, client as any, 'profile-1', 'America/Chicago')
      expect(result.created).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toContain('API error')
    })
  })

  describe('resolveQueueId', () => {
    test('returns profileId and queueId for matching queue', async () => {
      mockListProfiles.mockResolvedValueOnce([{ _id: 'profile-1', name: 'Default' }])
      mockListQueues.mockResolvedValueOnce([
        makeLateQueue({ _id: 'q-x-shorts', name: 'x-shorts' }),
        makeLateQueue({ _id: 'q-x-medium', name: 'x-medium-clips' }),
      ])

      const result = await resolveQueueId('x', 'short')
      expect(result).toEqual({ profileId: 'profile-1', queueId: 'q-x-shorts' })
    })

    test('returns null when no profiles exist', async () => {
      mockListProfiles.mockResolvedValueOnce([])
      const result = await resolveQueueId('x', 'short')
      expect(result).toBeNull()
    })

    test('returns null when queue not found', async () => {
      mockListProfiles.mockResolvedValueOnce([{ _id: 'profile-1', name: 'Default' }])
      mockListQueues.mockResolvedValueOnce([])

      const result = await resolveQueueId('x', 'short')
      expect(result).toBeNull()
    })
  })

  describe('syncQueuesToLate', () => {
    test('dry run returns plan without executing', async () => {
      mockLoadScheduleConfig.mockResolvedValueOnce(makeConfig({
        x: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [{ days: ['mon'] as DayOfWeek[], time: '07:00', label: 'Morning' }],
              avoidDays: [],
            },
          },
        },
      }))
      mockListProfiles.mockResolvedValueOnce([{ _id: 'profile-1', name: 'Default' }])
      mockListQueues.mockResolvedValueOnce([])

      const { plan, result } = await syncQueuesToLate({ dryRun: true })
      expect(plan.toCreate).toHaveLength(1)
      expect(result).toBeUndefined()
      expect(mockCreateQueue).not.toHaveBeenCalled()
    })
  })
})

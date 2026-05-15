import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import type { ScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'

// ── Hoisted mock variables ─────────────────────────────────────────────

const mockListProfiles = vi.hoisted(() => vi.fn())
const mockListQueues = vi.hoisted(() => vi.fn())
const mockCreateQueue = vi.hoisted(() => vi.fn())
const mockUpdateQueue = vi.hoisted(() => vi.fn())
const mockDeleteQueue = vi.hoisted(() => vi.fn())
const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
const mockRefreshQueueMappings = vi.hoisted(() => vi.fn())

// ── L2 mock: Late API client ───────────────────────────────────────────

vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.listProfiles = mockListProfiles
    this.listQueues = mockListQueues
    this.createQueue = mockCreateQueue
    this.updateQueue = mockUpdateQueue
    this.deleteQueue = mockDeleteQueue
  }),
}))

// ── L3 sibling mock: schedule config ───────────────────────────────────

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  refreshQueueMappings: mockRefreshQueueMappings,
}))

// ── Import under test ──────────────────────────────────────────────────

import { syncQueuesToLate } from '../../../L3-services/queueSync/queueSync.js'

// ── Test fixtures ──────────────────────────────────────────────────────

const PROFILE_ID = 'profile-123'
const DEFAULT_PROFILE = { _id: PROFILE_ID, name: 'Test Profile' }

function makeConfig(overrides?: Partial<ScheduleConfig>): ScheduleConfig {
  return {
    timezone: 'America/Chicago',
    platforms: {
      linkedin: {
        slots: [],
        avoidDays: ['sat' as const, 'sun' as const],
        byClipType: {
          short: {
            slots: [
              { days: ['mon' as const, 'tue' as const, 'wed' as const, 'thu' as const, 'fri' as const], time: '12:00', label: 'Lunch' },
            ],
            avoidDays: [],
          },
        },
      },
    },
    ...overrides,
  }
}

/** The expected slots for linkedin-short from the default config */
const LINKEDIN_SHORT_SLOTS = [
  { dayOfWeek: 1, time: '12:00' },
  { dayOfWeek: 2, time: '12:00' },
  { dayOfWeek: 3, time: '12:00' },
  { dayOfWeek: 4, time: '12:00' },
  { dayOfWeek: 5, time: '12:00' },
]

function setupDefaults() {
  mockLoadScheduleConfig.mockResolvedValue(makeConfig())
  mockListProfiles.mockResolvedValue([DEFAULT_PROFILE])
  mockListQueues.mockResolvedValue({ queues: [], count: 0 })
  mockCreateQueue.mockResolvedValue({ success: true, schedule: { _id: 'new-q', profileId: PROFILE_ID, name: 'linkedin-short', timezone: 'America/Chicago', slots: LINKEDIN_SHORT_SLOTS, active: true, isDefault: false } })
  mockUpdateQueue.mockResolvedValue({ success: true, schedule: { _id: 'q-1', name: 'linkedin-short', slots: LINKEDIN_SHORT_SLOTS } })
  mockDeleteQueue.mockResolvedValue({ success: true })
  mockRefreshQueueMappings.mockResolvedValue({})
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('syncQueuesToLate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setupDefaults()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── 1. Creates new queues ────────────────────────────────────────────

  test('creates new queues when none exist in Late', async () => {
    const result = await syncQueuesToLate()

    expect(mockCreateQueue).toHaveBeenCalledOnce()
    expect(mockCreateQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: PROFILE_ID,
        name: 'linkedin-short',
        timezone: 'America/Chicago',
        slots: expect.arrayContaining([
          { dayOfWeek: 1, time: '12:00' },
          { dayOfWeek: 5, time: '12:00' },
        ]),
        active: true,
      }),
    )
    expect(result.created).toContain('linkedin-short')
    expect(result.updated).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  // ── 2. Updates existing queues ───────────────────────────────────────

  test('updates existing queue when slots differ', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'q-1',
        name: 'linkedin-short',
        slots: [{ dayOfWeek: 1, time: '09:00' }],
        active: true,
      }],
      count: 1,
    })

    const result = await syncQueuesToLate()

    expect(mockUpdateQueue).toHaveBeenCalledOnce()
    expect(mockUpdateQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: PROFILE_ID,
        queueId: 'q-1',
        name: 'linkedin-short',
        timezone: 'America/Chicago',
        reshuffleExisting: false,
      }),
    )
    expect(result.updated).toContain('linkedin-short')
    expect(result.created).toHaveLength(0)
  })

  // ── 3. Skips unchanged queues ────────────────────────────────────────

  test('skips queue when slots match exactly', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'q-1',
        name: 'linkedin-short',
        slots: LINKEDIN_SHORT_SLOTS,
        active: true,
      }],
      count: 1,
    })

    const result = await syncQueuesToLate()

    expect(mockCreateQueue).not.toHaveBeenCalled()
    expect(mockUpdateQueue).not.toHaveBeenCalled()
    expect(result.unchanged).toContain('linkedin-short')
  })

  // ── 4. reshuffleExisting flag ────────────────────────────────────────

  test('passes reshuffleExisting flag to updateQueue', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'q-1',
        name: 'linkedin-short',
        slots: [{ dayOfWeek: 0, time: '08:00' }],
        active: true,
      }],
      count: 1,
    })

    await syncQueuesToLate({ reshuffle: true })

    expect(mockUpdateQueue).toHaveBeenCalledWith(
      expect.objectContaining({ reshuffleExisting: true }),
    )
  })

  // ── 5. dryRun mode ──────────────────────────────────────────────────

  test('dryRun logs but does not call API mutators', async () => {
    const result = await syncQueuesToLate({ dryRun: true })

    expect(result.created).toContain('linkedin-short')
    expect(mockCreateQueue).not.toHaveBeenCalled()
    expect(mockUpdateQueue).not.toHaveBeenCalled()
    expect(mockDeleteQueue).not.toHaveBeenCalled()
  })

  test('dryRun reports updates without calling updateQueue', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'q-1',
        name: 'linkedin-short',
        slots: [{ dayOfWeek: 0, time: '08:00' }],
        active: true,
      }],
      count: 1,
    })

    const result = await syncQueuesToLate({ dryRun: true })

    expect(result.updated).toContain('linkedin-short')
    expect(mockUpdateQueue).not.toHaveBeenCalled()
  })

  test('dryRun reports deletes without calling deleteQueue', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'orphan-1',
        name: 'orphan-queue',
        slots: [{ dayOfWeek: 1, time: '10:00' }],
        active: true,
      }],
      count: 1,
    })

    const result = await syncQueuesToLate({ dryRun: true, deleteOrphans: true })

    expect(result.deleted).toContain('orphan-queue')
    expect(mockDeleteQueue).not.toHaveBeenCalled()
  })

  // ── 6. deleteOrphans ─────────────────────────────────────────────────

  test('deletes orphan queues that exist in Late but not in schedule', async () => {
    mockListQueues.mockResolvedValue({
      queues: [
        { _id: 'q-1', name: 'linkedin-short', slots: LINKEDIN_SHORT_SLOTS, active: true },
        { _id: 'orphan-1', name: 'old-queue', slots: [{ dayOfWeek: 0, time: '10:00' }], active: true },
      ],
      count: 2,
    })

    const result = await syncQueuesToLate({ deleteOrphans: true })

    expect(mockDeleteQueue).toHaveBeenCalledOnce()
    expect(mockDeleteQueue).toHaveBeenCalledWith(PROFILE_ID, 'orphan-1')
    expect(result.deleted).toContain('old-queue')
    expect(result.unchanged).toContain('linkedin-short')
  })

  test('does not delete orphans when deleteOrphans is false', async () => {
    mockListQueues.mockResolvedValue({
      queues: [
        { _id: 'orphan-1', name: 'old-queue', slots: [{ dayOfWeek: 0, time: '10:00' }], active: true },
      ],
      count: 1,
    })

    const result = await syncQueuesToLate({ deleteOrphans: false })

    expect(mockDeleteQueue).not.toHaveBeenCalled()
    expect(result.deleted).toHaveLength(0)
  })

  // ── 7. Day mapping ──────────────────────────────────────────────────

  test('maps day abbreviations to correct dayOfWeek numbers', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeConfig({
      platforms: {
        linkedin: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [
                { days: ['sun' as const], time: '10:00', label: 'Sunday' },
                { days: ['mon' as const], time: '10:00', label: 'Monday' },
                { days: ['tue' as const], time: '10:00', label: 'Tuesday' },
                { days: ['wed' as const], time: '10:00', label: 'Wednesday' },
                { days: ['thu' as const], time: '10:00', label: 'Thursday' },
                { days: ['fri' as const], time: '10:00', label: 'Friday' },
                { days: ['sat' as const], time: '10:00', label: 'Saturday' },
              ],
              avoidDays: [],
            },
          },
        },
      },
    }))

    await syncQueuesToLate()

    const createCallSlots = mockCreateQueue.mock.calls[0][0].slots as Array<{ dayOfWeek: number; time: string }>
    const dayNumbers = createCallSlots.map((s: { dayOfWeek: number }) => s.dayOfWeek).sort((a: number, b: number) => a - b)
    expect(dayNumbers).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  // ── 8. Platform normalization ────────────────────────────────────────

  test('normalizes twitter to x in queue names', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeConfig({
      platforms: {
        twitter: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [{ days: ['mon' as const], time: '08:30', label: 'Morning' }],
              avoidDays: [],
            },
          },
        },
      },
    }))

    const result = await syncQueuesToLate()

    expect(mockCreateQueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'x-short' }),
    )
    expect(result.created).toContain('x-short')
  })

  // ── 9. Error handling ────────────────────────────────────────────────

  test('records error in result when createQueue fails', async () => {
    mockCreateQueue.mockRejectedValue(new Error('API rate limit'))

    const result = await syncQueuesToLate()

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      queueName: 'linkedin-short',
      error: 'API rate limit',
    })
    expect(result.created).toHaveLength(0)
  })

  test('records error in result when updateQueue fails', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'q-1',
        name: 'linkedin-short',
        slots: [{ dayOfWeek: 0, time: '08:00' }],
        active: true,
      }],
      count: 1,
    })
    mockUpdateQueue.mockRejectedValue(new Error('Server error'))

    const result = await syncQueuesToLate()

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      queueName: 'linkedin-short',
      error: 'Server error',
    })
    expect(result.updated).toHaveLength(0)
  })

  test('records error in result when deleteQueue fails', async () => {
    mockListQueues.mockResolvedValue({
      queues: [{
        _id: 'orphan-1',
        name: 'orphan-queue',
        slots: [{ dayOfWeek: 1, time: '10:00' }],
        active: true,
      }],
      count: 1,
    })
    mockDeleteQueue.mockRejectedValue(new Error('Not found'))

    const result = await syncQueuesToLate({ deleteOrphans: true })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      queueName: 'orphan-queue',
      error: 'Not found',
    })
  })

  test('throws when no Late profiles exist', async () => {
    mockListProfiles.mockResolvedValue([])

    await expect(syncQueuesToLate()).rejects.toThrow('No Late API profiles found')
  })

  // ── Multiple clip types generate separate queues ─────────────────────

  test('creates one queue per platform×clipType combination', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeConfig({
      platforms: {
        linkedin: {
          slots: [],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [{ days: ['mon' as const], time: '12:00', label: 'Lunch short' }],
              avoidDays: [],
            },
            medium: {
              slots: [{ days: ['wed' as const], time: '14:00', label: 'Afternoon medium' }],
              avoidDays: [],
            },
          },
        },
      },
    }))

    const result = await syncQueuesToLate()

    expect(mockCreateQueue).toHaveBeenCalledTimes(2)
    const names = mockCreateQueue.mock.calls.map((c: unknown[]) => (c[0] as { name: string }).name)
    expect(names).toContain('linkedin-short')
    expect(names).toContain('linkedin-medium')
    expect(result.created).toHaveLength(2)
  })

  test('normalizes medium-clip to medium in queue names', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeConfig({
      platforms: {
        youtube: {
          slots: [],
          avoidDays: [],
          byClipType: {
            'medium-clip': {
              slots: [{ days: ['tue' as const], time: '15:00', label: 'Afternoon' }],
              avoidDays: [],
            },
          },
        },
      },
    }))

    const result = await syncQueuesToLate()

    expect(mockCreateQueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'youtube-medium' }),
    )
    expect(result.created).toContain('youtube-medium')
  })

  // ── Platforms without byClipType are skipped ─────────────────────────

  // ── Cache refresh after sync ─────────────────────────────────────────

  test('calls refreshQueueMappings after non-dry-run sync', async () => {
    const result = await syncQueuesToLate()

    expect(result.created).toContain('linkedin-short')
    expect(mockRefreshQueueMappings).toHaveBeenCalledOnce()
  })

  test('does not call refreshQueueMappings after dry-run sync', async () => {
    await syncQueuesToLate({ dryRun: true })

    expect(mockRefreshQueueMappings).not.toHaveBeenCalled()
  })

  // ── Platforms without byClipType are skipped ─────────────────────────

  test('skips platforms that have no byClipType', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeConfig({
      platforms: {
        linkedin: {
          slots: [{ days: ['mon' as const], time: '08:00', label: 'Morning' }],
          avoidDays: [],
        },
      },
    }))

    const result = await syncQueuesToLate()

    expect(mockCreateQueue).not.toHaveBeenCalled()
    expect(result.created).toHaveLength(0)
    expect(result.unchanged).toHaveLength(0)
  })
})

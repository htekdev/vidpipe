/**
 * L3 Integration Test — queueSync service
 *
 * Mock boundary: L1 only (config)
 * Real code:     L2 (types) + L3 queueSync pure logic
 *
 * Tests the pure functions (buildDesiredQueues, buildSyncPlan) that don't
 * call the Late API. API-dependent tests live in integration/L4-L6.
 */
import { vi, describe, test, expect } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-queue-sync-key' }),
}))

// ── Import after mocks (pure functions only — no API calls) ──────────

import { buildDesiredQueues, buildSyncPlan } from '../../../L3-services/scheduler/queueSync.js'
import type { ScheduleConfig } from '../../../L3-services/scheduler/scheduleConfig.js'
import type { LateQueue, LateQueueSlot } from '../../../L2-clients/late/lateApi.js'

// ── Test data ────────────────────────────────────────────────────────

const testConfig: ScheduleConfig = {
  timezone: 'America/Chicago',
  platforms: {
    youtube: {
      slots: [],
      avoidDays: [],
      byClipType: {
        short: {
          slots: [{ days: ['mon', 'wed', 'fri'], time: '18:00', label: 'YT Shorts' }],
          avoidDays: [],
        },
      },
    },
    tiktok: {
      slots: [{ days: ['tue', 'thu'], time: '19:00', label: 'TikTok' }],
      avoidDays: [],
    },
  },
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

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: queueSync pure logic', () => {
  test('buildDesiredQueues creates queues from byClipType config', () => {
    const queues = buildDesiredQueues(testConfig)

    expect(queues).toHaveLength(2)

    const ytShorts = queues.find(q => q.platform === 'youtube' && q.clipType === 'short')
    expect(ytShorts).toBeDefined()
    expect(ytShorts!.name).toBe('youtube-shorts')
    expect(ytShorts!.slots).toHaveLength(3) // mon, wed, fri

    const tiktokDefault = queues.find(q => q.platform === 'tiktok')
    expect(tiktokDefault).toBeDefined()
    expect(tiktokDefault!.name).toBe('tiktok-default')
    expect(tiktokDefault!.slots).toHaveLength(2) // tue, thu
  })

  test('buildDesiredQueues maps days correctly to Late API dayOfWeek numbers', () => {
    const queues = buildDesiredQueues(testConfig)
    const ytShorts = queues.find(q => q.name === 'youtube-shorts')!

    expect(ytShorts.slots).toEqual([
      { dayOfWeek: 1, time: '18:00' },  // mon
      { dayOfWeek: 3, time: '18:00' },  // wed
      { dayOfWeek: 5, time: '18:00' },  // fri
    ])
  })

  test('buildSyncPlan detects new, changed, unchanged, and extra queues', () => {
    const desired = buildDesiredQueues(testConfig)
    const existing: LateQueue[] = [
      // youtube-shorts exists but with different slots
      makeLateQueue({ _id: 'q1', name: 'youtube-shorts', slots: [{ dayOfWeek: 1, time: '09:00' }] }),
      // orphaned queue not in schedule.json
      makeLateQueue({ _id: 'q-old', name: 'old-queue' }),
    ]

    const plan = buildSyncPlan(desired, existing)

    expect(plan.toCreate).toHaveLength(1)  // tiktok-default is new
    expect(plan.toCreate[0].name).toBe('tiktok-default')

    expect(plan.toUpdate).toHaveLength(1)  // youtube-shorts has changed slots
    expect(plan.toUpdate[0].queueId).toBe('q1')

    expect(plan.toDelete).toHaveLength(1)  // old-queue not in desired
    expect(plan.toDelete[0].name).toBe('old-queue')
  })

  test('buildSyncPlan marks queues with identical slots as unchanged', () => {
    const slots: LateQueueSlot[] = [
      { dayOfWeek: 1, time: '18:00' },
      { dayOfWeek: 3, time: '18:00' },
      { dayOfWeek: 5, time: '18:00' },
    ]
    const desired = [{ name: 'youtube-shorts', platform: 'youtube', clipType: 'short', slots }]
    const existing = [makeLateQueue({ _id: 'q1', name: 'youtube-shorts', slots })]

    const plan = buildSyncPlan(desired, existing)
    expect(plan.unchanged).toHaveLength(1)
    expect(plan.toCreate).toHaveLength(0)
    expect(plan.toUpdate).toHaveLength(0)
  })
})

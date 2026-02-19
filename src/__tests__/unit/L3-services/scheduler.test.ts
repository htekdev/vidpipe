import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v) => String(v)),
}))

// Mock scheduleConfig
let lastMockConfig: Record<string, unknown> | null = null
const mockLoadScheduleConfig = vi.fn()
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: async (...args: unknown[]) => {
    const config = await mockLoadScheduleConfig(...args)
    lastMockConfig = config
    return config
  },
  getPlatformSchedule: (platform: string, clipType?: string) => {
    if (!lastMockConfig?.platforms) return null
    const platforms = lastMockConfig.platforms as Record<string, any>
    const schedule = platforms[platform] ?? null
    if (!schedule) return null
    if (clipType && schedule.byClipType?.[clipType]) {
      const sub = schedule.byClipType[clipType]
      return { slots: sub.slots, avoidDays: sub.avoidDays }
    }
    return schedule
  },
  clearScheduleCache: vi.fn(),
}))

// Mock postStore
const mockGetPublishedItems = vi.fn()
vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getPublishedItems: () => mockGetPublishedItems(),
}))

// Mock LateApiClient
const mockGetScheduledPosts = vi.fn()
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    getScheduledPosts(...args: unknown[]) { return mockGetScheduledPosts(...args) }
  },
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-key' }),
}))

import { findNextSlot, getScheduleCalendar } from '../../../L3-services/scheduler/scheduler.js'

// ── Helpers ────────────────────────────────────────────────────────────

function makeScheduleConfig(overrides: Record<string, unknown> = {}) {
  return {
    timezone: 'UTC',
    platforms: {
      twitter: {
        slots: [
          { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '08:30', label: 'Morning' },
          { days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '17:00', label: 'Evening' },
        ],
        avoidDays: [] as string[],
        ...overrides,
      },
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastMockConfig = null
    mockGetPublishedItems.mockResolvedValue([])
    mockGetScheduledPosts.mockResolvedValue([])
  })

  it('returns next available slot matching config', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
    // Should be an ISO datetime string
    expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    // Time should be either 08:30 or 17:00
    expect(slot).toMatch(/T(08:30|17:00):00/)
  })

  it('skips avoidDays', async () => {
    // Avoid all weekdays — only sat/sun remain, but no slots on weekends
    mockLoadScheduleConfig.mockResolvedValue(
      makeScheduleConfig({
        avoidDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
      }),
    )

    const slot = await findNextSlot('twitter')
    // No slots configured for sat/sun, so should be null
    expect(slot).toBeNull()
  })

  it('finds first available slot regardless of configuration', async () => {
    // Since maxPerDay was removed, the first available slot is always returned
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
    // Should pick first available time
    expect(slot).toMatch(/T(08:30|17:00):00/)
  })

  it('skips already-booked slots', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    // First call with no booked slots — note the returned slot
    const firstSlot = await findNextSlot('twitter')
    expect(firstSlot).toBeTruthy()

    // Now book that exact slot
    vi.clearAllMocks()
    mockGetPublishedItems.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'existing-1',
        content: 'booked',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'acct-1' }],
        scheduledFor: firstSlot,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const secondSlot = await findNextSlot('twitter')
    expect(secondSlot).toBeTruthy()
    // The second slot should be different from the first (booked) one
    expect(secondSlot).not.toBe(firstSlot)
  })

  it('returns null when no slots within 14 days', async () => {
    // Config with no slots at all
    mockLoadScheduleConfig.mockResolvedValue({
      timezone: 'UTC',
      platforms: {
        twitter: {
          slots: [],
          avoidDays: [],
        },
      },
    })

    const slot = await findNextSlot('twitter')
    expect(slot).toBeNull()
  })

  it('returns null for unconfigured platform', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    const slot = await findNextSlot('nonexistent-platform')
    expect(slot).toBeNull()
  })

  it('works when Late API is unreachable (falls back to local data)', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetScheduledPosts.mockRejectedValue(new Error('Network error'))

    const slot = await findNextSlot('twitter')
    // Should still find a slot using local data only
    expect(slot).toBeTruthy()
  })

  it('does not count evening CST post on next UTC day (timezone bug)', async () => {
    // Pin to Monday so Tue and Wed are consecutive available days
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T12:00:00Z'))

    // Config: tiktok at 19:00 CST (Tue-Thu)
    // A post at Tue 19:00 CST = Wed 01:00 UTC.
    // Slot finding should be timezone-aware.
    const config = {
      timezone: 'America/Chicago',
      platforms: {
        tiktok: {
          slots: [
            { days: ['tue', 'wed', 'thu'], time: '19:00', label: 'Evening' },
          ],
          avoidDays: [] as string[],
        },
      },
    }
    mockLoadScheduleConfig.mockResolvedValue(config)

    // Simulate: one post already booked on the first available Tuesday at 19:00 CST
    const firstSlot = await findNextSlot('tiktok')
    expect(firstSlot).toBeTruthy()
    expect(firstSlot).toMatch(/T19:00:00-06:00/)

    // Now mark that slot as booked and request next slot
    vi.clearAllMocks()
    mockGetPublishedItems.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue(config)
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'existing-tue',
        content: 'Tuesday post',
        status: 'scheduled',
        platforms: [{ platform: 'tiktok', accountId: 'acct-tt' }],
        scheduledFor: firstSlot,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const secondSlot = await findNextSlot('tiktok')
    expect(secondSlot).toBeTruthy()

    // The next slot should be the NEXT day (Wed or Thu), not skip a day
    // Parse both dates and verify they're consecutive available days
    const firstDate = new Date(firstSlot!)
    const secondDate = new Date(secondSlot!)
    const dayDiffMs = secondDate.getTime() - firstDate.getTime()
    const dayDiffDays = Math.round(dayDiffMs / (24 * 60 * 60 * 1000))

    // Should be 1 day apart (consecutive), not 2+ (skipping)
    expect(dayDiffDays).toBe(1)
    expect(secondSlot).toMatch(/T19:00:00/)

    vi.useRealTimers()
  })

  it('returns Thursday 20:00 before Friday 15:00 (slot ordering by date)', async () => {
    // Pin "now" to Wednesday 2025-06-11 12:00 UTC so Thu and Fri are both in lookahead
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-11T12:00:00Z'))

    const config = {
      timezone: 'UTC',
      platforms: {
        youtube: {
          slots: [
            { days: ['fri'], time: '15:00', label: 'Afternoon' },
            { days: ['thu', 'fri'], time: '20:00', label: 'Evening' },
          ],
          avoidDays: ['mon'] as string[],
        },
      },
    }
    mockLoadScheduleConfig.mockResolvedValue(config)

    const slot = await findNextSlot('youtube')
    expect(slot).toBeTruthy()
    // Thursday 2025-06-12 at 20:00 must come before Friday 2025-06-13 at 15:00
    expect(slot).toContain('2025-06-12')
    expect(slot).toMatch(/T20:00:00/)

    vi.useRealTimers()
  })

  it('handles Late API returning non-Error rejection', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetScheduledPosts.mockRejectedValue('string error')

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
  })

  it('skips Late posts without scheduledFor', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetScheduledPosts.mockResolvedValue([
      { _id: 'no-schedule', content: 'test', status: 'draft', platforms: [{ platform: 'twitter', accountId: 'acct-1' }], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' },
    ])

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
  })

  it('skips published items without scheduledFor', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetPublishedItems.mockResolvedValue([
      { id: 'item-1', metadata: { platform: 'twitter' } },
    ])

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
  })

  it('filters booked slots by platform', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    const firstSlot = await findNextSlot('twitter')
    expect(firstSlot).toBeTruthy()

    // Book that slot on a DIFFERENT platform — should not affect twitter
    vi.clearAllMocks()
    mockGetPublishedItems.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'other-platform',
        content: 'booked',
        status: 'scheduled',
        platforms: [{ platform: 'instagram', accountId: 'acct-2' }],
        scheduledFor: firstSlot,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const sameSlot = await findNextSlot('twitter')
    expect(sameSlot).toBe(firstSlot)
  })

  it('picks from correct clip-type sub-schedule', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T12:00:00Z')) // Monday

    mockLoadScheduleConfig.mockResolvedValue({
      timezone: 'UTC',
      platforms: {
        linkedin: {
          slots: [{ days: ['tue'], time: '08:00', label: 'Default morning' }],
          avoidDays: [],
          byClipType: {
            short: {
              slots: [{ days: ['tue'], time: '15:00', label: 'Afternoon shorts' }],
              avoidDays: [],
            },
            video: {
              slots: [{ days: ['tue'], time: '09:00', label: 'Morning video' }],
              avoidDays: [],
            },
          },
        },
      },
    })

    const slot = await findNextSlot('linkedin', 'short')
    expect(slot).toBeTruthy()
    expect(slot).toMatch(/T15:00:00/)

    vi.useRealTimers()
  })

  it('findNextSlot without clipType falls back to legacy schedule', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
    expect(slot).toMatch(/T(08:30|17:00):00/)
  })

  it('collision detection works across clip types', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T12:00:00Z')) // Monday

    const config = {
      timezone: 'UTC',
      platforms: {
        linkedin: {
          slots: [],
          avoidDays: [] as string[],
          byClipType: {
            short: {
              slots: [{ days: ['tue'], time: '09:00', label: 'Short morning' }],
              avoidDays: [],
            },
            video: {
              slots: [{ days: ['tue'], time: '09:00', label: 'Video morning' }],
              avoidDays: [],
            },
          },
        },
      },
    }
    mockLoadScheduleConfig.mockResolvedValue(config)

    // Book the 09:00 slot via short
    const firstSlot = await findNextSlot('linkedin', 'short')
    expect(firstSlot).toBeTruthy()
    expect(firstSlot).toMatch(/T09:00:00/)

    // Now mark that slot as booked — video should not get the same slot
    vi.clearAllMocks()
    mockGetPublishedItems.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue(config)
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'booked-short',
        content: 'short clip',
        status: 'scheduled',
        platforms: [{ platform: 'linkedin', accountId: 'acct-1' }],
        scheduledFor: firstSlot,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const videoSlot = await findNextSlot('linkedin', 'video')
    expect(videoSlot).toBeTruthy()
    // Booked slot at 09:00 blocks both clip types on that datetime
    expect(videoSlot).not.toBe(firstSlot)

    vi.useRealTimers()
  })

  it('shorts do not get scheduled in video-only slots', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-09T12:00:00Z')) // Monday

    mockLoadScheduleConfig.mockResolvedValue({
      timezone: 'UTC',
      platforms: {
        linkedin: {
          slots: [],
          avoidDays: [] as string[],
          byClipType: {
            video: {
              slots: [{ days: ['tue'], time: '09:00', label: 'Video morning' }],
              avoidDays: [],
            },
            short: {
              slots: [{ days: ['tue'], time: '15:00', label: 'Short afternoon' }],
              avoidDays: [],
            },
          },
        },
      },
    })

    const slot = await findNextSlot('linkedin', 'short')
    expect(slot).toBeTruthy()
    // Must pick the short-specific 15:00 slot, NOT the video-only 09:00 slot
    expect(slot).toMatch(/T15:00:00/)
    expect(slot).not.toMatch(/T09:00:00/)

    vi.useRealTimers()
  })
})

describe('getScheduleCalendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    lastMockConfig = null
    mockGetPublishedItems.mockResolvedValue([])
    mockGetScheduledPosts.mockResolvedValue([])
  })

  it('returns empty array when no booked slots', async () => {
    const calendar = await getScheduleCalendar()
    expect(calendar).toEqual([])
  })

  it('returns booked slots sorted by datetime', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'post-2',
        content: 'second',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-06-15T17:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        _id: 'post-1',
        content: 'first',
        status: 'scheduled',
        platforms: [{ platform: 'tiktok', accountId: 'a2' }],
        scheduledFor: '2025-06-14T08:30:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const calendar = await getScheduleCalendar()
    expect(calendar).toHaveLength(2)
    expect(calendar[0].platform).toBe('tiktok')
    expect(calendar[1].platform).toBe('twitter')
  })

  it('filters by startDate', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'old',
        content: 'old',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-01-01T08:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        _id: 'new',
        content: 'new',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-12-01T08:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const calendar = await getScheduleCalendar(new Date('2025-06-01'))
    expect(calendar).toHaveLength(1)
    expect(calendar[0].postId).toBe('new')
  })

  it('filters by endDate', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'early',
        content: 'early',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-01-01T08:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        _id: 'late',
        content: 'late',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-12-01T08:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const calendar = await getScheduleCalendar(undefined, new Date('2025-06-01'))
    expect(calendar).toHaveLength(1)
    expect(calendar[0].postId).toBe('early')
  })

  it('excludes draft posts from Late API', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'draft-1',
        content: 'draft post',
        status: 'draft',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-06-15T08:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
      {
        _id: 'scheduled-1',
        content: 'scheduled post',
        status: 'scheduled',
        platforms: [{ platform: 'twitter', accountId: 'a1' }],
        scheduledFor: '2025-06-15T17:00:00+00:00',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ])

    const calendar = await getScheduleCalendar()
    expect(calendar).toHaveLength(1)
    expect(calendar[0].postId).toBe('scheduled-1')
  })

  it('includes local published items with scheduledFor', async () => {
    mockGetPublishedItems.mockResolvedValue([
      {
        id: 'local-1',
        metadata: { platform: 'tiktok', scheduledFor: '2025-06-15T10:00:00+00:00' },
      },
    ])

    const calendar = await getScheduleCalendar()
    expect(calendar).toHaveLength(1)
    expect(calendar[0].source).toBe('local')
    expect(calendar[0].itemId).toBe('local-1')
  })
})

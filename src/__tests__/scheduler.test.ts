import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// Mock scheduleConfig
const mockLoadScheduleConfig = vi.fn()
vi.mock('../services/scheduleConfig.js', () => ({
  loadScheduleConfig: (...args: unknown[]) => mockLoadScheduleConfig(...args),
}))

// Mock postStore
const mockGetPublishedItems = vi.fn()
vi.mock('../services/postStore.js', () => ({
  getPublishedItems: () => mockGetPublishedItems(),
}))

// Mock LateApiClient
const mockGetScheduledPosts = vi.fn()
vi.mock('../services/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    getScheduledPosts(...args: unknown[]) { return mockGetScheduledPosts(...args) }
  },
}))

vi.mock('../config/environment.js', () => ({
  getConfig: () => ({ LATE_API_KEY: 'test-key' }),
}))

import { findNextSlot } from '../services/scheduler.js'

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
})

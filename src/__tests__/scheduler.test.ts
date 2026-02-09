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
        maxPerDay: 3,
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

  it('respects maxPerDay', async () => {
    // maxPerDay=1, but 2 slots per day — second slot should be skipped on busy days
    mockLoadScheduleConfig.mockResolvedValue(
      makeScheduleConfig({ maxPerDay: 1 }),
    )

    const slot = await findNextSlot('twitter')
    expect(slot).toBeTruthy()
    // Should pick first available time
    expect(slot).toMatch(/T08:30:00/)
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
          maxPerDay: 1,
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
})

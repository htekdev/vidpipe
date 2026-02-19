/**
 * L4-L6 Integration Test — scheduler service chain
 *
 * Mock boundary: L2 clients (Late API)
 * Real code:     L3 scheduler + L3 scheduleConfig + L3 postStore + L1 file I/O
 *
 * Tests that the L3 scheduler correctly finds available posting slots
 * by combining Late API booking data (mocked) with local schedule
 * config (real) and collision avoidance logic.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Mock L2 client ──────────────────────────────────────────────────

const mockGetScheduledPosts = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: vi.fn().mockImplementation(function () {
    return { getScheduledPosts: mockGetScheduledPosts }
  }),
}))

// ── Import after mocks ───────────────────────────────────────────────

import { findNextSlot, getScheduleCalendar } from '../../../L3-services/scheduler/scheduler.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

// ── Tests ─────────────────────────────────────────────────────────────

describe('L4-L6 Integration: scheduler → Late API (mocked L2)', () => {
  let tmpDir: string
  const originalRepoRoot = process.env.REPO_ROOT

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vidpipe-scheduler-'))
    process.env.REPO_ROOT = tmpDir
    initConfig({ outputDir: join(tmpDir, 'output'), lateApiKey: 'test-key' })
  })

  afterAll(async () => {
    process.env.REPO_ROOT = originalRepoRoot
    await rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
    mockGetScheduledPosts.mockResolvedValue([])
  })

  it('findNextSlot returns a datetime string for a known platform + clipType', async () => {
    const slot = await findNextSlot('linkedin', 'medium-clip')

    expect(slot).toBeTruthy()
    expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('findNextSlot returns null for an unknown platform', async () => {
    const slot = await findNextSlot('nonexistent_platform_xyz')

    expect(slot).toBeNull()
  })

  it('findNextSlot includes timezone offset', async () => {
    const slot = await findNextSlot('tiktok', 'short')

    expect(slot).toBeTruthy()
    // Timezone offset format: +HH:MM or -HH:MM
    expect(slot).toMatch(/[+-]\d{2}:\d{2}$/)
  })

  it('findNextSlot avoids already-booked slots', async () => {
    // First call: no bookings → get first available slot
    const firstSlot = await findNextSlot('linkedin', 'medium-clip')
    expect(firstSlot).toBeTruthy()

    // Second call: book the first slot via Late API mock
    clearScheduleCache()
    mockGetScheduledPosts.mockResolvedValue([{
      _id: 'post-1',
      content: 'booked post',
      status: 'scheduled',
      platforms: [{ platform: 'linkedin', accountId: 'acc1' }],
      scheduledFor: firstSlot,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }])

    const secondSlot = await findNextSlot('linkedin', 'medium-clip')
    expect(secondSlot).toBeTruthy()
    expect(secondSlot).not.toBe(firstSlot)
  })

  it('getScheduleCalendar returns booked slots from Late API', async () => {
    const bookedTime = '2026-06-15T12:00:00-06:00'
    mockGetScheduledPosts.mockResolvedValue([{
      _id: 'post-cal',
      content: 'calendar test',
      status: 'scheduled',
      platforms: [{ platform: 'linkedin', accountId: 'acc1' }],
      scheduledFor: bookedTime,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    }])

    const calendar = await getScheduleCalendar()

    expect(calendar).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          platform: 'linkedin',
          scheduledFor: bookedTime,
          source: 'late',
        }),
      ]),
    )
  })
})

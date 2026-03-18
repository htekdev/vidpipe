import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock L1 infrastructure (ESM imports verified)
vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((v: unknown) => String(v)),
}))

const mockOutputDir = vi.hoisted(() => {
  const os = require('node:os')
  const path = require('node:path')
  return path.join(os.tmpdir(), 'vidpipe-scheduler-l3-test')
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({
    OUTPUT_DIR: mockOutputDir,
    LATE_API_KEY: '',
  }),
  initConfig: vi.fn(),
}))

import {
  findNextSlot,
  getScheduleCalendar,
  rescheduleIdeaPosts,
  schedulePost,
  type SlotOptions,
  type RescheduleResult,
  type ScheduleContext,
} from '../../../L3-services/scheduler/scheduler.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'

const hasLateApiKey = !!process.env.LATE_API_KEY

describe('L3 Integration: scheduler calendar with no Late API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearScheduleCache()
  })

  it('returns empty calendar when Late API is unreachable and no local items', async () => {
    const calendar = await getScheduleCalendar()
    expect(calendar).toEqual([])
  })

  it('SlotOptions type is properly exported', () => {
    const slotOptions: SlotOptions = {
      ideaIds: ['idea-123'],
      publishBy: '2099-12-31T23:59:59Z',
    }

    expect(slotOptions).toEqual({
      ideaIds: ['idea-123'],
      publishBy: '2099-12-31T23:59:59Z',
    })
  })

  // ── rescheduleIdeaPosts (returns early — no Late API needed) ────

  describe('rescheduleIdeaPosts', () => {
    it('returns zeros when no idea-linked published items exist', async () => {
      const result = await rescheduleIdeaPosts()

      expect(result).toEqual<RescheduleResult>({
        rescheduled: 0,
        unchanged: 0,
        failed: 0,
        details: [],
      })
    })

    it('returns zeros in dry-run mode with no idea posts', async () => {
      const result = await rescheduleIdeaPosts({ dryRun: true })

      expect(result).toEqual<RescheduleResult>({
        rescheduled: 0,
        unchanged: 0,
        failed: 0,
        details: [],
      })
    })

    it('RescheduleResult type has expected shape', () => {
      const result: RescheduleResult = {
        rescheduled: 1,
        unchanged: 2,
        failed: 0,
        details: [
          {
            itemId: 'item-1',
            platform: 'tiktok',
            latePostId: 'late-1',
            oldSlot: '2026-03-01T19:00:00-06:00',
            newSlot: '2026-03-02T19:00:00-06:00',
          },
        ],
      }

      expect(result.rescheduled).toBe(1)
      expect(result.details).toHaveLength(1)
      expect(result.details[0].itemId).toBe('item-1')
      expect(result.details[0].error).toBeUndefined()
    })

    it('RescheduleResult detail supports error field', () => {
      const result: RescheduleResult = {
        rescheduled: 0,
        unchanged: 0,
        failed: 1,
        details: [
          {
            itemId: 'item-fail',
            platform: 'youtube',
            latePostId: 'late-fail',
            oldSlot: null,
            newSlot: null,
            error: 'No schedule config',
          },
        ],
      }

      expect(result.failed).toBe(1)
      expect(result.details[0].error).toBe('No schedule config')
    })
  })

  describe('schedulePost export', () => {
    it('schedulePost is exported and callable', () => {
      expect(typeof schedulePost).toBe('function')
    })

    it('ScheduleContext type is properly exported', () => {
      const ctx: ScheduleContext = {
        timezone: 'America/Chicago',
        bookedMap: new Map(),
        ideaLinkedPostIds: new Set(),
        lateClient: {} as never,
        displacementEnabled: false,
        dryRun: true,
        depth: 0,
      }

      expect(ctx.timezone).toBe('America/Chicago')
      expect(ctx.depth).toBe(0)
    })
  })

  // ── findNextSlot (no Late API needed) ───────────────────────────

  describe('findNextSlot walk-through', () => {
    it('returns null for an unknown platform', async () => {
      const slot = await findNextSlot('nonexistent-platform')
      expect(slot).toBeNull()
    })
  })

  // ── findNextSlot (requires Late API key for LateApiClient) ──────

  describe.skipIf(!hasLateApiKey)('findNextSlot with live Late API', () => {
    it('findNextSlot accepts SlotOptions with ideaIds and publishBy', async () => {
      const slot = await findNextSlot('linkedin', 'medium-clip', {
        ideaIds: ['idea-123'],
        publishBy: '2099-12-31T23:59:59Z',
      })

      expect(slot).toBeTruthy()
      expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('findNextSlot without ideaIds behaves identically to no options', async () => {
      const slotWithoutOptions = await findNextSlot('linkedin', 'medium-clip')

      clearScheduleCache()

      const slotWithoutIdeaIds = await findNextSlot('linkedin', 'medium-clip', {})

      expect(slotWithoutIdeaIds).toBe(slotWithoutOptions)
    })

    it('returns a future ISO datetime string for a known platform', async () => {
      const slot = await findNextSlot('tiktok')

      expect(slot).not.toBeNull()
      const parsed = new Date(slot!)
      expect(parsed.getTime()).toBeGreaterThan(Date.now())
    })

    it('respects publishBy deadline — returned slot is before deadline', async () => {
      const deadline = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
      const slot = await findNextSlot('linkedin', undefined, { publishBy: deadline })

      expect(slot).not.toBeNull()
      expect(new Date(slot!).getTime()).toBeLessThanOrEqual(new Date(deadline).getTime())
    })

    it('ignores already-passed publishBy and schedules normally', async () => {
      clearScheduleCache()
      const pastDeadline = '2020-01-01T00:00:00Z'
      const slot = await findNextSlot('tiktok', undefined, { publishBy: pastDeadline })

      expect(slot).not.toBeNull()
    })
  })
})

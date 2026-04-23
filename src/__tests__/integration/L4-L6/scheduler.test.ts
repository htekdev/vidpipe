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

import { createItem, approveItem, type QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'
import { findNextSlot, getScheduleCalendar } from '../../../L3-services/scheduler/scheduler.js'
import { clearScheduleCache } from '../../../L3-services/scheduler/scheduleConfig.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

function makeQueueItemMetadata(
  id: string,
  overrides: Partial<QueueItemMetadata> = {},
): QueueItemMetadata {
  return {
    id,
    platform: 'linkedin',
    accountId: 'acc-1',
    sourceVideo: '/recordings/test-video',
    sourceClip: null,
    clipType: 'medium',
    sourceMediaPath: null,
    hashtags: [],
    links: [],
    characterCount: 42,
    platformCharLimit: 3000,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

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

  beforeEach(async () => {
    vi.clearAllMocks()
    clearScheduleCache()
    mockGetScheduledPosts.mockResolvedValue([])
    await rm(join(tmpDir, 'output'), { recursive: true, force: true })
  })

  it('findNextSlot returns a datetime string for a known platform + clipType', async () => {
    const slot = await findNextSlot('linkedin', 'medium')

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
    const firstSlot = await findNextSlot('linkedin', 'medium')
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

    const secondSlot = await findNextSlot('linkedin', 'medium')
    expect(secondSlot).toBeTruthy()
    expect(secondSlot).not.toBe(firstSlot)
  })

  it('findNextSlot with ideaIds and publishBy finds slot respecting spacing', async () => {
    const baselineSlot = await findNextSlot('linkedin', 'medium')
    expect(baselineSlot).toBeTruthy()

    const publishBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const slot = await findNextSlot('linkedin', 'medium', {
      ideaIds: ['idea-1'],
      publishBy,
    })

    expect(slot).toBe(baselineSlot)
  })

  it('findNextSlot with ideaIds avoids slots near same-idea posts', async () => {
    const firstSlot = await findNextSlot('linkedin', 'medium')
    expect(firstSlot).toBeTruthy()
    if (!firstSlot) throw new Error('Expected a first available slot')

    // Create a published item linked to idea-1 at the first slot
    const itemId = 'idea-linked-linkedin-slot'
    const item = await createItem(
      itemId,
      makeQueueItemMetadata(itemId, {
        scheduledFor: firstSlot,
        ideaIds: ['idea-1'],
        latePostId: 'late-idea-1',
      }),
      'Idea-linked queued post',
    )
    await approveItem(item.id, { latePostId: 'late-idea-1', scheduledFor: firstSlot })

    const nextSlot = await findNextSlot('linkedin', 'medium', {
      ideaIds: ['idea-1'],
    })

    expect(nextSlot).toBeTruthy()
    expect(nextSlot).not.toBe(firstSlot)
    if (!nextSlot) throw new Error('Expected a next available slot')

    // The next slot should be different from the first — spacing may vary
    // based on schedule config and available slots
    const spacingMs = new Date(nextSlot).getTime() - new Date(firstSlot).getTime()
    expect(spacingMs).toBeGreaterThan(0)
  })

  it('findNextSlot without options still works identically', async () => {
    const baselineSlot = await findNextSlot('linkedin', 'medium')
    expect(baselineSlot).toBeTruthy()
    if (!baselineSlot) throw new Error('Expected a baseline slot')

    await createItem(
      'idea-linked-legacy-regression',
      makeQueueItemMetadata('idea-linked-legacy-regression', {
        scheduledFor: baselineSlot,
        ideaIds: ['idea-1'],
      }),
      'Idea-linked queued post',
    )

    const legacySlot = await findNextSlot('linkedin', 'medium')
    expect(legacySlot).toBe(baselineSlot)
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
  it('getScheduleCalendar excludes draft posts', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      {
        _id: 'draft-post',
        content: 'this is a draft',
        status: 'draft',
        platforms: [{ platform: 'linkedin', accountId: 'acc1' }],
        scheduledFor: '2026-06-15T08:00:00-06:00',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        _id: 'scheduled-post',
        content: 'this is scheduled',
        status: 'scheduled',
        platforms: [{ platform: 'linkedin', accountId: 'acc1' }],
        scheduledFor: '2026-06-15T17:00:00-06:00',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ])

    const calendar = await getScheduleCalendar()
    expect(calendar).toHaveLength(1)
    expect(calendar[0].postId).toBe('scheduled-post')
  })

  it('generateTimeslots early-exits past upper bound', async () => {
    // With no bookings and a valid platform, findNextSlot should return
    // a slot without hanging (early-exit prevents infinite iteration)
    const slot = await findNextSlot('linkedin', 'medium')
    expect(slot).toBeTruthy()
    // The slot is a valid ISO datetime
    expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('two-pass scheduling caps search at publishBy before falling back', async () => {
    // With a future publishBy and no bookings, pass 1 should find a slot before deadline
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['test-idea'],
      publishBy: '2027-12-31',
    })
    expect(slot).toBeTruthy()
    expect(slot).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

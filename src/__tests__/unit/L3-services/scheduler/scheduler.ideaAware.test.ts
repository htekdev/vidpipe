import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatePost } from '../../../../L2-clients/late/lateApi.js'
import type { QueueItem } from '../../../../L3-services/postStore/postStore.js'

interface MockTimeSlot {
  days: string[]
  time: string
  label: string
}

interface MockPlatformSchedule {
  slots: MockTimeSlot[]
  avoidDays: string[]
  byClipType?: Record<string, MockPlatformSchedule>
}

interface MockScheduleConfig {
  timezone: string
  platforms: Record<string, MockPlatformSchedule>
  ideaSpacing?: {
    samePlatformHours: number
    crossPlatformHours: number
  }
  displacement?: {
    enabled: boolean
    canDisplace: 'non-idea-only'
  }
}

type ClipType = 'video' | 'short' | 'medium-clip'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

const mockState = vi.hoisted(() => ({
  config: null as MockScheduleConfig | null,
}))

const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
const mockGetPublishedItems = vi.hoisted(() => vi.fn())
const mockGetScheduledItemsByIdeaIds = vi.hoisted(() => vi.fn())
const mockGetScheduledPosts = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())

vi.mock('../../../../L1-infra/logger/configLogger.js', () => ({
  default: mockLogger,
}))

vi.mock('../../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: async (...args: unknown[]) => {
    const config = await mockLoadScheduleConfig(...args) as MockScheduleConfig
    mockState.config = config
    return config
  },
  getPlatformSchedule: (platform: string, clipType?: string) => {
    const config = mockState.config
    if (!config) return null

    const schedule = config.platforms[platform] ?? null
    if (!schedule) return null

    if (clipType && schedule.byClipType?.[clipType]) {
      const sub = schedule.byClipType[clipType]
      return { slots: sub.slots, avoidDays: sub.avoidDays }
    }

    return { slots: schedule.slots, avoidDays: schedule.avoidDays, byClipType: schedule.byClipType }
  },
  getIdeaSpacingConfig: () =>
    mockState.config?.ideaSpacing ?? {
      samePlatformHours: 24,
      crossPlatformHours: 6,
    },
  getDisplacementConfig: () =>
    mockState.config?.displacement ?? {
      enabled: true,
      canDisplace: 'non-idea-only' as const,
    },
}))

vi.mock('../../../../L3-services/postStore/postStore.js', () => ({
  getPublishedItems: () => mockGetPublishedItems(),
  getScheduledItemsByIdeaIds: (...args: unknown[]) => mockGetScheduledItemsByIdeaIds(...args),
}))

vi.mock('../../../../L2-clients/late/lateApi.js', () => ({
  LateApiClient: class MockLateApiClient {
    getScheduledPosts(...args: unknown[]) {
      return mockGetScheduledPosts(...args)
    }

    schedulePost(...args: unknown[]) {
      return mockSchedulePost(...args)
    }
  },
}))

import { findNextSlot } from '../../../../L3-services/scheduler/scheduler.js'

function makeScheduleConfig(overrides: Partial<MockScheduleConfig> = {}): MockScheduleConfig {
  return {
    timezone: 'UTC',
    ideaSpacing: {
      samePlatformHours: 24,
      crossPlatformHours: 6,
    },
    displacement: {
      enabled: true,
      canDisplace: 'non-idea-only',
    },
    platforms: {
      tiktok: {
        slots: [
          { days: ['tue'], time: '09:00', label: 'Tuesday prime' },
          { days: ['wed'], time: '09:00', label: 'Wednesday prime' },
          { days: ['thu'], time: '09:00', label: 'Thursday prime' },
          { days: ['fri'], time: '09:00', label: 'Friday prime' },
        ],
        avoidDays: [],
      },
      instagram: {
        slots: [
          { days: ['tue'], time: '06:00', label: 'Tuesday morning' },
          { days: ['wed'], time: '06:00', label: 'Wednesday morning' },
        ],
        avoidDays: [],
      },
    },
    ...overrides,
  }
}

function makeLatePost(overrides: Partial<LatePost> = {}): LatePost {
  return {
    _id: 'late-post-1',
    content: 'Scheduled content',
    status: 'scheduled',
    platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
    scheduledFor: '2026-03-03T09:00:00+00:00',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    ...overrides,
  }
}

type QueueItemOverrides = Omit<Partial<QueueItem>, 'metadata'> & {
  metadata?: Partial<QueueItem['metadata']>
}

function makeQueueItem(overrides: QueueItemOverrides = {}): QueueItem {
  const metadataOverrides: Partial<QueueItem['metadata']> = overrides.metadata ?? {}
  return {
    id: overrides.id ?? 'queue-item-1',
    postContent: overrides.postContent ?? 'Post content',
    hasMedia: overrides.hasMedia ?? true,
    mediaPath: overrides.mediaPath ?? 'clip.mp4',
    thumbnailPath: overrides.thumbnailPath ?? null,
    folderPath: overrides.folderPath ?? 'C:\\queue\\queue-item-1',
    metadata: {
      id: metadataOverrides.id ?? overrides.id ?? 'queue-item-1',
      platform: metadataOverrides.platform ?? 'tiktok',
      accountId: metadataOverrides.accountId ?? 'acct-1',
      sourceVideo: metadataOverrides.sourceVideo ?? 'video.mp4',
      sourceClip: metadataOverrides.sourceClip ?? null,
      clipType: metadataOverrides.clipType ?? 'short',
      sourceMediaPath: metadataOverrides.sourceMediaPath ?? 'clip.mp4',
      hashtags: metadataOverrides.hashtags ?? [],
      links: metadataOverrides.links ?? [],
      characterCount: metadataOverrides.characterCount ?? 42,
      platformCharLimit: metadataOverrides.platformCharLimit ?? 280,
      suggestedSlot: metadataOverrides.suggestedSlot ?? null,
      scheduledFor: metadataOverrides.scheduledFor ?? null,
      status: metadataOverrides.status ?? 'published',
      latePostId: metadataOverrides.latePostId ?? null,
      publishedUrl: metadataOverrides.publishedUrl ?? null,
      createdAt: metadataOverrides.createdAt ?? '2026-03-01T00:00:00Z',
      reviewedAt: metadataOverrides.reviewedAt ?? null,
      publishedAt: metadataOverrides.publishedAt ?? null,
      ideaIds: metadataOverrides.ideaIds,
      textOnly: metadataOverrides.textOnly,
      mediaType: metadataOverrides.mediaType,
      platformSpecificData: metadataOverrides.platformSpecificData,
    },
  }
}

describe('scheduler idea-aware slot resolution', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-02T00:00:00Z'))
    vi.clearAllMocks()

    mockState.config = null
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig())
    mockGetPublishedItems.mockResolvedValue([])
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([])
    mockGetScheduledPosts.mockResolvedValue([])
    mockSchedulePost.mockResolvedValue(makeLatePost())
    mockGetIdea.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps non-idea scheduling behavior unchanged', async () => {
    const slot = await findNextSlot('tiktok', 'short')

    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).not.toHaveBeenCalled()
  })

  it('enforces same-platform spacing for idea-aware scheduling', async () => {
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([
      makeQueueItem({
        id: 'idea-previous',
        metadata: {
          platform: 'tiktok',
          scheduledFor: '2026-03-02T20:00:00+00:00',
          ideaIds: ['idea-1'],
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', { ideaIds: ['idea-1'] })

    // Previous idea post at 20:00 on Mar 2 — 24h same-platform spacing skips Mar 3 (13h gap)
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
    expect(mockSchedulePost).not.toHaveBeenCalled()
  })

  it('displaces the first non-idea late post when all early slots are occupied', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'late-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
      makeLatePost({ _id: 'late-2', scheduledFor: '2026-03-04T09:00:00+00:00' }),
      makeLatePost({ _id: 'late-3', scheduledFor: '2026-03-05T09:00:00+00:00' }),
    ])
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
    })

    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('late-1', '2026-03-06T09:00:00+00:00')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Displaced late-1: 2026-03-03T09:00:00+00:00 → 2026-03-06T09:00:00+00:00'),
    )
  })

  it('displaces orphaned Late posts (not idea-linked)', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'orphan-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
    ])

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-03T23:59:59+00:00',
    })

    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('orphan-1', '2026-03-04T09:00:00+00:00')
  })

  it('skips idea-linked posts and finds next empty slot', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'late-idea', scheduledFor: '2026-03-03T09:00:00+00:00' }),
    ])
    mockGetPublishedItems.mockResolvedValue([
      makeQueueItem({
        id: 'published-idea',
        metadata: {
          latePostId: 'late-idea',
          ideaIds: ['idea-existing'],
          scheduledFor: '2026-03-03T09:00:00+00:00',
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
    })

    // Idea-linked post at Mar 3 is skipped (not displaced), next empty slot is Mar 4
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
    expect(mockSchedulePost).not.toHaveBeenCalled()
  })

  it('displaces first non-idea post respecting spacing when multiple slots are occupied', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'late-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
      makeLatePost({ _id: 'late-2', scheduledFor: '2026-03-04T09:00:00+00:00' }),
    ])
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([
      makeQueueItem({
        id: 'idea-previous',
        metadata: {
          platform: 'tiktok',
          scheduledFor: '2026-03-02T20:00:00+00:00',
          ideaIds: ['idea-1'],
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
    })

    // 24h spacing blocks Mar 3 (13h from previous), displaces late-2 from Mar 4
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('late-2', '2026-03-05T09:00:00+00:00')
  })

  it('displaces earliest non-idea post when multiple taken slots exist', async () => {
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'late-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
      makeLatePost({ _id: 'late-2', scheduledFor: '2026-03-04T09:00:00+00:00' }),
    ])
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-urgent'],
    })

    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('late-1', '2026-03-05T09:00:00+00:00')
  })

  it('skips occupied slots when displacement is disabled and finds first empty slot', async () => {
    mockLoadScheduleConfig.mockResolvedValue(
      makeScheduleConfig({
        displacement: {
          enabled: false,
          canDisplace: 'non-idea-only',
        },
      }),
    )
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'late-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
      makeLatePost({ _id: 'late-2', scheduledFor: '2026-03-04T09:00:00+00:00' }),
    ])

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
    })

    // Displacement disabled — skips occupied Mar 3 and Mar 4, finds empty Mar 5
    expect(slot).toBe('2026-03-05T09:00:00+00:00')
    expect(mockSchedulePost).not.toHaveBeenCalled()
  })

  it('enforces cross-platform spacing for same-idea content', async () => {
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([
      makeQueueItem({
        id: 'idea-instagram',
        metadata: {
          platform: 'instagram',
          scheduledFor: '2026-03-03T06:00:00+00:00',
          ideaIds: ['idea-1'],
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', { ideaIds: ['idea-1'] })

    // Instagram post at 06:00 Mar 3 — 6h cross-platform spacing blocks tiktok at 09:00 (3h gap)
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
  })

  it('ignores publishBy and schedules normally when it has passed', async () => {
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-01T12:00:00+00:00',
    })

    // publishBy is no longer used as a search cap — schedules normally
    expect(slot).toBe('2026-03-03T09:00:00+00:00')
  })

  it('logs a warning when the scheduled slot is AFTER the publishBy deadline', async () => {
    // Advance time so the first available Tuesday slot (Mar 24) is after publishBy (Mar 20)
    vi.setSystemTime(new Date('2026-03-20T12:00:00Z'))

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['42'],
      publishBy: '2026-03-20',
    })

    // Mar 20 is a Friday — first Tuesday slot is Mar 24, which is AFTER publishBy
    expect(slot).toBe('2026-03-24T09:00:00+00:00')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('AFTER publishBy deadline'),
    )
  })

  it('logs info when the scheduled slot is within the publishBy deadline', async () => {
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['42'],
      publishBy: '2027-12-31',
    })

    // First available slot is Mar 3, well before Dec 2027
    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('within publishBy'),
    )
  })

  it('allows cross-platform scheduling when crossPlatformHours is 0', async () => {
    mockLoadScheduleConfig.mockResolvedValue(
      makeScheduleConfig({
        ideaSpacing: {
          samePlatformHours: 6,
          crossPlatformHours: 0,
        },
      }),
    )
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([
      makeQueueItem({
        id: 'idea-instagram',
        metadata: {
          platform: 'instagram',
          scheduledFor: '2026-03-03T06:00:00+00:00',
          ideaIds: ['idea-1'],
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', { ideaIds: ['idea-1'] })

    // crossPlatformHours=0 means no cross-platform blocking — 3h gap is fine
    expect(slot).toBe('2026-03-03T09:00:00+00:00')
  })

  it('still enforces samePlatformHours when crossPlatformHours is 0', async () => {
    mockLoadScheduleConfig.mockResolvedValue(
      makeScheduleConfig({
        ideaSpacing: {
          samePlatformHours: 6,
          crossPlatformHours: 0,
        },
      }),
    )
    mockGetScheduledItemsByIdeaIds.mockResolvedValue([
      makeQueueItem({
        id: 'idea-tiktok-earlier',
        metadata: {
          platform: 'tiktok',
          scheduledFor: '2026-03-03T05:00:00+00:00',
          ideaIds: ['idea-1'],
        },
      }),
    ])

    const slot = await findNextSlot('tiktok', 'short', { ideaIds: ['idea-1'] })

    // Same-platform 6h spacing: 05:00→09:00 is only 4h gap, blocks Mar 3
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
  })

  // ── publishBy enforcement (two-pass scheduling) ─────────────────────

  it('prefers slots BEFORE the publishBy deadline via two-pass search', async () => {
    // All Tue slots are available, but publishBy is Mar 4 (Wed)
    // Pass 1 should find Tue Mar 3 (before deadline) and stop
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-04T23:59:59+00:00',
    })

    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('within publishBy'),
    )
  })

  it('displaces non-idea post from slot before publishBy deadline', async () => {
    // Non-idea Late post occupies the only Tue slot before publishBy (Mar 3)
    // Our idea post with publishBy should displace it
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'orphan-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
    ])

    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-04T23:59:59+00:00',
    })

    // Should displace orphan-1 and take the Mar 3 slot
    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('orphan-1', expect.any(String))
  })

  it('displaces idea post with later publishBy when incumbent has no deadline', async () => {
    // Idea-linked Late post at Mar 3, no publishBy on the incumbent's idea
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'idea-post-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
    ])
    // Mark idea-post-1 as idea-linked by having a published item reference it
    mockGetPublishedItems.mockResolvedValue([
      makeQueueItem({
        id: 'qi-1',
        metadata: {
          latePostId: 'idea-post-1',
          ideaIds: ['existing-idea-99'],
          platform: 'tiktok',
          scheduledFor: '2026-03-03T09:00:00+00:00',
        },
      }),
    ])
    // Incumbent idea has no publishBy — empty map means no deadline
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-05T00:00:00+00:00',
      _ideaPublishByMap: new Map(),
    })

    // Our post has publishBy, incumbent has none → we win the slot
    expect(slot).toBe('2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('idea-post-1', expect.any(String))
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Displaced idea idea-post-1'),
    )
  })

  it('skips idea post when incumbent has sooner publishBy', async () => {
    // Idea-linked Late post at Mar 3 with publishBy Mar 4 (sooner than ours)
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'urgent-post', scheduledFor: '2026-03-03T09:00:00+00:00' }),
    ])
    mockGetPublishedItems.mockResolvedValue([
      makeQueueItem({
        id: 'qi-urgent',
        metadata: {
          latePostId: 'urgent-post',
          ideaIds: ['urgent-idea-5'],
          platform: 'tiktok',
          scheduledFor: '2026-03-03T09:00:00+00:00',
        },
      }),
    ])
    // Incumbent idea has sooner publishBy (Mar 4) via pre-built map
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['idea-1'],
      publishBy: '2026-03-10T00:00:00+00:00',
      _ideaPublishByMap: new Map([['urgent-idea-5', new Date('2026-03-04T00:00:00+00:00').getTime()]]),
    })

    // Incumbent has sooner deadline → we don't displace, take next available
    expect(slot).toBe('2026-03-04T09:00:00+00:00')
    // Should NOT have displaced the urgent post
    expect(mockSchedulePost).not.toHaveBeenCalledWith('urgent-post', expect.any(String))
  })

  it('falls back to post-deadline slot when no slots available before publishBy', async () => {
    // Fill all slots before publishBy (Mar 3 Tue and Mar 4 Wed)
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({ _id: 'idea-post-1', scheduledFor: '2026-03-03T09:00:00+00:00' }),
      makeLatePost({ _id: 'idea-post-2', scheduledFor: '2026-03-04T09:00:00+00:00', platforms: [{ platform: 'tiktok', accountId: 'acct-1' }] }),
    ])
    // Both are idea-linked with sooner deadlines
    mockGetPublishedItems.mockResolvedValue([
      makeQueueItem({
        id: 'qi-1',
        metadata: {
          latePostId: 'idea-post-1',
          ideaIds: ['sooner-idea'],
          platform: 'tiktok',
          scheduledFor: '2026-03-03T09:00:00+00:00',
        },
      }),
      makeQueueItem({
        id: 'qi-2',
        metadata: {
          latePostId: 'idea-post-2',
          ideaIds: ['sooner-idea-2'],
          platform: 'tiktok',
          scheduledFor: '2026-03-04T09:00:00+00:00',
        },
      }),
    ])
    // Both incumbents have sooner deadlines (Mar 3) than ours (Mar 5)
    const slot = await findNextSlot('tiktok', 'short', {
      ideaIds: ['my-idea'],
      publishBy: '2026-03-05T00:00:00+00:00',
      _ideaPublishByMap: new Map([
        ['sooner-idea', new Date('2026-03-03T00:00:00+00:00').getTime()],
        ['sooner-idea-2', new Date('2026-03-03T00:00:00+00:00').getTime()],
      ]),
    })

    // All slots before deadline are taken by posts with sooner deadlines
    // Pass 2 fallback: find first available after deadline
    expect(slot).toBe('2026-03-05T09:00:00+00:00')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No slot for tiktok/short before publishBy'),
    )
  })
})

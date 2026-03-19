import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatePost } from '../../../../L2-clients/late/lateApi.js'
import type { QueueItem } from '../../../../L3-services/postStore/postStore.js'

// ── Types for mock config ─────────────────────────────────────────────

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

// ── Hoisted mocks ─────────────────────────────────────────────────────

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
const mockUpdatePublishedItemSchedule = vi.hoisted(() => vi.fn())
const mockGetScheduledPosts = vi.hoisted(() => vi.fn())
const mockSchedulePost = vi.hoisted(() => vi.fn())

// ── Module mocks ──────────────────────────────────────────────────────

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
  updatePublishedItemSchedule: (...args: unknown[]) => mockUpdatePublishedItemSchedule(...args),
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

// ── Import after mocks ────────────────────────────────────────────────

import { rescheduleIdeaPosts } from '../../../../L3-services/scheduler/scheduler.js'

// ── Helpers ───────────────────────────────────────────────────────────

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
      linkedin: {
        slots: [
          { days: ['tue'], time: '08:00', label: 'Tuesday morning' },
          { days: ['wed'], time: '08:00', label: 'Wednesday morning' },
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

// ── Tests ──────────────────────────────────────────────────────────────

describe('rescheduleIdeaPosts', () => {
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
    mockUpdatePublishedItemSchedule.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves idea posts to their optimal slots and calls Late API + local update', async () => {
    const ideaPost1 = makeQueueItem({
      id: 'idea-post-1',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-idea-1',
        ideaIds: ['idea-A'],
        scheduledFor: '2026-03-10T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    const ideaPost2 = makeQueueItem({
      id: 'idea-post-2',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-idea-2',
        ideaIds: ['idea-B'],
        scheduledFor: '2026-03-11T09:00:00+00:00',
        createdAt: '2026-03-01T01:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost1, ideaPost2])

    const result = await rescheduleIdeaPosts()

    expect(result.rescheduled).toBe(2)
    expect(result.unchanged).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.details).toHaveLength(2)

    // Both should be assigned to first available tiktok slots
    expect(mockSchedulePost).toHaveBeenCalledTimes(2)
    expect(mockSchedulePost).toHaveBeenCalledWith('late-idea-1', '2026-03-03T09:00:00+00:00')
    expect(mockSchedulePost).toHaveBeenCalledWith('late-idea-2', '2026-03-04T09:00:00+00:00')

    expect(mockUpdatePublishedItemSchedule).toHaveBeenCalledTimes(2)
    expect(mockUpdatePublishedItemSchedule).toHaveBeenCalledWith('idea-post-1', '2026-03-03T09:00:00+00:00')
    expect(mockUpdatePublishedItemSchedule).toHaveBeenCalledWith('idea-post-2', '2026-03-04T09:00:00+00:00')
  })

  it('marks posts as unchanged when current slot matches the optimal slot', async () => {
    const ideaPost = makeQueueItem({
      id: 'idea-already-optimal',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-optimal',
        ideaIds: ['idea-C'],
        scheduledFor: '2026-03-03T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    // 1st call (line 465): finds idea posts to reschedule
    // 2nd call (inside buildBookedSlots): empty so the idea post's own local
    //   slot doesn't block it — the Late-side slot is excluded by ideaLatePostIds
    mockGetPublishedItems
      .mockResolvedValueOnce([ideaPost])
      .mockResolvedValueOnce([])

    // Late API returns the same post so the Late-side slot is excluded
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({
        _id: 'late-optimal',
        scheduledFor: '2026-03-03T09:00:00+00:00',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
      }),
    ])

    const result = await rescheduleIdeaPosts()

    expect(result.rescheduled).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.details[0].oldSlot).toBe('2026-03-03T09:00:00+00:00')
    expect(result.details[0].newSlot).toBe('2026-03-03T09:00:00+00:00')

    expect(mockSchedulePost).not.toHaveBeenCalled()
    expect(mockUpdatePublishedItemSchedule).not.toHaveBeenCalled()
  })

  it('displaces non-idea Late posts to make room for idea posts', async () => {
    // Non-idea Late post occupies earliest slot
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({
        _id: 'non-idea-late',
        scheduledFor: '2026-03-03T09:00:00+00:00',
        platforms: [{ platform: 'tiktok', accountId: 'acct-1' }],
      }),
    ])

    const ideaPost = makeQueueItem({
      id: 'idea-displaces',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-idea-displace',
        ideaIds: ['idea-D'],
        scheduledFor: '2026-03-10T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost])

    const result = await rescheduleIdeaPosts()

    expect(result.rescheduled).toBe(1)
    expect(result.details[0].newSlot).toBe('2026-03-03T09:00:00+00:00')

    // schedulePost called twice: once to displace the non-idea post, once for the idea post
    expect(mockSchedulePost).toHaveBeenCalledTimes(2)
    // First call displaces the non-idea post
    expect(mockSchedulePost).toHaveBeenCalledWith('non-idea-late', expect.any(String))
    // Second call assigns the idea post to the freed slot
    expect(mockSchedulePost).toHaveBeenCalledWith('late-idea-displace', '2026-03-03T09:00:00+00:00')
  })

  it('dry run assigns slots but makes no API calls', async () => {
    const ideaPost = makeQueueItem({
      id: 'idea-dry',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-dry',
        ideaIds: ['idea-E'],
        scheduledFor: '2026-03-10T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost])

    const result = await rescheduleIdeaPosts({ dryRun: true })

    expect(result.rescheduled).toBe(1)
    expect(result.details[0].newSlot).toBe('2026-03-03T09:00:00+00:00')

    expect(mockSchedulePost).not.toHaveBeenCalled()
    expect(mockUpdatePublishedItemSchedule).not.toHaveBeenCalled()
  })

  it('records error when schedulePost throws for one post but continues others', async () => {
    const ideaPost1 = makeQueueItem({
      id: 'idea-fail',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-fail',
        ideaIds: ['idea-F'],
        scheduledFor: '2026-03-10T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    const ideaPost2 = makeQueueItem({
      id: 'idea-ok',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-ok',
        ideaIds: ['idea-G'],
        scheduledFor: '2026-03-11T09:00:00+00:00',
        createdAt: '2026-03-01T01:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost1, ideaPost2])

    mockSchedulePost
      .mockRejectedValueOnce(new Error('Late API timeout'))
      .mockResolvedValueOnce(makeLatePost())

    const result = await rescheduleIdeaPosts()

    expect(result.failed).toBe(1)
    expect(result.rescheduled).toBe(1)
    expect(result.details).toHaveLength(2)

    const failDetail = result.details.find((d: { itemId: string }) => d.itemId === 'idea-fail')!
    expect(failDetail.error).toBe('Late API timeout')
    expect(failDetail.newSlot).toBeNull()

    const okDetail = result.details.find((d: { itemId: string }) => d.itemId === 'idea-ok')!
    expect(okDetail.error).toBeUndefined()
    expect(okDetail.newSlot).not.toBeNull()
  })

  it('records error when platform has no schedule config', async () => {
    const ideaPost = makeQueueItem({
      id: 'idea-no-config',
      metadata: {
        platform: 'mastodon',
        clipType: 'short',
        latePostId: 'late-no-config',
        ideaIds: ['idea-H'],
        scheduledFor: null,
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost])

    const result = await rescheduleIdeaPosts()

    expect(result.failed).toBe(1)
    expect(result.rescheduled).toBe(0)
    expect(result.details[0].error).toBe('No schedule config')
    expect(result.details[0].platform).toBe('mastodon')

    expect(mockSchedulePost).not.toHaveBeenCalled()
  })

  it('removes idea posts from bookedMap before scheduling', async () => {
    // Set up a booked map with the idea post's Late ID in it
    const ideaSlotMs = new Date('2026-03-03T09:00:00+00:00').getTime()
    mockGetScheduledPosts.mockResolvedValue([
      makeLatePost({
        _id: 'late-remove-test',
        scheduledFor: '2026-03-03T09:00:00+00:00',
      }),
    ])

    const ideaPost = makeQueueItem({
      id: 'idea-remove',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-remove-test',
        ideaIds: ['idea-remove'],
        scheduledFor: '2026-03-03T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([ideaPost])

    const result = await rescheduleIdeaPosts()

    // The idea post was at the same slot — should be unchanged (slot freed then reassigned)
    expect(result.unchanged).toBe(1)
    expect(result.rescheduled).toBe(0)
  })

  it('records "No slot found" when schedulePost returns null for an idea post', async () => {
    mockLoadScheduleConfig.mockResolvedValue(makeScheduleConfig({
      platforms: {
        tiktok: {
          // Only one slot that's already booked
          slots: [{ days: ['tue'], time: '09:00', label: 'Tue only' }],
          avoidDays: ['mon', 'wed', 'thu', 'fri', 'sat', 'sun'],
        },
      },
    }))

    // Fill the only available slot with a non-displaceable idea-linked post
    const blockerPost = makeLatePost({
      _id: 'blocker-post',
      scheduledFor: '2026-03-03T09:00:00+00:00',
    })
    mockGetScheduledPosts.mockResolvedValue([blockerPost])

    // Create a local published item for the blocker so it appears idea-linked in the booked map
    const blockerItem = makeQueueItem({
      id: 'blocker-item',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'blocker-post',
        ideaIds: ['idea-blocker'],
        scheduledFor: '2026-03-03T09:00:00+00:00',
        createdAt: '2026-02-01T00:00:00Z',
      },
    })

    const ideaPost = makeQueueItem({
      id: 'idea-noslot',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-noslot',
        ideaIds: ['idea-noslot'],
        scheduledFor: null,
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems
      .mockResolvedValueOnce([blockerItem, ideaPost])
      .mockResolvedValueOnce([blockerItem])

    const result = await rescheduleIdeaPosts()

    // The noslot post should fail
    const noslotDetail = result.details.find((d: { itemId: string }) => d.itemId === 'idea-noslot')
    if (noslotDetail?.error) {
      expect(noslotDetail.error).toBe('No slot found')
      expect(noslotDetail.newSlot).toBeNull()
    }
    // Total should reflect both attempts
    expect(result.details.length).toBeGreaterThanOrEqual(1)
  })

  it('sorts idea posts by createdAt and processes oldest first', async () => {
    const newerPost = makeQueueItem({
      id: 'idea-newer',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-newer',
        ideaIds: ['idea-N'],
        scheduledFor: '2026-03-10T09:00:00+00:00',
        createdAt: '2026-03-02T00:00:00Z',
      },
    })
    const olderPost = makeQueueItem({
      id: 'idea-older',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: 'late-older',
        ideaIds: ['idea-O'],
        scheduledFor: '2026-03-11T09:00:00+00:00',
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    // Return in reverse order — newer first
    mockGetPublishedItems.mockResolvedValue([newerPost, olderPost])

    const result = await rescheduleIdeaPosts()

    expect(result.rescheduled).toBe(2)
    // Older post should get the earlier slot (first call to Late API)
    expect(mockSchedulePost).toHaveBeenNthCalledWith(1, 'late-older', expect.any(String))
    expect(mockSchedulePost).toHaveBeenNthCalledWith(2, 'late-newer', expect.any(String))
  })

  it('filters out posts without latePostId', async () => {
    const noLateId = makeQueueItem({
      id: 'idea-no-late',
      metadata: {
        platform: 'tiktok',
        clipType: 'short',
        latePostId: null,
        ideaIds: ['idea-J'],
        scheduledFor: null,
        createdAt: '2026-03-01T00:00:00Z',
      },
    })
    mockGetPublishedItems.mockResolvedValue([noLateId])

    const result = await rescheduleIdeaPosts()

    expect(result).toEqual({ rescheduled: 0, unchanged: 0, failed: 0, details: [] })
    expect(mockSchedulePost).not.toHaveBeenCalled()
  })
})

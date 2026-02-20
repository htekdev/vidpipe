import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (L3 services + L1 infra) ────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
}))

const mockGetItem = vi.hoisted(() => vi.fn())
const mockApproveItem = vi.hoisted(() => vi.fn())
const mockApproveBulk = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getItem: mockGetItem,
  approveItem: mockApproveItem,
  approveBulk: mockApproveBulk,
}))

const mockFindNextSlot = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
}))

const mockLoadScheduleConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

const mockGetAccountId = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/socialPosting/accountMapping.js', () => ({
  getAccountId: mockGetAccountId,
}))

const mockCreatePost = vi.hoisted(() => vi.fn())
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    createPost: mockCreatePost,
    uploadMedia: vi.fn().mockResolvedValue({ type: 'video', url: 'https://cdn/v.mp4' }),
  }),
}))

// ── Import after mocks ────────────────────────────────────────────────

import { enqueueApproval } from '../../../L7-app/review/approvalQueue.js'

// ── Lifecycle ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadScheduleConfig.mockResolvedValue({ timezone: 'America/Chicago', platforms: {} })
  mockFindNextSlot.mockResolvedValue('2026-04-01T10:00:00-06:00')
  mockGetAccountId.mockResolvedValue('acc-123')
  mockFileExists.mockResolvedValue(true)
  mockCreatePost.mockResolvedValue({ _id: 'late-1', status: 'scheduled' })
  mockApproveItem.mockResolvedValue(undefined)
  mockApproveBulk.mockResolvedValue(undefined)
})

// ── Tests ──────────────────────────────────────────────────────────────

describe('L7 Unit: approvalQueue isDraft', () => {
  it('passes isDraft: false to createPost', async () => {
    mockGetItem.mockResolvedValue({
      id: 'item-1',
      metadata: {
        id: 'item-1',
        platform: 'youtube',
        accountId: 'acc-yt',
        sourceVideo: '/v.mp4',
        sourceClip: null,
        clipType: 'short',
        sourceMediaPath: '/m.mp4',
        hashtags: [],
        links: [],
        characterCount: 10,
        platformCharLimit: 5000,
        suggestedSlot: null,
        scheduledFor: null,
        status: 'pending_review',
        latePostId: null,
        publishedUrl: null,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        publishedAt: null,
      },
      postContent: 'Test content',
      hasMedia: true,
      mediaPath: '/m.mp4',
      folderPath: '/queue/item-1',
    })

    const result = await enqueueApproval(['item-1'])

    expect(result.scheduled).toBe(1)
    expect(mockCreatePost).toHaveBeenCalledWith(
      expect.objectContaining({ isDraft: false }),
    )
  })
})

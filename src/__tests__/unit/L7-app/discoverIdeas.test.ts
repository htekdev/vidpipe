import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { Platform } from '../../../L0-pure/types/index.js'
import type { ShortClip, MediumClip } from '../../../L0-pure/types/index.js'

const mockGetPendingItems = vi.hoisted(() => vi.fn())
const mockUpdateItem = vi.hoisted(() => vi.fn())
const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockDiscoverIdeas = vi.hoisted(() => vi.fn())
const mockGetBrandConfig = vi.hoisted(() => vi.fn().mockReturnValue({
  name: 'TestBrand',
  hashtags: { platforms: { youtube: [], tiktok: [] } },
}))
const mockJoin = vi.hoisted(() => vi.fn((...parts: string[]) => parts.join('/')))

vi.mock('../../../L3-services/postStore/postStore.js', () => ({
  getPendingItems: mockGetPendingItems,
  updateItem: mockUpdateItem,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: mockReadJsonFile,
  fileExists: mockFileExists,
}))

vi.mock('../../../L6-pipeline/ideation.js', () => ({
  discoverIdeas: mockDiscoverIdeas,
}))

vi.mock('../../../L1-infra/config/brand.js', () => ({
  getBrandConfig: mockGetBrandConfig,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: mockJoin,
}))

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { runDiscoverIdeas } from '../../../L7-app/commands/discoverIdeas.js'

function makeQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    metadata: {
      id: 'item-1',
      platform: 'youtube',
      accountId: 'acc',
      sourceVideo: '/recordings/vid1',
      sourceClip: null as string | null,
      clipType: 'video' as const,
      sourceMediaPath: null,
      hashtags: [],
      links: [],
      characterCount: 100,
      platformCharLimit: 500,
      suggestedSlot: null,
      scheduledFor: null,
      status: 'pending_review' as const,
      latePostId: null,
      ideaIds: undefined as string[] | undefined,
      ...overrides,
    },
    postContent: 'Post content',
    hasMedia: false,
    mediaPath: null,
    thumbnailPath: null,
    folderPath: '/queue/item-1',
  }
}

describe('discoverIdeas command', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  function getOutput(): string {
    return consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n')
  }

  test('discoverIdeas.REQ-001 returns early when no pending items exist', async () => {
    mockGetPendingItems.mockResolvedValue([])

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(getOutput()).toContain('No pending items')
    expect(mockDiscoverIdeas).not.toHaveBeenCalled()
  })

  test('discoverIdeas.REQ-002 returns early when all items already have ideas', async () => {
    mockGetPendingItems.mockResolvedValue([
      makeQueueItem({ ideaIds: ['1'] }),
    ])

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(getOutput()).toContain('already have ideas assigned')
    expect(mockDiscoverIdeas).not.toHaveBeenCalled()
  })

  test('discoverIdeas.REQ-003 skips videos without transcript.json', async () => {
    mockGetPendingItems.mockResolvedValue([makeQueueItem()])
    mockFileExists.mockResolvedValue(false)

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).not.toHaveBeenCalled()
    expect(getOutput()).toContain('skipped/failed')
  })

  test('discoverIdeas.REQ-004 skips videos with no shorts or medium clips', async () => {
    mockGetPendingItems.mockResolvedValue([makeQueueItem()])
    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [{ start: 0, end: 10, text: 'hello' }] }
      return []
    })

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).not.toHaveBeenCalled()
  })

  test('discoverIdeas.REQ-005 calls discoverIdeas with shorts and medium clips', async () => {
    const item = makeQueueItem()
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]
    const mediumClips: Partial<MediumClip>[] = [{ id: 'm1', slug: 'medium-1', title: 'M1', segments: [], totalDuration: 90, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      if (path.endsWith('medium-clips-plan.json')) return true
      if (path.endsWith('summary.json')) return false
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [{ start: 0, end: 10, text: 'hello' }] }
      if (path.endsWith('shorts-plan.json')) return shorts
      if (path.endsWith('medium-clips-plan.json')) return mediumClips
      return {}
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [{ clipId: 's1', ideaIssueNumber: 42 }],
      newIdeas: [],
      matchedCount: 1,
      createdCount: 0,
    })
    mockUpdateItem.mockResolvedValue({})

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).toHaveBeenCalledWith(expect.objectContaining({
      shorts,
      mediumClips,
      transcript: [{ start: 0, end: 10, text: 'hello' }],
    }))
  })

  test('discoverIdeas.REQ-006 updates queue items with matched idea IDs', async () => {
    const item = makeQueueItem({ sourceClip: 'short-1' })
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      return []
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [{ clipId: 's1', ideaIssueNumber: 42 }],
      newIdeas: [],
      matchedCount: 1,
      createdCount: 0,
    })
    mockUpdateItem.mockResolvedValue({})

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      metadata: { ideaIds: ['42'] },
    })
  })

  test('discoverIdeas.REQ-007 dry-run mode does not update items', async () => {
    const item = makeQueueItem()
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      return []
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [{ clipId: 's1', ideaIssueNumber: 42 }],
      newIdeas: [],
      matchedCount: 1,
      createdCount: 0,
    })

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({ dryRun: true })

    expect(mockUpdateItem).not.toHaveBeenCalled()
    expect(getOutput()).toContain('[dry-run]')
  })

  test('discoverIdeas.REQ-008 handles discovery error gracefully', async () => {
    const item = makeQueueItem()
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      return []
    })

    mockDiscoverIdeas.mockRejectedValue(new Error('LLM unavailable'))

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    // Should not throw, just log the error and count as failed
    expect(getOutput()).toContain('skipped/failed')
  })

  test('discoverIdeas.REQ-009 falls back to all idea IDs when no specific clip match', async () => {
    const item = makeQueueItem({ sourceClip: 'unknown-clip' })
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      return []
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [{ clipId: 's1', ideaIssueNumber: 42 }],
      newIdeas: [],
      matchedCount: 1,
      createdCount: 0,
    })
    mockUpdateItem.mockResolvedValue({})

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    // Should fall back to all idea IDs since sourceClip doesn't match any shorts/mediums
    expect(mockUpdateItem).toHaveBeenCalledWith('item-1', {
      metadata: { ideaIds: ['42'] },
    })
  })

  test('discoverIdeas.REQ-010 uses default publishBy 7 days from now when not specified', async () => {
    const item = makeQueueItem()
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      return []
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [],
      newIdeas: [],
      matchedCount: 0,
      createdCount: 0,
    })

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).toHaveBeenCalledWith(expect.objectContaining({
      publishBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }))
  })

  test('discoverIdeas.REQ-011 loads summary text when summary.json exists', async () => {
    const item = makeQueueItem()
    mockGetPendingItems.mockResolvedValue([item])

    const shorts: Partial<ShortClip>[] = [{ id: 's1', slug: 'short-1', title: 'S1', segments: [], totalDuration: 30, outputPath: '', description: '', tags: [], hook: '' }]

    mockFileExists.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return true
      if (path.endsWith('shorts-plan.json')) return true
      if (path.endsWith('summary.json')) return true
      return false
    })
    mockReadJsonFile.mockImplementation(async (path: string) => {
      if (path.endsWith('transcript.json')) return { segments: [] }
      if (path.endsWith('shorts-plan.json')) return shorts
      if (path.endsWith('summary.json')) return { overview: 'Video about AI tools' }
      return []
    })

    mockDiscoverIdeas.mockResolvedValue({
      assignments: [],
      newIdeas: [],
      matchedCount: 0,
      createdCount: 0,
    })

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).toHaveBeenCalledWith(expect.objectContaining({
      summary: 'Video about AI tools',
    }))
  })

  test('discoverIdeas.REQ-012 groups items by source video and processes each group', async () => {
    const item1 = makeQueueItem({ id: 'item-1', sourceVideo: '/recordings/vid1' })
    item1.id = 'item-1'
    const item2 = { ...makeQueueItem({ id: 'item-2', sourceVideo: '/recordings/vid2' }), id: 'item-2' }

    mockGetPendingItems.mockResolvedValue([item1, item2])

    // Both missing transcripts → both groups skip
    mockFileExists.mockResolvedValue(false)

    const { runDiscoverIdeas } = await import('../../../L7-app/commands/discoverIdeas.js')
    await runDiscoverIdeas({})

    expect(mockDiscoverIdeas).not.toHaveBeenCalled()
    expect(getOutput()).toContain('2 skipped/failed')
  })
})

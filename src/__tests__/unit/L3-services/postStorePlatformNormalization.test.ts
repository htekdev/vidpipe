import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Idea, Platform } from '../../../L0-pure/types/index.js'
import type { QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockWriteTextFile = vi.hoisted(() => vi.fn())
const mockWriteJsonFile = vi.hoisted(() => vi.fn())
const mockReadJsonFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockListDirectoryWithTypes = vi.hoisted(() => vi.fn())
const mockListDirectory = vi.hoisted(() => vi.fn())
const mockCopyFile = vi.hoisted(() => vi.fn())
const mockRenameFile = vi.hoisted(() => vi.fn())
const mockRemoveDirectory = vi.hoisted(() => vi.fn())
const mockCopyDirectory = vi.hoisted(() => vi.fn())
const mockRemoveFile = vi.hoisted(() => vi.fn())
const mockGetIdea = vi.hoisted(() => vi.fn())
const mockListIdeas = vi.hoisted(() => vi.fn())
const mockMarkPublished = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  writeJsonFile: mockWriteJsonFile,
  readJsonFile: mockReadJsonFile,
  fileExists: mockFileExists,
  ensureDirectory: mockEnsureDirectory,
  listDirectoryWithTypes: mockListDirectoryWithTypes,
  listDirectory: mockListDirectory,
  copyFile: mockCopyFile,
  renameFile: mockRenameFile,
  removeDirectory: mockRemoveDirectory,
  copyDirectory: mockCopyDirectory,
  removeFile: mockRemoveFile,
}))

vi.mock('../../../L1-infra/paths/paths.js', async () => {
  const path = await import('node:path')
  return {
    join: (...args: string[]) => path.join(...args),
    resolve: (...args: string[]) => path.resolve(...args),
    basename: (targetPath: string) => path.basename(targetPath),
    dirname: (targetPath: string) => path.dirname(targetPath),
    extname: (targetPath: string) => path.extname(targetPath),
    sep: path.sep,
  }
})

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: '/test/output' }),
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  getIdea: mockGetIdea,
  listIdeas: mockListIdeas,
  markPublished: mockMarkPublished,
}))

import { approveItem } from '../../../L3-services/postStore/postStore.js'

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'clip-twitter',
    platform: 'twitter',
    accountId: 'acc-1',
    sourceVideo: '/recordings/my-video',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: '/media/short.mp4',
    hashtags: ['#test'],
    links: [{ url: 'https://example.com' }],
    characterCount: 100,
    platformCharLimit: 280,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: '2026-01-15T10:00:00Z',
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  const issueNumber = overrides.issueNumber ?? 1
  return {
    issueNumber,
    issueUrl: overrides.issueUrl ?? `https://github.com/htekdev/content-management/issues/${issueNumber}`,
    repoFullName: overrides.repoFullName ?? 'htekdev/content-management',
    id: overrides.id ?? 'idea-1',
    topic: overrides.topic ?? 'Topic',
    hook: overrides.hook ?? 'Hook',
    audience: overrides.audience ?? 'Creators',
    keyTakeaway: overrides.keyTakeaway ?? 'Takeaway',
    talkingPoints: overrides.talkingPoints ?? ['Point 1'],
    platforms: overrides.platforms ?? (['x'] as Platform[]),
    status: overrides.status ?? 'recorded',
    tags: overrides.tags ?? ['test'],
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00Z',
    publishBy: overrides.publishBy ?? '2026-03-01T00:00:00Z',
    sourceVideoSlug: overrides.sourceVideoSlug,
    trendContext: overrides.trendContext,
    publishedContent: overrides.publishedContent,
  }
}

describe('L3 Integration: postStore platform normalization', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteJsonFile.mockResolvedValue(undefined)
    mockWriteTextFile.mockResolvedValue(undefined)
    mockRenameFile.mockResolvedValue(undefined)
    mockCopyDirectory.mockResolvedValue(undefined)
    mockRemoveDirectory.mockResolvedValue(undefined)
    mockCopyFile.mockResolvedValue(undefined)
    mockListDirectory.mockResolvedValue([])
    mockListDirectoryWithTypes.mockResolvedValue([])
    mockRemoveFile.mockResolvedValue(undefined)
    mockMarkPublished.mockResolvedValue(undefined)
  })

  it('normalizes twitter queue items to x before marking ideas published', async () => {
    const metadata = makeMetadata({ ideaIds: ['idea-1'] })
    const idea = makeIdea({ issueNumber: 1, id: 'idea-1' })

    mockReadTextFile
      .mockResolvedValueOnce(JSON.stringify(metadata))
      .mockResolvedValueOnce('Post content')
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockReadJsonFile.mockResolvedValue(idea)
    mockListIdeas.mockResolvedValue([idea])
    mockGetIdea.mockResolvedValue(idea)

    await approveItem('clip-twitter', {
      latePostId: 'late-123',
      scheduledFor: '2026-02-01T19:00:00Z',
      publishedUrl: 'https://x.com/example/status/123',
    })

    expect(mockMarkPublished).toHaveBeenCalledTimes(1)
    expect(mockMarkPublished).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        clipType: 'short',
        platform: 'x',
        queueItemId: 'clip-twitter',
        publishedAt: expect.any(String),
        latePostId: 'late-123',
        lateUrl: 'https://x.com/example/status/123',
      }),
    )
  })
})

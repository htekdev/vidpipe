/**
 * L3 Integration Test — postStore twitter/x normalization
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L3 postStore + ideaService business logic, L0 pure types
 */
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

vi.mock('../../../L1-infra/paths/paths.js', () => {
  const path = require('path')
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

import * as ideaService from '../../../L3-services/ideation/ideaService.js'
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
  return {
    id: 'idea-1',
    topic: 'Topic',
    hook: 'Hook',
    audience: 'Creators',
    keyTakeaway: 'Takeaway',
    talkingPoints: ['Point 1'],
    platforms: ['x'] as Platform[],
    status: 'recorded',
    tags: ['test'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    publishBy: '2026-03-01T00:00:00Z',
    ...overrides,
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
  })

  it('normalizes twitter queue items to x before marking ideas published', async () => {
    const metadata = makeMetadata({ ideaIds: ['idea-1'] })
    const idea = makeIdea()
    const markPublishedSpy = vi.spyOn(ideaService, 'markPublished')

    mockReadTextFile
      .mockResolvedValueOnce(JSON.stringify(metadata))
      .mockResolvedValueOnce('Post content')
    mockFileExists
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockReadJsonFile.mockResolvedValue(idea)

    await approveItem('clip-twitter', {
      latePostId: 'late-123',
      scheduledFor: '2026-02-01T19:00:00Z',
      publishedUrl: 'https://x.com/example/status/123',
    })

    expect(markPublishedSpy).toHaveBeenCalledTimes(1)
    expect(markPublishedSpy).toHaveBeenCalledWith(
      'idea-1',
      expect.objectContaining({
        clipType: 'short',
        platform: 'x',
        queueItemId: 'clip-twitter',
        publishedAt: expect.any(String),
        publishedUrl: 'https://x.com/example/status/123',
      }),
    )
  })
})

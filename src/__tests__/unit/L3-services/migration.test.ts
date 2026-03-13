import type { Dirent } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueueItemInsert } from '../../../L2-clients/dataStore/queueStore.js'

const OUTPUT_DIR = 'C:\\migration-output'

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR }),
}))

const mockReadTextFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockListDirectoryWithTypes = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readTextFile: mockReadTextFile,
  fileExists: mockFileExists,
  listDirectoryWithTypes: mockListDirectoryWithTypes,
}))

const mockGetVideo = vi.hoisted(() => vi.fn())
const mockUpsertVideo = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/videoStore.js', () => ({
  getVideo: mockGetVideo,
  upsertVideo: mockUpsertVideo,
}))

const mockInsertQueueItem = vi.hoisted(() => vi.fn())
const mockItemExists = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/queueStore.js', () => ({
  insertQueueItem: mockInsertQueueItem,
  itemExists: mockItemExists,
}))

import { migrateJsonToSqlite } from '../../../L3-services/migration/jsonToSqlite.js'

function directoryEntry(name: string): Dirent {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: '',
    path: '',
  } as Dirent
}

describe('migrateJsonToSqlite', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockFileExists.mockImplementation(async (targetPath: string) => {
      return targetPath === `${OUTPUT_DIR}\\processing-state.json`
        || targetPath === `${OUTPUT_DIR}\\publish-queue`
        || targetPath === `${OUTPUT_DIR}\\published`
    })
    mockListDirectoryWithTypes.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${OUTPUT_DIR}\\publish-queue`) {
        return [directoryEntry('queue-item-1')]
      }

      if (targetPath === `${OUTPUT_DIR}\\published`) {
        return [directoryEntry('published-item-1')]
      }

      return []
    })
    mockGetVideo.mockReturnValue(undefined)
    mockItemExists.mockReturnValue(null)
  })

  it('jsonToSqlite.REQ-001 - imports processing-state videos into SQLite and skips existing rows', async () => {
    mockGetVideo.mockImplementation((slug: string) => {
      return slug === 'already-there' ? { slug } : undefined
    })
    mockReadTextFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${OUTPUT_DIR}\\processing-state.json`) {
        return JSON.stringify({
          videos: {
            'new-video': { status: 'pending', sourcePath: 'C:\\videos\\new-video.mp4' },
            'already-there': { status: 'completed', sourcePath: 'C:\\videos\\already-there.mp4' },
          },
        })
      }

      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({
          id: targetPath.includes('published-item-1') ? 'published-item-1' : 'queue-item-1',
          platform: 'youtube',
          accountId: 'acct-1',
          sourceVideo: 'recording-1',
          sourceClip: null,
          clipType: 'short',
          sourceMediaPath: 'C:\\media\\clip.mp4',
          hashtags: ['#vidpipe'],
          links: [{ url: 'https://example.com', title: 'Example' }],
          characterCount: 123,
          platformCharLimit: 5000,
          suggestedSlot: '2026-03-01T10:00:00Z',
          scheduledFor: '2026-03-02T10:00:00Z',
          status: targetPath.includes('published-item-1') ? 'published' : 'pending_review',
          latePostId: targetPath.includes('published-item-1') ? 'late-123' : null,
          publishedUrl: targetPath.includes('published-item-1') ? 'https://example.com/post' : null,
          createdAt: '2026-03-01T09:00:00Z',
          reviewedAt: null,
          publishedAt: targetPath.includes('published-item-1') ? '2026-03-02T11:00:00Z' : null,
          textOnly: false,
          mediaType: 'video',
          platformSpecificData: { visibility: 'public' },
        })
      }

      if (targetPath.endsWith('post.md')) {
        return `Post content for ${targetPath}`
      }

      throw new Error(`Unexpected path ${targetPath}`)
    })

    const result = await migrateJsonToSqlite()

    expect(result).toEqual({
      videosImported: 1,
      videosSkipped: 1,
      queueItemsImported: 1,
      queueItemsSkipped: 0,
      publishedItemsImported: 1,
      publishedItemsSkipped: 0,
      errors: [],
    })
    expect(mockUpsertVideo).toHaveBeenCalledWith('new-video', 'C:\\videos\\new-video.mp4', 'pending')
    expect(mockInsertQueueItem).toHaveBeenNthCalledWith(1, {
      id: 'queue-item-1',
      platform: 'youtube',
      account_id: 'acct-1',
      source_video: 'recording-1',
      source_clip: null,
      clip_type: 'short',
      source_media_path: 'C:\\media\\clip.mp4',
      media_type: 'video',
      hashtags: ['#vidpipe'],
      links: [{ url: 'https://example.com', title: 'Example' }],
      character_count: 123,
      platform_char_limit: 5000,
      suggested_slot: '2026-03-01T10:00:00Z',
      scheduled_for: '2026-03-02T10:00:00Z',
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: `Post content for ${OUTPUT_DIR}\\publish-queue\\queue-item-1\\post.md`,
      text_only: false,
      platform_specific: { visibility: 'public' },
      media_folder_path: `${OUTPUT_DIR}\\publish-queue\\queue-item-1`,
    } satisfies QueueItemInsert)
    expect(mockInsertQueueItem).toHaveBeenNthCalledWith(2, {
      id: 'published-item-1',
      platform: 'youtube',
      account_id: 'acct-1',
      source_video: 'recording-1',
      source_clip: null,
      clip_type: 'short',
      source_media_path: 'C:\\media\\clip.mp4',
      media_type: 'video',
      hashtags: ['#vidpipe'],
      links: [{ url: 'https://example.com', title: 'Example' }],
      character_count: 123,
      platform_char_limit: 5000,
      suggested_slot: '2026-03-01T10:00:00Z',
      scheduled_for: '2026-03-02T10:00:00Z',
      status: 'published',
      late_post_id: 'late-123',
      published_url: 'https://example.com/post',
      post_content: `Post content for ${OUTPUT_DIR}\\published\\published-item-1\\post.md`,
      text_only: false,
      platform_specific: { visibility: 'public' },
      media_folder_path: `${OUTPUT_DIR}\\published\\published-item-1`,
    } satisfies QueueItemInsert)
  })

  it('jsonToSqlite.REQ-002 - skips queue and published items that already exist', async () => {
    mockReadTextFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${OUTPUT_DIR}\\processing-state.json`) {
        return JSON.stringify({ videos: {} })
      }

      if (targetPath.endsWith('metadata.json')) {
        return JSON.stringify({
          id: targetPath.includes('published-item-1') ? 'published-item-1' : 'queue-item-1',
          platform: 'instagram',
          accountId: 'acct-2',
          sourceVideo: 'recording-2',
          sourceClip: null,
          clipType: 'video',
          sourceMediaPath: null,
          hashtags: [],
          links: [],
          characterCount: 20,
          platformCharLimit: 2200,
          suggestedSlot: null,
          scheduledFor: null,
          status: 'pending_review',
          latePostId: null,
          publishedUrl: null,
          createdAt: '2026-03-01T09:00:00Z',
          reviewedAt: null,
          publishedAt: null,
        })
      }

      return 'existing post'
    })
    mockItemExists.mockImplementation((id: string) => {
      if (id === 'queue-item-1') return 'pending_review'
      if (id === 'published-item-1') return 'published'
      return null
    })

    const result = await migrateJsonToSqlite()

    expect(result.queueItemsSkipped).toBe(1)
    expect(result.publishedItemsSkipped).toBe(1)
    expect(mockInsertQueueItem).not.toHaveBeenCalled()
  })

  it('jsonToSqlite.REQ-020 - records errors for corrupt JSON and missing post files while continuing', async () => {
    mockReadTextFile.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${OUTPUT_DIR}\\processing-state.json`) {
        return '{not-valid-json'
      }

      if (targetPath.endsWith('queue-item-1\\metadata.json')) {
        return JSON.stringify({
          id: 'queue-item-1',
          platform: 'linkedin',
          accountId: 'acct-3',
          sourceVideo: 'recording-3',
          sourceClip: null,
          clipType: 'medium-clip',
          sourceMediaPath: null,
          hashtags: [],
          links: [],
          characterCount: 44,
          platformCharLimit: 3000,
          suggestedSlot: null,
          scheduledFor: null,
          status: 'pending_review',
          latePostId: null,
          publishedUrl: null,
          createdAt: '2026-03-01T09:00:00Z',
          reviewedAt: null,
          publishedAt: null,
        })
      }

      if (targetPath.endsWith('published-item-1\\metadata.json')) {
        return JSON.stringify({
          id: 'published-item-1',
          platform: 'linkedin',
          accountId: 'acct-4',
          sourceVideo: 'recording-4',
          sourceClip: null,
          clipType: 'video',
          sourceMediaPath: null,
          hashtags: ['#done'],
          links: [],
          characterCount: 88,
          platformCharLimit: 3000,
          suggestedSlot: null,
          scheduledFor: '2026-03-04T10:00:00Z',
          status: 'published',
          latePostId: 'late-999',
          publishedUrl: 'https://example.com/published',
          createdAt: '2026-03-01T09:00:00Z',
          reviewedAt: '2026-03-04T09:00:00Z',
          publishedAt: '2026-03-04T11:00:00Z',
        })
      }

      if (targetPath.endsWith('published-item-1\\post.md')) {
        return 'Published body'
      }

      throw new Error(`File not found: ${targetPath}`)
    })

    const result = await migrateJsonToSqlite()

    expect(result.videosImported).toBe(0)
    expect(result.queueItemsImported).toBe(0)
    expect(result.publishedItemsImported).toBe(1)
    expect(result.errors).toHaveLength(2)
    expect(result.errors[0]).toContain('Failed to migrate processing state')
    expect(result.errors[1]).toContain('Failed to migrate queue item')
    expect(mockInsertQueueItem).toHaveBeenCalledTimes(1)
    expect(mockInsertQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'published-item-1',
      status: 'published',
      post_content: 'Published body',
    }))
  })
})

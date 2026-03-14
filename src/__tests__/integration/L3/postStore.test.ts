import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { QueueItemInsert, QueueItemRow } from '../../../L2-clients/dataStore/queueStore.js'
import type { QueueItemMetadata } from '../../../L3-services/postStore/postStore.js'

const queueState = vi.hoisted(() => ({
  rows: new Map<string, QueueItemRow>(),
}))
const fileState = vi.hoisted(() => ({
  paths: new Set<string>(),
}))

const mockGetQueueItem = vi.hoisted(() => vi.fn())
const mockGetItemsByStatus = vi.hoisted(() => vi.fn())
const mockInsertQueueItem = vi.hoisted(() => vi.fn())
const mockUpdateQueueItem = vi.hoisted(() => vi.fn())
const mockMarkPublished = vi.hoisted(() => vi.fn())
const mockDeleteQueueItem = vi.hoisted(() => vi.fn())
const mockItemExists = vi.hoisted(() => vi.fn())

const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockCopyFile = vi.hoisted(() => vi.fn())
const mockFileExists = vi.hoisted(() => vi.fn())
const mockFileExistsSync = vi.hoisted(() => vi.fn())
const mockRenameFile = vi.hoisted(() => vi.fn())
const mockRemoveDirectory = vi.hoisted(() => vi.fn())
const mockCopyDirectory = vi.hoisted(() => vi.fn())

const outputDir = path.join('/test/output')
const queueDir = path.join(outputDir, 'publish-queue')
const publishedDir = path.join(outputDir, 'published')

vi.mock('../../../L2-clients/dataStore/queueStore.js', () => ({
  getQueueItem: mockGetQueueItem,
  getItemsByStatus: mockGetItemsByStatus,
  insertQueueItem: mockInsertQueueItem,
  updateQueueItem: mockUpdateQueueItem,
  markPublished: mockMarkPublished,
  deleteQueueItem: mockDeleteQueueItem,
  itemExists: mockItemExists,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: mockEnsureDirectory,
  copyFile: mockCopyFile,
  fileExists: mockFileExists,
  fileExistsSync: mockFileExistsSync,
  renameFile: mockRenameFile,
  removeDirectory: mockRemoveDirectory,
  copyDirectory: mockCopyDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...args: string[]) => path.join(...args),
  resolve: (...args: string[]) => path.resolve(...args),
  basename: (value: string) => path.basename(value),
  extname: (value: string) => path.extname(value),
  sep: path.sep,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: outputDir }),
}))

import {
  approveBulk,
  approveItem,
  createItem,
  getGroupedPendingItems,
  getItem,
  getPendingItems,
  getPublishedItems,
  itemExists,
  rejectItem,
  updateItem,
} from '../../../L3-services/postStore/postStore.js'

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item-youtube',
    platform: 'youtube',
    accountId: 'acc-1',
    sourceVideo: '/recordings/my-video',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: '/media/short.mp4',
    hashtags: ['#test'],
    links: [{ url: 'https://example.com' }],
    characterCount: 100,
    platformCharLimit: 5000,
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

function rowFromInsert(item: QueueItemInsert, overrides: Partial<QueueItemRow> = {}): QueueItemRow {
  return {
    id: item.id,
    platform: item.platform,
    account_id: item.account_id,
    source_video: item.source_video,
    source_clip: item.source_clip,
    clip_type: item.clip_type,
    source_media_path: item.source_media_path,
    media_type: item.media_type ?? null,
    hashtags: JSON.stringify(item.hashtags),
    links: JSON.stringify(item.links),
    character_count: item.character_count,
    platform_char_limit: item.platform_char_limit,
    suggested_slot: item.suggested_slot,
    scheduled_for: item.scheduled_for,
    status: item.status,
    late_post_id: item.late_post_id,
    published_url: item.published_url,
    post_content: item.post_content,
    text_only: item.text_only === undefined ? null : item.text_only ? 1 : 0,
    platform_specific: item.platform_specific === undefined ? null : JSON.stringify(item.platform_specific),
    media_folder_path: item.media_folder_path,
    created_at: overrides.created_at ?? '2026-01-15T10:00:00Z',
    reviewed_at: overrides.reviewed_at ?? null,
    published_at: overrides.published_at ?? null,
  }
}

function seedRow(row: QueueItemRow): void {
  queueState.rows.set(row.id, row)
}

function addPath(filePath: string): void {
  fileState.paths.add(filePath)
}

function removePathPrefix(prefix: string): void {
  for (const entry of Array.from(fileState.paths)) {
    if (entry === prefix || entry.startsWith(`${prefix}${path.sep}`)) {
      fileState.paths.delete(entry)
    }
  }
}

function copyPathPrefix(source: string, dest: string): void {
  for (const entry of Array.from(fileState.paths)) {
    if (entry === source || entry.startsWith(`${source}${path.sep}`)) {
      fileState.paths.add(entry.replace(source, dest))
    }
  }
  fileState.paths.add(dest)
}

function movePathPrefix(source: string, dest: string): void {
  copyPathPrefix(source, dest)
  removePathPrefix(source)
}

function applyMocks(): void {
  mockGetQueueItem.mockImplementation((id: string) => queueState.rows.get(id))
  mockGetItemsByStatus.mockImplementation((status: 'pending_review' | 'published') => {
    return Array.from(queueState.rows.values())
      .filter((row) => row.status === status)
      .sort((a, b) => {
        const aMedia = a.media_folder_path === null ? 1 : 0
        const bMedia = b.media_folder_path === null ? 1 : 0
        if (aMedia !== bMedia) return aMedia - bMedia
        return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
      })
  })
  mockInsertQueueItem.mockImplementation((item: QueueItemInsert) => {
    seedRow(rowFromInsert(item))
  })
  mockUpdateQueueItem.mockImplementation((id: string, updates: Partial<QueueItemInsert>) => {
    const existing = queueState.rows.get(id)
    if (!existing) return

    const next: QueueItemRow = { ...existing }
    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case 'hashtags':
          next.hashtags = value === undefined ? null : JSON.stringify(value)
          break
        case 'links':
          next.links = value === undefined ? null : JSON.stringify(value)
          break
        case 'platform_specific':
          next.platform_specific = value === undefined ? null : JSON.stringify(value)
          break
        case 'text_only':
          next.text_only = value === undefined ? null : value ? 1 : 0
          break
        case 'media_type':
          next.media_type = (value as QueueItemRow['media_type'] | undefined) ?? null
          break
        default:
          ;(next as unknown as Record<string, unknown>)[key] = value ?? null
          break
      }
    }

    queueState.rows.set(id, next)
  })
  mockMarkPublished.mockImplementation((id: string, publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string }) => {
    const existing = queueState.rows.get(id)
    if (!existing) return

    queueState.rows.set(id, {
      ...existing,
      status: 'published',
      late_post_id: publishData.latePostId,
      scheduled_for: publishData.scheduledFor,
      published_url: publishData.publishedUrl ?? null,
      account_id: publishData.accountId ?? existing.account_id,
      reviewed_at: '2026-02-01T10:00:00Z',
      published_at: '2026-02-01T10:00:00Z',
    })
  })
  mockDeleteQueueItem.mockImplementation((id: string) => {
    queueState.rows.delete(id)
  })
  mockItemExists.mockImplementation((id: string) => queueState.rows.get(id)?.status ?? null)

  mockEnsureDirectory.mockImplementation(async (dirPath: string) => {
    addPath(dirPath)
  })
  mockCopyFile.mockImplementation(async (_src: string, dest: string) => {
    addPath(dest)
    addPath(path.dirname(dest))
  })
  mockFileExists.mockImplementation(async (filePath: string) => fileState.paths.has(filePath))
  mockFileExistsSync.mockImplementation((filePath: string) => fileState.paths.has(filePath))
  mockRenameFile.mockImplementation(async (oldPath: string, newPath: string) => {
    movePathPrefix(oldPath, newPath)
  })
  mockRemoveDirectory.mockImplementation(async (dirPath: string) => {
    removePathPrefix(dirPath)
  })
  mockCopyDirectory.mockImplementation(async (source: string, dest: string) => {
    copyPathPrefix(source, dest)
  })
}

describe('L3 Integration: postStore', () => {
  beforeEach(() => {
    queueState.rows.clear()
    fileState.paths.clear()
    vi.resetAllMocks()
    applyMocks()
  })

  it('createItem stores text-only metadata in queueStore without writing post files', async () => {
    const metadata = makeMetadata({ id: 'my-short-youtube' })
    const item = await createItem('my-short-youtube', metadata, 'Post content here')

    expect(mockInsertQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      id: 'my-short-youtube',
      post_content: 'Post content here',
      media_folder_path: null,
    }))
    expect(mockEnsureDirectory).not.toHaveBeenCalled()
    expect(item.hasMedia).toBe(false)
  })

  it('createItem copies media and records media_folder_path in queueStore', async () => {
    const metadata = makeMetadata({ id: 'my-short-youtube', mediaType: 'image' })
    const item = await createItem('my-short-youtube', metadata, 'Content', '/source/cover.png')

    expect(mockCopyFile).toHaveBeenCalledWith('/source/cover.png', expect.stringContaining('media.png'))
    expect(mockInsertQueueItem).toHaveBeenCalledWith(expect.objectContaining({
      media_folder_path: path.join(queueDir, 'my-short-youtube'),
      media_type: 'image',
    }))
    expect(item.mediaPath).toBe(path.join(queueDir, 'my-short-youtube', 'media.png'))
  })

  it('getItem reads metadata from queueStore and detects media on disk', async () => {
    seedRow(rowFromInsert({
      id: 'clip-youtube',
      platform: 'youtube',
      account_id: 'acc-1',
      source_video: '/recordings/my-video',
      source_clip: null,
      clip_type: 'short',
      source_media_path: '/media/short.mp4',
      hashtags: ['#test'],
      links: [],
      character_count: 100,
      platform_char_limit: 5000,
      suggested_slot: null,
      scheduled_for: null,
      status: 'published',
      late_post_id: 'late-123',
      published_url: 'https://youtube.com/watch?v=abc',
      post_content: 'Hello world',
      media_folder_path: path.join(publishedDir, 'clip-youtube'),
    }, { published_at: '2026-02-01T19:10:00Z' }))
    addPath(path.join(publishedDir, 'clip-youtube', 'media.mp4'))

    const item = await getItem('clip-youtube')

    expect(item).not.toBeNull()
    expect(item!.metadata.status).toBe('published')
    expect(item!.postContent).toBe('Hello world')
    expect(item!.mediaPath).toBe(path.join(publishedDir, 'clip-youtube', 'media.mp4'))
  })

  it('getPendingItems and getGroupedPendingItems use queueStore rows', async () => {
    seedRow(rowFromInsert({
      id: 'my-clip-youtube',
      platform: 'youtube',
      account_id: 'acc-1',
      source_video: '/recordings/my-video',
      source_clip: 'my-clip',
      clip_type: 'short',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 100,
      platform_char_limit: 5000,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'YT',
      media_folder_path: path.join(queueDir, 'my-clip-youtube'),
    }, { created_at: '2026-01-15T10:00:00Z' }))
    seedRow(rowFromInsert({
      id: 'my-clip-tiktok',
      platform: 'tiktok',
      account_id: 'acc-2',
      source_video: '/recordings/my-video',
      source_clip: 'my-clip',
      clip_type: 'short',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 80,
      platform_char_limit: 2200,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'TT',
      media_folder_path: null,
    }, { created_at: '2026-01-15T11:00:00Z' }))
    addPath(path.join(queueDir, 'my-clip-youtube', 'media.mp4'))

    const items = await getPendingItems()
    const groups = await getGroupedPendingItems()

    expect(items.map((item) => item.id)).toEqual(['my-clip-youtube', 'my-clip-tiktok'])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((item) => item.id)).toEqual(['my-clip-youtube', 'my-clip-tiktok'])
  })

  it('updateItem maps metadata updates to queueStore and preserves immutable fields', async () => {
    seedRow(rowFromInsert({
      id: 'clip-youtube',
      platform: 'youtube',
      account_id: 'acc-1',
      source_video: '/recordings/my-video',
      source_clip: null,
      clip_type: 'short',
      source_media_path: '/media/short.mp4',
      hashtags: ['#old'],
      links: [],
      character_count: 100,
      platform_char_limit: 5000,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Old content',
      media_folder_path: null,
    }))

    const updated = await updateItem('clip-youtube', {
      postContent: 'New content',
      metadata: {
        hashtags: ['#new'],
        scheduledFor: '2026-03-01T10:00:00Z',
        sourceVideo: '/recordings/other-video',
      },
    })

    expect(mockUpdateQueueItem).toHaveBeenCalledWith('clip-youtube', expect.objectContaining({
      post_content: 'New content',
      hashtags: ['#new'],
      scheduled_for: '2026-03-01T10:00:00Z',
    }))
    expect(updated).not.toBeNull()
    expect(updated!.metadata.sourceVideo).toBe('/recordings/my-video')
    expect(updated!.postContent).toBe('New content')
  })

  it('approveItem marks rows published, moves media folders, and updates media_folder_path', async () => {
    seedRow(rowFromInsert({
      id: 'clip-youtube',
      platform: 'youtube',
      account_id: 'acc-1',
      source_video: '/recordings/my-video',
      source_clip: null,
      clip_type: 'short',
      source_media_path: '/media/short.mp4',
      hashtags: ['#test'],
      links: [],
      character_count: 100,
      platform_char_limit: 5000,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Post content',
      media_folder_path: path.join(queueDir, 'clip-youtube'),
    }))
    addPath(path.join(queueDir, 'clip-youtube'))
    addPath(path.join(queueDir, 'clip-youtube', 'media.mp4'))

    await approveItem('clip-youtube', {
      latePostId: 'late-123',
      scheduledFor: '2026-02-01T19:00:00Z',
      publishedUrl: 'https://youtube.com/watch?v=abc',
    })

    expect(mockMarkPublished).toHaveBeenCalledWith('clip-youtube', expect.objectContaining({ latePostId: 'late-123' }))
    expect(mockRenameFile).toHaveBeenCalledWith(path.join(queueDir, 'clip-youtube'), path.join(publishedDir, 'clip-youtube'))
    expect(mockUpdateQueueItem).toHaveBeenCalledWith('clip-youtube', { media_folder_path: path.join(publishedDir, 'clip-youtube') })

    const approved = await getItem('clip-youtube')
    expect(approved!.metadata.status).toBe('published')
    expect(approved!.folderPath).toBe(path.join(publishedDir, 'clip-youtube'))
  })

  it('approveItem falls back to copy+delete on EPERM rename failures', async () => {
    seedRow(rowFromInsert({
      id: 'clip-tiktok',
      platform: 'tiktok',
      account_id: 'acc-1',
      source_video: '/recordings/my-video',
      source_clip: null,
      clip_type: 'short',
      source_media_path: '/media/short.mp4',
      hashtags: [],
      links: [],
      character_count: 80,
      platform_char_limit: 2200,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Post',
      media_folder_path: path.join(queueDir, 'clip-tiktok'),
    }))
    addPath(path.join(queueDir, 'clip-tiktok'))
    addPath(path.join(queueDir, 'clip-tiktok', 'media.mp4'))
    mockRenameFile.mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }))

    await approveItem('clip-tiktok', {
      latePostId: 'late-456',
      scheduledFor: '2026-02-01T19:00:00Z',
    })

    expect(mockCopyDirectory).toHaveBeenCalledWith(path.join(queueDir, 'clip-tiktok'), path.join(publishedDir, 'clip-tiktok'))
    expect(mockRemoveDirectory).toHaveBeenCalledWith(path.join(queueDir, 'clip-tiktok'), { recursive: true, force: true })
  })

  it('approveBulk continues after individual failures', async () => {
    seedRow(rowFromInsert({
      id: 'good-item-youtube',
      platform: 'youtube',
      account_id: 'acc',
      source_video: 'video',
      source_clip: null,
      clip_type: 'video',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 0,
      platform_char_limit: 0,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Post',
      media_folder_path: null,
    }))

    const publishData = new Map([
      ['../bad-item', { latePostId: 'l1', scheduledFor: '2026-02-01T19:00:00Z' }],
      ['good-item-youtube', { latePostId: 'l2', scheduledFor: '2026-02-01T20:00:00Z' }],
    ])

    const results = await approveBulk(['../bad-item', 'good-item-youtube'], publishData)
    expect(results).toHaveLength(1)
    expect(results[0].itemId).toBe('good-item-youtube')
  })

  it('rejectItem deletes the row and removes tracked media folders', async () => {
    seedRow(rowFromInsert({
      id: 'clip-instagram',
      platform: 'instagram',
      account_id: 'acc-1',
      source_video: 'video',
      source_clip: null,
      clip_type: 'video',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 0,
      platform_char_limit: 2200,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Post',
      media_folder_path: path.join(queueDir, 'clip-instagram'),
    }))
    addPath(path.join(queueDir, 'clip-instagram'))

    await rejectItem('clip-instagram')

    expect(mockDeleteQueueItem).toHaveBeenCalledWith('clip-instagram')
    expect(mockRemoveDirectory).toHaveBeenCalledWith(path.join(queueDir, 'clip-instagram'), { recursive: true })
    expect(await itemExists('clip-instagram')).toBeNull()
  })

  it('itemExists maps pending_review to pending and getPublishedItems returns published rows', async () => {
    seedRow(rowFromInsert({
      id: 'pending-item',
      platform: 'youtube',
      account_id: 'acc',
      source_video: 'video',
      source_clip: null,
      clip_type: 'video',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 0,
      platform_char_limit: 0,
      suggested_slot: null,
      scheduled_for: null,
      status: 'pending_review',
      late_post_id: null,
      published_url: null,
      post_content: 'Pending',
      media_folder_path: null,
    }))
    seedRow(rowFromInsert({
      id: 'published-item',
      platform: 'linkedin',
      account_id: 'acc',
      source_video: 'video',
      source_clip: null,
      clip_type: 'video',
      source_media_path: null,
      hashtags: [],
      links: [],
      character_count: 0,
      platform_char_limit: 0,
      suggested_slot: null,
      scheduled_for: '2026-02-02T10:00:00Z',
      status: 'published',
      late_post_id: 'late-x',
      published_url: null,
      post_content: 'Published',
      media_folder_path: null,
    }))

    expect(await itemExists('pending-item')).toBe('pending')
    expect(await itemExists('published-item')).toBe('published')

    const publishedItems = await getPublishedItems()
    expect(publishedItems).toHaveLength(1)
    expect(publishedItems[0].id).toBe('published-item')
  })
})

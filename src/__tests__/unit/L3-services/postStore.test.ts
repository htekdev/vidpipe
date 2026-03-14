import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import tmp from 'tmp'

import type { QueueItemInsert, QueueItemRow } from '../../../L2-clients/dataStore/queueStore.js'

const tmpDirObj = tmp.dirSync({ prefix: 'vidpipe-poststore-', unsafeCleanup: false })
const tmpDir = tmpDirObj.name

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  sanitizeForLog: vi.fn((value) => String(value)),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: tmpDir }),
}))

const queueState = vi.hoisted(() => ({
  rows: new Map<string, QueueItemRow>(),
}))

const mockGetQueueItem = vi.hoisted(() => vi.fn())
const mockGetItemsByStatus = vi.hoisted(() => vi.fn())
const mockInsertQueueItem = vi.hoisted(() => vi.fn())
const mockUpdateQueueItem = vi.hoisted(() => vi.fn())
const mockMarkPublished = vi.hoisted(() => vi.fn())
const mockDeleteQueueItem = vi.hoisted(() => vi.fn())
const mockItemExists = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/queueStore.js', () => ({
  getQueueItem: mockGetQueueItem,
  getItemsByStatus: mockGetItemsByStatus,
  insertQueueItem: mockInsertQueueItem,
  updateQueueItem: mockUpdateQueueItem,
  markPublished: mockMarkPublished,
  deleteQueueItem: mockDeleteQueueItem,
  itemExists: mockItemExists,
}))

const { mockRenameFile } = vi.hoisted(() => ({
  mockRenameFile: vi.fn() as ReturnType<typeof vi.fn>,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../L1-infra/fileSystem/fileSystem.js')>()
  mockRenameFile.mockImplementation(mod.renameFile)
  return { ...mod, renameFile: mockRenameFile }
})

import {
  approveItem,
  createItem,
  getGroupedPendingItems,
  getItem,
  getPendingItems,
  itemExists,
  rejectItem,
  updateItem,
  type QueueItemMetadata,
} from '../../../L3-services/postStore/postStore.js'

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item-1',
    platform: 'twitter',
    accountId: 'acct-123',
    sourceVideo: 'my-video',
    sourceClip: null,
    clipType: 'video',
    sourceMediaPath: null,
    hashtags: ['#dev'],
    links: [],
    characterCount: 42,
    platformCharLimit: 280,
    suggestedSlot: null,
    scheduledFor: null,
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: new Date().toISOString(),
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
    created_at: overrides.created_at ?? new Date().toISOString(),
    reviewed_at: overrides.reviewed_at ?? null,
    published_at: overrides.published_at ?? null,
  }
}

function seedRow(row: QueueItemRow): void {
  queueState.rows.set(row.id, row)
}

function applyQueueStoreMocks(): void {
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

    const timestamp = new Date().toISOString()
    queueState.rows.set(id, {
      ...existing,
      status: 'published',
      late_post_id: publishData.latePostId,
      scheduled_for: publishData.scheduledFor,
      published_url: publishData.publishedUrl ?? null,
      account_id: publishData.accountId ?? existing.account_id,
      reviewed_at: timestamp,
      published_at: timestamp,
    })
  })
  mockDeleteQueueItem.mockImplementation((id: string) => {
    queueState.rows.delete(id)
  })
  mockItemExists.mockImplementation((id: string) => queueState.rows.get(id)?.status ?? null)
}

describe('postStore', () => {
  beforeEach(async () => {
    queueState.rows.clear()
    mockRenameFile.mockClear()
    applyQueueStoreMocks()
    await fs.mkdir(tmpDir, { recursive: true })
  })

  afterEach(async () => {
    const entries = await fs.readdir(tmpDir)
    await Promise.all(entries.map((entry) => fs.rm(path.join(tmpDir, entry), { recursive: true, force: true })))
  })

  afterAll(() => {
    tmpDirObj.removeCallback()
  })

  describe('createItem', () => {
    it('stores metadata and post content in queueStore for text-only items', async () => {
      const meta = makeMetadata({ id: 'create-1' })
      const item = await createItem('create-1', meta, 'Hello world')

      expect(item.id).toBe('create-1')
      expect(item.postContent).toBe('Hello world')
      expect(item.hasMedia).toBe(false)
      expect(queueState.rows.get('create-1')?.post_content).toBe('Hello world')
      expect(queueState.rows.get('create-1')?.media_folder_path).toBeNull()
      await expect(fs.access(path.join(item.folderPath, 'post.md'))).rejects.toBeDefined()
    })

    it('copies media file and stores media_folder_path when provided', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.mp4', mode: 0o600 })
      await fs.writeFile(mediaTmpFile.name, 'fake-video-bytes')

      const meta = makeMetadata({ id: 'create-media' })
      const item = await createItem('create-media', meta, 'With video', mediaTmpFile.name)

      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.mp4')
      expect(queueState.rows.get('create-media')?.media_folder_path).toBe(item.folderPath)
      expect(await fs.readFile(item.mediaPath!, 'utf-8')).toBe('fake-video-bytes')
    })

    it('copies PNG image files with the correct extension', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.png', mode: 0o600 })
      await fs.writeFile(mediaTmpFile.name, 'fake-png-bytes')

      const meta = makeMetadata({ id: 'create-png', mediaType: 'image' })
      const item = await createItem('create-png', meta, 'With image', mediaTmpFile.name)

      expect(item.hasMedia).toBe(true)
      expect(item.mediaPath).toContain('media.png')
      expect(await fs.readFile(item.mediaPath!, 'utf-8')).toBe('fake-png-bytes')
    })
  })

  describe('getPendingItems', () => {
    it('returns rows from queueStore with media items first', async () => {
      const mediaFolder = path.join(tmpDir, 'publish-queue', 'has-media')
      await fs.mkdir(mediaFolder, { recursive: true })
      await fs.writeFile(path.join(mediaFolder, 'media.mp4'), 'video')

      seedRow(rowFromInsert({
        id: 'no-media',
        platform: 'twitter',
        account_id: 'acct-1',
        source_video: 'video-a',
        source_clip: null,
        clip_type: 'video',
        source_media_path: null,
        hashtags: [],
        links: [],
        character_count: 10,
        platform_char_limit: 280,
        suggested_slot: null,
        scheduled_for: null,
        status: 'pending_review',
        late_post_id: null,
        published_url: null,
        post_content: 'A',
        media_folder_path: null,
      }, { created_at: '2025-01-01T00:00:00.000Z' }))
      seedRow(rowFromInsert({
        id: 'has-media',
        platform: 'youtube',
        account_id: 'acct-2',
        source_video: 'video-b',
        source_clip: 'clip-b',
        clip_type: 'short',
        source_media_path: null,
        media_type: 'video',
        hashtags: [],
        links: [],
        character_count: 20,
        platform_char_limit: 5000,
        suggested_slot: null,
        scheduled_for: null,
        status: 'pending_review',
        late_post_id: null,
        published_url: null,
        post_content: 'B',
        media_folder_path: mediaFolder,
      }, { created_at: '2025-01-02T00:00:00.000Z' }))

      const items = await getPendingItems()
      expect(items.map((item) => item.id)).toEqual(['has-media', 'no-media'])
      expect(items[0].mediaPath).toBe(path.join(mediaFolder, 'media.mp4'))
    })
  })

  describe('getGroupedPendingItems', () => {
    it('groups pending items by source video and clip slug', async () => {
      seedRow(rowFromInsert({
        id: 'my-clip-youtube',
        platform: 'youtube',
        account_id: 'acct-1',
        source_video: 'recording-1',
        source_clip: 'my-clip',
        clip_type: 'short',
        source_media_path: null,
        hashtags: [],
        links: [],
        character_count: 10,
        platform_char_limit: 5000,
        suggested_slot: null,
        scheduled_for: null,
        status: 'pending_review',
        late_post_id: null,
        published_url: null,
        post_content: 'YT',
        media_folder_path: null,
      }, { created_at: '2025-01-01T00:00:00.000Z' }))
      seedRow(rowFromInsert({
        id: 'my-clip-tiktok',
        platform: 'tiktok',
        account_id: 'acct-2',
        source_video: 'recording-1',
        source_clip: 'my-clip',
        clip_type: 'short',
        source_media_path: null,
        hashtags: [],
        links: [],
        character_count: 10,
        platform_char_limit: 2200,
        suggested_slot: null,
        scheduled_for: null,
        status: 'pending_review',
        late_post_id: null,
        published_url: null,
        post_content: 'TT',
        media_folder_path: null,
      }, { created_at: '2025-01-01T01:00:00.000Z' }))

      const groups = await getGroupedPendingItems()
      expect(groups).toHaveLength(1)
      expect(groups[0].items.map((item) => item.id)).toEqual(['my-clip-youtube', 'my-clip-tiktok'])
    })
  })

  describe('getItem', () => {
    it('returns null for non-existent items', async () => {
      expect(await getItem('does-not-exist')).toBeNull()
    })

    it('returns published items from queueStore', async () => {
      const mediaFolder = path.join(tmpDir, 'published', 'existing')
      await fs.mkdir(mediaFolder, { recursive: true })
      await fs.writeFile(path.join(mediaFolder, 'media.png'), 'image')

      seedRow(rowFromInsert({
        id: 'existing',
        platform: 'instagram',
        account_id: 'acct-1',
        source_video: 'video',
        source_clip: null,
        clip_type: 'video',
        source_media_path: null,
        media_type: 'image',
        hashtags: ['tag'],
        links: [],
        character_count: 50,
        platform_char_limit: 2200,
        suggested_slot: null,
        scheduled_for: '2025-06-01T12:00:00Z',
        status: 'published',
        late_post_id: 'late-1',
        published_url: 'https://example.com/post',
        post_content: 'Content',
        media_folder_path: mediaFolder,
      }, { created_at: '2025-01-01T00:00:00.000Z', published_at: '2025-06-01T12:30:00Z' }))

      const item = await getItem('existing')
      expect(item).not.toBeNull()
      expect(item!.metadata.status).toBe('published')
      expect(item!.mediaPath).toBe(path.join(mediaFolder, 'media.png'))
    })
  })

  describe('updateItem', () => {
    it('updates mutable metadata fields and post content', async () => {
      const meta = makeMetadata({ id: 'update-meta', sourceVideo: 'original-video' })
      await createItem('update-meta', meta, 'Original')

      const updated = await updateItem('update-meta', {
        postContent: 'Updated content',
        metadata: {
          scheduledFor: '2025-06-01T12:00:00Z',
          sourceVideo: 'changed-video',
          hashtags: ['#new'],
        },
      })

      expect(updated).not.toBeNull()
      expect(updated!.postContent).toBe('Updated content')
      expect(updated!.metadata.scheduledFor).toBe('2025-06-01T12:00:00Z')
      expect(updated!.metadata.hashtags).toEqual(['#new'])
      expect(updated!.metadata.sourceVideo).toBe('original-video')
    })

    it('returns null when the item does not exist', async () => {
      expect(await updateItem('missing', { postContent: 'x' })).toBeNull()
    })
  })

  describe('approveItem', () => {
    it('marks the row published and moves media folders to published', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.mp4', mode: 0o600 })
      await fs.writeFile(mediaTmpFile.name, 'approve-bytes')
      const meta = makeMetadata({ id: 'approve-1', clipType: 'short' })
      await createItem('approve-1', meta, 'Approve me', mediaTmpFile.name)

      await approveItem('approve-1', {
        latePostId: 'late-abc',
        scheduledFor: '2025-06-01T12:00:00Z',
      })

      const approved = await getItem('approve-1')
      expect(approved).not.toBeNull()
      expect(approved!.metadata.status).toBe('published')
      expect(approved!.metadata.latePostId).toBe('late-abc')
      expect(approved!.folderPath).toBe(path.join(tmpDir, 'published', 'approve-1'))
      expect(await fs.readFile(path.join(approved!.folderPath, 'media.mp4'), 'utf-8')).toBe('approve-bytes')
    })

    it('falls back to copy+delete when rename fails with EPERM', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.mp4', mode: 0o600 })
      await fs.writeFile(mediaTmpFile.name, 'fallback-bytes')
      const meta = makeMetadata({ id: 'approve-eperm', clipType: 'short' })
      const item = await createItem('approve-eperm', meta, 'EPERM test', mediaTmpFile.name)

      mockRenameFile.mockRejectedValueOnce(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }))

      await approveItem('approve-eperm', {
        latePostId: 'late-eperm',
        scheduledFor: '2025-07-01T12:00:00Z',
      })

      expect(await fs.access(item.folderPath).then(() => true).catch(() => false)).toBe(false)
      expect(await fs.readFile(path.join(tmpDir, 'published', 'approve-eperm', 'media.mp4'), 'utf-8')).toBe('fallback-bytes')
    })
  })

  describe('rejectItem', () => {
    it('deletes the DB row and removes any media folder', async () => {
      const mediaTmpFile = tmp.fileSync({ dir: tmpDir, postfix: '.png', mode: 0o600 })
      await fs.writeFile(mediaTmpFile.name, 'image-bytes')
      const meta = makeMetadata({ id: 'reject-1', mediaType: 'image' })
      const item = await createItem('reject-1', meta, 'Reject me', mediaTmpFile.name)

      await rejectItem('reject-1')

      expect(await itemExists('reject-1')).toBeNull()
      expect(await fs.access(item.folderPath).then(() => true).catch(() => false)).toBe(false)
    })
  })

  describe('itemExists', () => {
    it('maps pending_review rows to pending', async () => {
      const meta = makeMetadata({ id: 'exists-pending' })
      await createItem('exists-pending', meta, 'Pending')
      expect(await itemExists('exists-pending')).toBe('pending')
    })

    it('returns published for published rows', async () => {
      seedRow(rowFromInsert({
        id: 'exists-pub',
        platform: 'youtube',
        account_id: 'acct',
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
        status: 'published',
        late_post_id: 'late-x',
        published_url: null,
        post_content: 'Pub',
        media_folder_path: null,
      }))

      expect(await itemExists('exists-pub')).toBe('published')
    })
  })

  describe('media path detection', () => {
    it('prefers media.mp4 over media.png', async () => {
      const mediaFolder = path.join(tmpDir, 'publish-queue', 'both-media')
      await fs.mkdir(mediaFolder, { recursive: true })
      await fs.writeFile(path.join(mediaFolder, 'media.mp4'), 'video')
      await fs.writeFile(path.join(mediaFolder, 'media.png'), 'image')

      seedRow(rowFromInsert({
        id: 'both-media',
        platform: 'youtube',
        account_id: 'acct',
        source_video: 'video',
        source_clip: null,
        clip_type: 'video',
        source_media_path: null,
        media_type: 'video',
        hashtags: [],
        links: [],
        character_count: 0,
        platform_char_limit: 0,
        suggested_slot: null,
        scheduled_for: null,
        status: 'pending_review',
        late_post_id: null,
        published_url: null,
        post_content: 'Both media',
        media_folder_path: mediaFolder,
      }))

      const item = await getItem('both-media')
      expect(item).not.toBeNull()
      expect(item!.mediaPath).toBe(path.join(mediaFolder, 'media.mp4'))
    })
  })

  describe('validateId', () => {
    it('rejects invalid IDs', async () => {
      await expect(getItem('../etc/passwd')).rejects.toThrow('Invalid ID format')
      await expect(getItem('')).rejects.toThrow('Invalid ID format')
      await expect(getItem('foo.bar')).rejects.toThrow('Invalid ID format')
      await expect(getItem('foo/bar')).rejects.toThrow('Invalid ID format')
    })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from '../../../L1-infra/database/index.js'
import {
  countByStatus,
  deleteQueueItem,
  getItemsBySourceVideo,
  getItemsByStatus,
  getQueueItem,
  insertQueueItem,
  itemExists,
  markPublished,
  updateQueueItem,
} from '../../../L2-clients/dataStore/queueStore.js'
import type { QueueItemInsert } from '../../../L2-clients/dataStore/queueStore.js'

function createItem(overrides: Partial<QueueItemInsert> = {}): QueueItemInsert {
  return {
    id: 'item-1',
    platform: 'youtube',
    account_id: 'acct-1',
    source_video: 'recordings/demo/video.mp4',
    source_clip: 'clips/demo-short.mp4',
    clip_type: 'short',
    source_media_path: 'publish/demo-short.mp4',
    media_type: 'video',
    hashtags: ['vidpipe', 'demo'],
    links: [{ url: 'https://example.com', title: 'Example' }],
    character_count: 120,
    platform_char_limit: 280,
    suggested_slot: '2026-02-14T10:00:00Z',
    scheduled_for: null,
    status: 'pending_review',
    late_post_id: null,
    published_url: null,
    post_content: 'A test post',
    text_only: false,
    platform_specific: { thumbnailStyle: 'portrait' },
    media_folder_path: 'publish/shorts/demo',
    ...overrides,
  }
}

describe('queueStore', () => {
  beforeEach(() => {
    closeDatabase()
    initializeDatabase({ inMemory: true })
  })

  it('inserts and reads a queue item with serialized JSON fields', () => {
    insertQueueItem(createItem())

    const result = getQueueItem('item-1')
    expect(result).toBeDefined()
    expect(result).toMatchObject({
      id: 'item-1',
      media_type: 'video',
      status: 'pending_review',
      text_only: 0,
    })
    expect(result?.hashtags).toBe(JSON.stringify(['vidpipe', 'demo']))
    expect(result?.links).toBe(JSON.stringify([{ url: 'https://example.com', title: 'Example' }]))
    expect(result?.platform_specific).toBe(JSON.stringify({ thumbnailStyle: 'portrait' }))
    expect(itemExists('item-1')).toBe('pending_review')
  })

  it('orders status results with media folders first', () => {
    insertQueueItem(createItem({ id: 'item-a', media_folder_path: null, source_clip: null }))
    insertQueueItem(createItem({ id: 'item-b', media_folder_path: 'publish/has-media', source_clip: null }))

    const results = getItemsByStatus('pending_review')
    expect(results.map((item) => item.id)).toEqual(['item-b', 'item-a'])
  })

  it('updates only provided fields and reserializes JSON values', () => {
    insertQueueItem(createItem())

    updateQueueItem('item-1', {
      hashtags: ['updated'],
      links: [{ url: 'https://github.com' }],
      platform_specific: { audience: 'developers' },
      text_only: true,
      media_type: undefined,
      post_content: 'Updated content',
      scheduled_for: '2026-02-14T12:00:00Z',
    })

    const result = getQueueItem('item-1')
    expect(result).toMatchObject({
      post_content: 'Updated content',
      scheduled_for: '2026-02-14T12:00:00Z',
      text_only: 1,
      media_type: null,
    })
    expect(result?.hashtags).toBe(JSON.stringify(['updated']))
    expect(result?.links).toBe(JSON.stringify([{ url: 'https://github.com' }]))
    expect(result?.platform_specific).toBe(JSON.stringify({ audience: 'developers' }))
  })

  it('marks items as published and stamps publication metadata', () => {
    insertQueueItem(createItem({ account_id: '', scheduled_for: null }))

    markPublished('item-1', {
      latePostId: 'late-123',
      scheduledFor: '2026-02-15T09:30:00Z',
      publishedUrl: 'https://late.example/post/late-123',
      accountId: 'acct-published',
    })

    const result = getQueueItem('item-1')
    expect(result).toMatchObject({
      status: 'published',
      late_post_id: 'late-123',
      scheduled_for: '2026-02-15T09:30:00Z',
      published_url: 'https://late.example/post/late-123',
      account_id: 'acct-published',
    })
    expect(result?.published_at).toBeTruthy()
    expect(result?.reviewed_at).toBeTruthy()
  })

  it('finds items by source video, counts statuses, and deletes rows', () => {
    insertQueueItem(createItem({ id: 'item-1', status: 'pending_review' }))
    insertQueueItem(createItem({ id: 'item-2', status: 'published', scheduled_for: '2026-02-15T09:30:00Z' }))
    insertQueueItem(createItem({ id: 'item-3', source_video: 'recordings/demo/other.mp4' }))

    const sameVideo = getItemsBySourceVideo('recordings/demo/video.mp4')
    expect(sameVideo.map((item) => item.id)).toEqual(['item-1', 'item-2'])
    expect(countByStatus()).toEqual({ pending_review: 2, published: 1 })

    deleteQueueItem('item-2')
    expect(getQueueItem('item-2')).toBeUndefined()
    expect(itemExists('item-2')).toBeNull()
    expect(countByStatus()).toEqual({ pending_review: 2, published: 0 })
  })
})

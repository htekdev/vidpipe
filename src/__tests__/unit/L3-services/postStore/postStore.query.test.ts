import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { QueueItemMetadata } from '../../../../L3-services/postStore/postStore.js'

let outputDir = ''
let postStore: typeof import('../../../../L3-services/postStore/postStore.js')

function makeMetadata(overrides: Partial<QueueItemMetadata> = {}): QueueItemMetadata {
  return {
    id: 'test-item',
    platform: 'youtube',
    accountId: 'account-1',
    sourceVideo: 'video-auto-note-taker',
    sourceClip: null,
    clipType: 'short',
    sourceMediaPath: null,
    hashtags: [],
    links: [],
    characterCount: 120,
    platformCharLimit: 5000,
    suggestedSlot: null,
    scheduledFor: '2026-03-14T12:00:00.000Z',
    status: 'pending_review',
    latePostId: null,
    publishedUrl: null,
    createdAt: '2026-03-14T10:00:00.000Z',
    reviewedAt: null,
    publishedAt: null,
    ...overrides,
  }
}

async function writeStoredItem(
  store: 'publish-queue' | 'published',
  overrides: Partial<QueueItemMetadata>,
  postContent = 'Post content',
): Promise<void> {
  const metadata = makeMetadata({
    status: store === 'published' ? 'published' : 'pending_review',
    ...overrides,
  })
  const folderPath = join(outputDir, store, metadata.id)

  await mkdir(folderPath, { recursive: true })
  await writeFile(join(folderPath, 'metadata.json'), JSON.stringify(metadata, null, 2))
  await writeFile(join(folderPath, 'post.md'), postContent)
}

describe('postStore query helpers', () => {
  beforeAll(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'vidpipe-poststore-query-'))
    vi.stubEnv('OUTPUT_DIR', outputDir)
    vi.resetModules()
    postStore = await import('../../../../L3-services/postStore/postStore.js')
  })

  beforeEach(async () => {
    await rm(join(outputDir, 'publish-queue'), { recursive: true, force: true })
    await rm(join(outputDir, 'published'), { recursive: true, force: true })
    await mkdir(join(outputDir, 'publish-queue'), { recursive: true })
    await mkdir(join(outputDir, 'published'), { recursive: true })
  })

  afterAll(async () => {
    vi.unstubAllEnvs()
    await rm(outputDir, { recursive: true, force: true })
  })

  it('returns items matching any provided ideaId', async () => {
    await writeStoredItem('publish-queue', {
      id: 'pending-match',
      ideaIds: ['idea-1', 'idea-2'],
    })
    await writeStoredItem('publish-queue', {
      id: 'pending-no-match',
      ideaIds: ['idea-9'],
    })

    const items = await postStore.getScheduledItemsByIdeaIds(['idea-2', 'idea-3'])

    expect(items.map(item => item.id)).toEqual(['pending-match'])
  })

  it('returns empty array when no matches exist', async () => {
    await writeStoredItem('publish-queue', {
      id: 'pending-no-match',
      ideaIds: ['idea-9'],
    })
    await writeStoredItem('published', {
      id: 'published-no-match',
      ideaIds: ['idea-8'],
      latePostId: 'late-8',
    })

    const items = await postStore.getScheduledItemsByIdeaIds(['idea-1'])

    expect(items).toEqual([])
  })

  it('returns empty array for empty ideaIds input', async () => {
    await writeStoredItem('publish-queue', {
      id: 'pending-match',
      ideaIds: ['idea-1'],
    })
    await writeStoredItem('published', {
      id: 'published-match',
      ideaIds: ['idea-1'],
      latePostId: 'late-1',
    })

    const items = await postStore.getScheduledItemsByIdeaIds([])

    expect(items).toEqual([])
  })

  it('includes both pending and published items', async () => {
    await writeStoredItem('publish-queue', {
      id: 'pending-match',
      ideaIds: ['shared-idea'],
      createdAt: '2026-03-14T08:00:00.000Z',
    })
    await writeStoredItem('published', {
      id: 'published-match',
      ideaIds: ['shared-idea'],
      latePostId: 'late-shared',
      createdAt: '2026-03-14T09:00:00.000Z',
    })

    const items = await postStore.getScheduledItemsByIdeaIds(['shared-idea'])

    expect(items.map(item => item.id)).toEqual(['pending-match', 'published-match'])
  })

  it('returns matching published item by Late post ID', async () => {
    await writeStoredItem('published', {
      id: 'published-target',
      latePostId: 'late-target',
      ideaIds: ['idea-1'],
    })
    await writeStoredItem('published', {
      id: 'published-other',
      latePostId: 'late-other',
    })

    const item = await postStore.getPublishedItemByLatePostId('late-target')

    expect(item).not.toBeNull()
    expect(item?.id).toBe('published-target')
  })

  it('returns null when no published item matches the Late post ID', async () => {
    await writeStoredItem('publish-queue', {
      id: 'pending-same-id',
      latePostId: 'late-target',
      ideaIds: ['idea-1'],
    })
    await writeStoredItem('published', {
      id: 'published-other',
      latePostId: 'late-other',
    })

    const item = await postStore.getPublishedItemByLatePostId('late-target')

    expect(item).toBeNull()
  })
})

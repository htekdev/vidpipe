import { getConfig } from '../config/environment'
import logger from '../config/logger'
import { promises as fs } from 'fs'
import path from 'path'

export interface QueueItemMetadata {
  id: string
  platform: string
  accountId: string
  sourceVideo: string
  sourceClip: string | null
  clipType: 'video' | 'short' | 'medium-clip'
  sourceMediaPath: string | null
  hashtags: string[]
  links: Array<{ url: string; title?: string }>
  characterCount: number
  platformCharLimit: number
  suggestedSlot: string | null
  scheduledFor: string | null
  status: 'pending_review' | 'published'
  latePostId: string | null
  publishedUrl: string | null
  createdAt: string
  reviewedAt: string | null
  publishedAt: string | null
  platformSpecificData?: Record<string, unknown>
}

export interface QueueItem {
  id: string
  metadata: QueueItemMetadata
  postContent: string
  hasMedia: boolean
  mediaPath: string | null
  folderPath: string
}

function getQueueDir(): string {
  const { OUTPUT_DIR } = getConfig()
  return path.join(OUTPUT_DIR, 'publish-queue')
}

function getPublishedDir(): string {
  const { OUTPUT_DIR } = getConfig()
  return path.join(OUTPUT_DIR, 'published')
}

async function readQueueItem(folderPath: string, id: string): Promise<QueueItem | null> {
  const metadataPath = path.join(folderPath, 'metadata.json')
  const postPath = path.join(folderPath, 'post.md')
  const mediaPath = path.join(folderPath, 'media.mp4')

  try {
    await fs.access(metadataPath)
  } catch {
    logger.debug(`Skipping ${id}: no metadata.json found`)
    return null
  }

  try {
    const metadataRaw = await fs.readFile(metadataPath, 'utf-8')
    const metadata: QueueItemMetadata = JSON.parse(metadataRaw)

    let postContent = ''
    try {
      postContent = await fs.readFile(postPath, 'utf-8')
    } catch {
      logger.debug(`No post.md found for ${id}`)
    }

    let hasMedia = false
    try {
      await fs.access(mediaPath)
      hasMedia = true
    } catch {
      // no media file
    }

    return {
      id,
      metadata,
      postContent,
      hasMedia,
      mediaPath: hasMedia ? mediaPath : null,
      folderPath,
    }
  } catch (err) {
    logger.debug(`Failed to read queue item ${id}: ${err}`)
    return null
  }
}

export async function getPendingItems(): Promise<QueueItem[]> {
  const queueDir = getQueueDir()
  await fs.mkdir(queueDir, { recursive: true })

  let entries: string[]
  try {
    const dirents = await fs.readdir(queueDir, { withFileTypes: true })
    entries = dirents.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }

  const items: QueueItem[] = []
  for (const name of entries) {
    const item = await readQueueItem(path.join(queueDir, name), name)
    if (item) items.push(item)
  }

  items.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt))
  return items
}

export async function getItem(id: string): Promise<QueueItem | null> {
  const folderPath = path.join(getQueueDir(), id)
  return readQueueItem(folderPath, id)
}

export async function createItem(
  id: string,
  metadata: QueueItemMetadata,
  postContent: string,
  mediaSourcePath?: string,
): Promise<QueueItem> {
  const folderPath = path.join(getQueueDir(), id)
  await fs.mkdir(folderPath, { recursive: true })

  await fs.writeFile(path.join(folderPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
  await fs.writeFile(path.join(folderPath, 'post.md'), postContent, 'utf-8')

  let hasMedia = false
  const mediaPath = path.join(folderPath, 'media.mp4')

  if (mediaSourcePath) {
    await fs.copyFile(mediaSourcePath, mediaPath)
    hasMedia = true
  }

  logger.debug(`Created queue item: ${id}`)

  return {
    id,
    metadata,
    postContent,
    hasMedia,
    mediaPath: hasMedia ? mediaPath : null,
    folderPath,
  }
}

export async function updateItem(
  id: string,
  updates: { postContent?: string; metadata?: Partial<QueueItemMetadata> },
): Promise<QueueItem | null> {
  const existing = await getItem(id)
  if (!existing) return null

  if (updates.metadata) {
    existing.metadata = { ...existing.metadata, ...updates.metadata }
    await fs.writeFile(
      path.join(existing.folderPath, 'metadata.json'),
      JSON.stringify(existing.metadata, null, 2),
      'utf-8',
    )
  }

  if (updates.postContent !== undefined) {
    existing.postContent = updates.postContent
    await fs.writeFile(path.join(existing.folderPath, 'post.md'), updates.postContent, 'utf-8')
  }

  logger.debug(`Updated queue item: ${id}`)
  return existing
}

export async function approveItem(
  id: string,
  publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string },
): Promise<void> {
  const item = await getItem(id)
  if (!item) return

  const now = new Date().toISOString()
  item.metadata.status = 'published'
  item.metadata.latePostId = publishData.latePostId
  item.metadata.scheduledFor = publishData.scheduledFor
  item.metadata.publishedUrl = publishData.publishedUrl ?? null
  item.metadata.publishedAt = now
  item.metadata.reviewedAt = now

  await fs.writeFile(
    path.join(item.folderPath, 'metadata.json'),
    JSON.stringify(item.metadata, null, 2),
    'utf-8',
  )

  const publishedDir = getPublishedDir()
  const destPath = path.join(publishedDir, id)
  await fs.mkdir(publishedDir, { recursive: true })
  await fs.rename(item.folderPath, destPath)

  logger.debug(`Approved and moved queue item: ${id}`)
}

export async function rejectItem(id: string): Promise<void> {
  const folderPath = path.join(getQueueDir(), id)
  try {
    await fs.rm(folderPath, { recursive: true })
    logger.debug(`Rejected and deleted queue item: ${id}`)
  } catch (err) {
    logger.debug(`Failed to reject queue item ${id}: ${err}`)
  }
}

export async function getPublishedItems(): Promise<QueueItem[]> {
  const publishedDir = getPublishedDir()
  await fs.mkdir(publishedDir, { recursive: true })

  let entries: string[]
  try {
    const dirents = await fs.readdir(publishedDir, { withFileTypes: true })
    entries = dirents.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }

  const items: QueueItem[] = []
  for (const name of entries) {
    const item = await readQueueItem(path.join(publishedDir, name), name)
    if (item) items.push(item)
  }

  items.sort((a, b) => a.metadata.createdAt.localeCompare(b.metadata.createdAt))
  return items
}

export async function itemExists(id: string): Promise<'pending' | 'published' | null> {
  try {
    await fs.access(path.join(getQueueDir(), id))
    return 'pending'
  } catch {
    // not in queue
  }

  try {
    await fs.access(path.join(getPublishedDir(), id))
    return 'published'
  } catch {
    // not published
  }

  return null
}

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
  textOnly?: boolean
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
    // Read directly without prior existence check to avoid TOCTOU race
    const metadataRaw = await fs.readFile(metadataPath, 'utf-8')
    const metadata: QueueItemMetadata = JSON.parse(metadataRaw)

    let postContent = ''
    try {
      postContent = await fs.readFile(postPath, 'utf-8')
    } catch {
      logger.debug(`No post.md found for ${String(id).replace(/[\r\n]/g, '')}`)
    }

    let hasMedia = false
    const mediaFilePath = path.join(folderPath, 'media.mp4')
    try {
      await fs.access(mediaFilePath)
      hasMedia = true
    } catch {
      // no media file
    }

    return {
      id,
      metadata,
      postContent,
      hasMedia,
      mediaPath: hasMedia ? mediaFilePath : null,
      folderPath,
    }
  } catch (err) {
    logger.debug(`Failed to read queue item ${String(id).replace(/[\r\n]/g, '')}: ${String(err).replace(/[\r\n]/g, '')}`)
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

  // Sort: items with media first (shorts/clips), then text-only (video-level), then by date
  items.sort((a, b) => {
    if (a.hasMedia !== b.hasMedia) return a.hasMedia ? -1 : 1
    return a.metadata.createdAt.localeCompare(b.metadata.createdAt)
  })
  return items
}

export async function getItem(id: string): Promise<QueueItem | null> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const folderPath = path.join(getQueueDir(), path.basename(id))
  return readQueueItem(folderPath, id)
}

export async function createItem(
  id: string,
  metadata: QueueItemMetadata,
  postContent: string,
  mediaSourcePath?: string,
): Promise<QueueItem> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const folderPath = path.join(getQueueDir(), path.basename(id))
  await fs.mkdir(folderPath, { recursive: true })

  await fs.writeFile(path.join(folderPath, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8')
  await fs.writeFile(path.join(folderPath, 'post.md'), postContent, 'utf-8')

  let hasMedia = false
  const mediaPath = path.join(folderPath, 'media.mp4')

  if (mediaSourcePath) {
    await fs.copyFile(mediaSourcePath, mediaPath)
    hasMedia = true
  }

  logger.debug(`Created queue item: ${String(id).replace(/[\r\n]/g, '')}`)

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
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const existing = await getItem(id)
  if (!existing) return null

  if (updates.metadata) {
    // Sanitize metadata by re-constructing with only expected fields before writing
    const sanitized: QueueItemMetadata = {
      id: String(existing.metadata.id),
      platform: String(updates.metadata.platform ?? existing.metadata.platform),
      accountId: String(updates.metadata.accountId ?? existing.metadata.accountId),
      sourceVideo: String(existing.metadata.sourceVideo),
      sourceClip: existing.metadata.sourceClip !== null ? String(existing.metadata.sourceClip) : null,
      clipType: existing.metadata.clipType,
      sourceMediaPath: existing.metadata.sourceMediaPath !== null ? String(existing.metadata.sourceMediaPath) : null,
      hashtags: Array.isArray(updates.metadata.hashtags) ? updates.metadata.hashtags.map(String) : (Array.isArray(existing.metadata.hashtags) ? existing.metadata.hashtags.map(String) : []),
      links: Array.isArray(updates.metadata.links) ? updates.metadata.links : (Array.isArray(existing.metadata.links) ? existing.metadata.links : []),
      characterCount: updates.metadata.characterCount !== undefined ? Number(updates.metadata.characterCount) || 0 : (Number(existing.metadata.characterCount) || 0),
      platformCharLimit: updates.metadata.platformCharLimit !== undefined ? Number(updates.metadata.platformCharLimit) || 0 : (Number(existing.metadata.platformCharLimit) || 0),
      suggestedSlot: updates.metadata.suggestedSlot !== undefined ? (updates.metadata.suggestedSlot !== null ? String(updates.metadata.suggestedSlot) : null) : (existing.metadata.suggestedSlot !== null ? String(existing.metadata.suggestedSlot) : null),
      scheduledFor: updates.metadata.scheduledFor !== undefined ? (updates.metadata.scheduledFor !== null ? String(updates.metadata.scheduledFor) : null) : (existing.metadata.scheduledFor !== null ? String(existing.metadata.scheduledFor) : null),
      status: updates.metadata.status ?? existing.metadata.status,
      latePostId: updates.metadata.latePostId !== undefined ? (updates.metadata.latePostId !== null ? String(updates.metadata.latePostId) : null) : (existing.metadata.latePostId !== null ? String(existing.metadata.latePostId) : null),
      publishedUrl: updates.metadata.publishedUrl !== undefined ? (updates.metadata.publishedUrl !== null ? String(updates.metadata.publishedUrl) : null) : (existing.metadata.publishedUrl !== null ? String(existing.metadata.publishedUrl) : null),
      createdAt: String(existing.metadata.createdAt),
      reviewedAt: updates.metadata.reviewedAt !== undefined ? (updates.metadata.reviewedAt !== null ? String(updates.metadata.reviewedAt) : null) : (existing.metadata.reviewedAt !== null ? String(existing.metadata.reviewedAt) : null),
      publishedAt: updates.metadata.publishedAt !== undefined ? (updates.metadata.publishedAt !== null ? String(updates.metadata.publishedAt) : null) : (existing.metadata.publishedAt !== null ? String(existing.metadata.publishedAt) : null),
      textOnly: updates.metadata.textOnly ?? existing.metadata.textOnly,
      platformSpecificData: updates.metadata.platformSpecificData ?? existing.metadata.platformSpecificData,
    }
    // Use only the sanitized object — do not spread raw HTTP updates (CodeQL js/http-to-file-access)
    existing.metadata = sanitized
    // Validate write target is within the expected queue directory
    const metadataWritePath = path.resolve(path.join(existing.folderPath, 'metadata.json'))
    if (!metadataWritePath.startsWith(path.resolve(getQueueDir()) + path.sep)) {
      throw new Error('Write target outside queue directory')
    }
    await fs.writeFile(
      metadataWritePath,
      JSON.stringify(existing.metadata, null, 2),
      'utf-8',
    )
  }

  if (updates.postContent !== undefined) {
    // Sanitize post content - ensure it's a string
    const sanitizedContent = String(updates.postContent)
    existing.postContent = sanitizedContent
    // Validate write target is within the expected queue directory (CodeQL js/http-to-file-access)
    const postWritePath = path.resolve(path.join(existing.folderPath, 'post.md'))
    if (!postWritePath.startsWith(path.resolve(getQueueDir()) + path.sep)) {
      throw new Error('Write target outside queue directory')
    }
    await fs.writeFile(postWritePath, sanitizedContent, 'utf-8')
  }

  logger.debug(`Updated queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  return existing
}

export async function approveItem(
  id: string,
  publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string },
): Promise<void> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const item = await getItem(id)
  if (!item) return

  const now = new Date().toISOString()
  if (publishData.accountId) {
    item.metadata.accountId = String(publishData.accountId)
  }
  item.metadata.status = 'published'
  item.metadata.latePostId = String(publishData.latePostId)
  item.metadata.scheduledFor = String(publishData.scheduledFor)
  item.metadata.publishedUrl = publishData.publishedUrl ? String(publishData.publishedUrl) : null
  item.metadata.publishedAt = now
  item.metadata.reviewedAt = now

  // Sanitize metadata before writing - reconstruct with validated fields
  const sanitizedMetadata: QueueItemMetadata = {
    id: String(item.metadata.id),
    platform: String(item.metadata.platform),
    accountId: String(item.metadata.accountId),
    sourceVideo: String(item.metadata.sourceVideo),
    sourceClip: item.metadata.sourceClip !== null ? String(item.metadata.sourceClip) : null,
    clipType: item.metadata.clipType,
    sourceMediaPath: item.metadata.sourceMediaPath !== null ? String(item.metadata.sourceMediaPath) : null,
    hashtags: Array.isArray(item.metadata.hashtags) ? item.metadata.hashtags.map(String) : [],
    links: Array.isArray(item.metadata.links) ? item.metadata.links : [],
    characterCount: Number(item.metadata.characterCount) || 0,
    platformCharLimit: Number(item.metadata.platformCharLimit) || 0,
    suggestedSlot: item.metadata.suggestedSlot !== null ? String(item.metadata.suggestedSlot) : null,
    scheduledFor: item.metadata.scheduledFor !== null ? String(item.metadata.scheduledFor) : null,
    status: item.metadata.status,
    latePostId: item.metadata.latePostId !== null ? String(item.metadata.latePostId) : null,
    publishedUrl: item.metadata.publishedUrl !== null ? String(item.metadata.publishedUrl) : null,
    createdAt: String(item.metadata.createdAt),
    reviewedAt: item.metadata.reviewedAt !== null ? String(item.metadata.reviewedAt) : null,
    publishedAt: item.metadata.publishedAt !== null ? String(item.metadata.publishedAt) : null,
    textOnly: item.metadata.textOnly,
    platformSpecificData: item.metadata.platformSpecificData,
  }

  // Validate write target is within the expected queue directory (CodeQL js/http-to-file-access)
  const approveMetadataPath = path.resolve(path.join(item.folderPath, 'metadata.json'))
  if (!approveMetadataPath.startsWith(path.resolve(getQueueDir()) + path.sep)) {
    throw new Error('Write target outside queue directory')
  }
  await fs.writeFile(
    approveMetadataPath,
    JSON.stringify(sanitizedMetadata, null, 2),
    'utf-8',
  )

  const publishedDir = getPublishedDir()
  await fs.mkdir(publishedDir, { recursive: true })
  
  // Validate destination path to prevent path traversal - use path.basename inline
  const destPath = path.join(publishedDir, path.basename(id))
  const resolvedDest = path.resolve(destPath)
  const resolvedPublishedDir = path.resolve(publishedDir)
  if (!resolvedDest.startsWith(resolvedPublishedDir + path.sep) && resolvedDest !== resolvedPublishedDir) {
    throw new Error(`Invalid destination path for item ${id}`)
  }

  try {
    await fs.rename(item.folderPath, destPath)
  } catch (renameErr: unknown) {
    // On Windows, rename can fail with EPERM if a file handle is still releasing.
    // Fall back to recursive copy + delete.
    const errCode = (renameErr as NodeJS.ErrnoException | null)?.code
    if (errCode === 'EPERM') {
      logger.warn(`rename failed (EPERM) for ${String(id).replace(/[\r\n]/g, '')}, falling back to copy+delete`)
      await fs.cp(item.folderPath, destPath, { recursive: true })
      await fs.rm(item.folderPath, { recursive: true, force: true })
    } else {
      throw renameErr
    }
  }

  logger.debug(`Approved and moved queue item: ${String(id).replace(/[\r\n]/g, '')}`)
}

export async function rejectItem(id: string): Promise<void> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const folderPath = path.join(getQueueDir(), path.basename(id))
  try {
    await fs.rm(folderPath, { recursive: true })
    logger.debug(`Rejected and deleted queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  } catch (err) {
    logger.debug(`Failed to reject queue item ${String(id).replace(/[\r\n]/g, '')}: ${String(err).replace(/[\r\n]/g, '')}`)
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
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  try {
    await fs.access(path.join(getQueueDir(), path.basename(id)))
    return 'pending'
  } catch {
    // not in queue
  }

  try {
    await fs.access(path.join(getPublishedDir(), path.basename(id)))
    return 'published'
  } catch {
    // not published
  }

  return null
}

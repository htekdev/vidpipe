import { getConfig } from '../config/environment'
import logger from '../config/logger'
import { readTextFile, writeTextFile, writeJsonFile, ensureDirectory, copyFile, fileExists, listDirectoryWithTypes, removeDirectory, renameFile, copyDirectory } from '../core/fileSystem.js'
import { join, basename, resolve, sep } from '../core/paths.js'

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

export interface GroupedQueueItem {
  groupKey: string
  sourceVideo: string
  sourceClip: string | null
  clipType: 'video' | 'short' | 'medium-clip'
  hasMedia: boolean
  items: QueueItem[]
}

function getQueueDir(): string {
  const { OUTPUT_DIR } = getConfig()
  return join(OUTPUT_DIR, 'publish-queue')
}

function getPublishedDir(): string {
  const { OUTPUT_DIR } = getConfig()
  return join(OUTPUT_DIR, 'published')
}

async function readQueueItem(folderPath: string, id: string): Promise<QueueItem | null> {
  const metadataPath = join(folderPath, 'metadata.json')
  const postPath = join(folderPath, 'post.md')
  const mediaPath = join(folderPath, 'media.mp4')

  try {
    // Read directly without prior existence check to avoid TOCTOU race
    const metadataRaw = await readTextFile(metadataPath)
    const metadata: QueueItemMetadata = JSON.parse(metadataRaw)

    let postContent = ''
    try {
      postContent = await readTextFile(postPath)
    } catch {
      logger.debug(`No post.md found for ${String(id).replace(/[\r\n]/g, '')}`)
    }

    let hasMedia = false
    const mediaFilePath = join(folderPath, 'media.mp4')
    hasMedia = await fileExists(mediaFilePath)

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
  await ensureDirectory(queueDir)

  let entries: string[]
  try {
    const dirents = await listDirectoryWithTypes(queueDir)
    entries = dirents.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }

  const items: QueueItem[] = []
  for (const name of entries) {
    const item = await readQueueItem(join(queueDir, name), name)
    if (item) items.push(item)
  }

  // Sort: items with media first (shorts/clips), then text-only (video-level), then by date
  items.sort((a, b) => {
    if (a.hasMedia !== b.hasMedia) return a.hasMedia ? -1 : 1
    return a.metadata.createdAt.localeCompare(b.metadata.createdAt)
  })
  return items
}

export async function getGroupedPendingItems(): Promise<GroupedQueueItem[]> {
  const items = await getPendingItems()
  
  // Group items by sourceVideo + sourceClip (null for full video posts)
  const groups = new Map<string, QueueItem[]>()
  
  for (const item of items) {
    const groupKey = `${item.metadata.sourceVideo}::${item.metadata.sourceClip ?? 'video'}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, [])
    }
    groups.get(groupKey)!.push(item)
  }
  
  // Convert to GroupedQueueItem array
  const result: GroupedQueueItem[] = []
  for (const [groupKey, groupItems] of groups) {
    if (groupItems.length === 0) continue
    
    const first = groupItems[0]
    result.push({
      groupKey,
      sourceVideo: first.metadata.sourceVideo,
      sourceClip: first.metadata.sourceClip,
      clipType: first.metadata.clipType,
      hasMedia: first.hasMedia,
      items: groupItems,
    })
  }
  
  // Sort groups: media first, then by earliest createdAt in group
  result.sort((a, b) => {
    if (a.hasMedia !== b.hasMedia) return a.hasMedia ? -1 : 1
    const aDate = Math.min(...a.items.map(i => new Date(i.metadata.createdAt).getTime()))
    const bDate = Math.min(...b.items.map(i => new Date(i.metadata.createdAt).getTime()))
    return aDate - bDate
  })
  
  return result
}

export async function getItem(id: string): Promise<QueueItem | null> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const folderPath = join(getQueueDir(), basename(id))
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
  const folderPath = join(getQueueDir(), basename(id))
  await ensureDirectory(folderPath)

  await writeJsonFile(join(folderPath, 'metadata.json'), metadata)
  await writeTextFile(join(folderPath, 'post.md'), postContent)

  let hasMedia = false
  const mediaPath = join(folderPath, 'media.mp4')

  if (mediaSourcePath) {
    await copyFile(mediaSourcePath, mediaPath)
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
    const metadataWritePath = resolve(join(existing.folderPath, 'metadata.json'))
    if (!metadataWritePath.startsWith(resolve(getQueueDir()) + sep)) {
      throw new Error('Write target outside queue directory')
    }
    await writeTextFile(
      metadataWritePath,
      JSON.stringify(existing.metadata, null, 2),
    )
  }

  if (updates.postContent !== undefined) {
    // Sanitize post content - ensure it's a string
    const sanitizedContent = String(updates.postContent)
    existing.postContent = sanitizedContent
    // Validate write target is within the expected queue directory (CodeQL js/http-to-file-access)
    const postWritePath = resolve(join(existing.folderPath, 'post.md'))
    if (!postWritePath.startsWith(resolve(getQueueDir()) + sep)) {
      throw new Error('Write target outside queue directory')
    }
    // lgtm[js/http-to-file-access] - Writing user-provided post content to queue is intended functionality with path validation
    await writeTextFile(postWritePath, sanitizedContent)
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
  const approveMetadataPath = resolve(join(item.folderPath, 'metadata.json'))
  if (!approveMetadataPath.startsWith(resolve(getQueueDir()) + sep)) {
    throw new Error('Write target outside queue directory')
  }
  // lgtm[js/http-to-file-access] - Writing sanitized metadata to queue is intended functionality with path validation
  await writeTextFile(
    approveMetadataPath,
    JSON.stringify(sanitizedMetadata, null, 2),
  )

  const publishedDir = getPublishedDir()
  await ensureDirectory(publishedDir)
  
  // Validate destination path to prevent path traversal - use basename inline
  const destPath = join(publishedDir, basename(id))
  const resolvedDest = resolve(destPath)
  const resolvedPublishedDir = resolve(publishedDir)
  if (!resolvedDest.startsWith(resolvedPublishedDir + sep) && resolvedDest !== resolvedPublishedDir) {
    throw new Error(`Invalid destination path for item ${id}`)
  }

  try {
    await renameFile(item.folderPath, destPath)
  } catch (renameErr: unknown) {
    // On Windows, rename can fail with EPERM if a file handle is still releasing.
    // Fall back to recursive copy + delete.
    const errCode = (renameErr as NodeJS.ErrnoException | null)?.code
    if (errCode === 'EPERM') {
      logger.warn(`rename failed (EPERM) for ${String(id).replace(/[\r\n]/g, '')}, falling back to copy+delete`)
      await copyDirectory(item.folderPath, destPath)
      await removeDirectory(item.folderPath, { recursive: true, force: true })
    } else {
      throw renameErr
    }
  }

  logger.debug(`Approved and moved queue item: ${String(id).replace(/[\r\n]/g, '')}`)
}

export interface BulkApprovalResult {
  itemId: string
  platform: string
  latePostId: string
  scheduledFor: string
  publishedUrl?: string
}

export async function approveBulk(
  itemIds: string[],
  publishDataMap: Map<string, { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string }>,
): Promise<BulkApprovalResult[]> {
  const results: BulkApprovalResult[] = []
  const errors: Array<{ itemId: string; error: string }> = []
  
  for (const id of itemIds) {
    try {
      const publishData = publishDataMap.get(id)
      if (!publishData) {
        errors.push({ itemId: id, error: 'No publish data provided' })
        continue
      }
      
      await approveItem(id, publishData)
      
      results.push({
        itemId: id,
        platform: id.split('-').pop() || 'unknown',
        latePostId: publishData.latePostId,
        scheduledFor: publishData.scheduledFor,
        publishedUrl: publishData.publishedUrl,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push({ itemId: id, error: msg })
      logger.error(`Bulk approve failed for ${String(id).replace(/[\r\n]/g, '')}: ${msg}`)
    }
  }
  
  if (errors.length > 0) {
    logger.warn(`Bulk approval completed with ${errors.length} errors`)
  }
  
  return results
}

export async function rejectItem(id: string): Promise<void> {
  // Inline validation to prevent path traversal - CodeQL recognizes this pattern
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
  const folderPath = join(getQueueDir(), basename(id))
  try {
    await removeDirectory(folderPath, { recursive: true })
    logger.debug(`Rejected and deleted queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  } catch (err) {
    logger.debug(`Failed to reject queue item ${String(id).replace(/[\r\n]/g, '')}: ${String(err).replace(/[\r\n]/g, '')}`)
  }
}

export async function getPublishedItems(): Promise<QueueItem[]> {
  const publishedDir = getPublishedDir()
  await ensureDirectory(publishedDir)

  let entries: string[]
  try {
    const dirents = await listDirectoryWithTypes(publishedDir)
    entries = dirents.filter(d => d.isDirectory()).map(d => d.name)
  } catch {
    return []
  }

  const items: QueueItem[] = []
  for (const name of entries) {
    const item = await readQueueItem(join(publishedDir, name), name)
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
  if (await fileExists(join(getQueueDir(), basename(id)))) {
    return 'pending'
  }

  if (await fileExists(join(getPublishedDir(), basename(id)))) {
    return 'published'
  }

  return null
}

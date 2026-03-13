import { getConfig } from '../../L1-infra/config/environment.js'
import { ensureDirectory, copyFile, fileExists, fileExistsSync, removeDirectory, renameFile, copyDirectory } from '../../L1-infra/fileSystem/fileSystem.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { join, basename, resolve, sep, extname } from '../../L1-infra/paths/paths.js'
import {
  getQueueItem as dbGetItem,
  getItemsByStatus as dbGetByStatus,
  insertQueueItem,
  updateQueueItem as dbUpdateItem,
  markPublished,
  deleteQueueItem,
  itemExists as dbItemExists,
} from '../../L2-clients/dataStore/queueStore.js'
import type { QueueItemInsert, QueueItemRow } from '../../L2-clients/dataStore/queueStore.js'

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
  /** Type of media attached: video file or generated image */
  mediaType?: 'video' | 'image'
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
  mediaType?: 'video' | 'image'
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

function validateId(id: string): void {
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ID format: ${id}`)
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  return JSON.parse(value) as T
}

function toNullableString(value: string | null | undefined): string | null {
  return value === undefined ? null : value === null ? null : String(value)
}

function normalizeLinks(links: Array<{ url: string; title?: string }>): Array<{ url: string; title?: string }> {
  return links.map((link) => {
    const normalized = { url: String(link.url) }
    if (link.title !== undefined) {
      return { ...normalized, title: String(link.title) }
    }
    return normalized
  })
}

function rowToMetadata(row: QueueItemRow): QueueItemMetadata {
  return {
    id: row.id,
    platform: row.platform,
    accountId: row.account_id,
    sourceVideo: row.source_video,
    sourceClip: row.source_clip,
    clipType: row.clip_type,
    sourceMediaPath: row.source_media_path,
    hashtags: parseJson<string[]>(row.hashtags, []),
    links: parseJson<Array<{ url: string; title?: string }>>(row.links, []),
    characterCount: row.character_count,
    platformCharLimit: row.platform_char_limit,
    suggestedSlot: row.suggested_slot,
    scheduledFor: row.scheduled_for,
    status: row.status,
    latePostId: row.late_post_id,
    publishedUrl: row.published_url,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    publishedAt: row.published_at,
    textOnly: row.text_only === 1 ? true : row.text_only === 0 ? false : undefined,
    mediaType: row.media_type ?? undefined,
    platformSpecificData: row.platform_specific ? parseJson<Record<string, unknown>>(row.platform_specific, {}) : undefined,
  }
}

function findMediaPath(folderPath: string): string | null {
  const videoPath = join(folderPath, 'media.mp4')
  const imagePath = join(folderPath, 'media.png')

  if (fileExistsSync(videoPath)) return videoPath
  if (fileExistsSync(imagePath)) return imagePath
  return null
}

function rowToQueueItem(row: QueueItemRow): QueueItem {
  const folderPath = row.media_folder_path || join(getQueueDir(), row.id)
  const hasMedia = row.media_folder_path !== null

  return {
    id: row.id,
    metadata: rowToMetadata(row),
    postContent: row.post_content,
    hasMedia,
    mediaPath: hasMedia ? findMediaPath(folderPath) : null,
    folderPath,
  }
}

function metadataToInsert(
  id: string,
  metadata: QueueItemMetadata,
  postContent: string,
  mediaFolderPath: string | null,
): QueueItemInsert {
  return {
    id,
    platform: metadata.platform,
    account_id: metadata.accountId,
    source_video: metadata.sourceVideo,
    source_clip: metadata.sourceClip,
    clip_type: metadata.clipType,
    source_media_path: metadata.sourceMediaPath,
    media_type: metadata.mediaType,
    hashtags: metadata.hashtags,
    links: metadata.links,
    character_count: metadata.characterCount,
    platform_char_limit: metadata.platformCharLimit,
    suggested_slot: metadata.suggestedSlot,
    scheduled_for: metadata.scheduledFor,
    status: metadata.status,
    late_post_id: metadata.latePostId,
    published_url: metadata.publishedUrl,
    post_content: postContent,
    text_only: metadata.textOnly,
    platform_specific: metadata.platformSpecificData,
    media_folder_path: mediaFolderPath,
  }
}

function mergeMetadata(existing: QueueItemMetadata, updates: Partial<QueueItemMetadata>): QueueItemMetadata {
  return {
    id: String(existing.id),
    platform: String(updates.platform ?? existing.platform),
    accountId: String(updates.accountId ?? existing.accountId),
    sourceVideo: String(existing.sourceVideo),
    sourceClip: existing.sourceClip !== null ? String(existing.sourceClip) : null,
    clipType: existing.clipType,
    sourceMediaPath: existing.sourceMediaPath !== null ? String(existing.sourceMediaPath) : null,
    hashtags: Array.isArray(updates.hashtags)
      ? updates.hashtags.map(String)
      : Array.isArray(existing.hashtags)
        ? existing.hashtags.map(String)
        : [],
    links: Array.isArray(updates.links)
      ? normalizeLinks(updates.links)
      : Array.isArray(existing.links)
        ? normalizeLinks(existing.links)
        : [],
    characterCount: updates.characterCount !== undefined
      ? Number(updates.characterCount) || 0
      : Number(existing.characterCount) || 0,
    platformCharLimit: updates.platformCharLimit !== undefined
      ? Number(updates.platformCharLimit) || 0
      : Number(existing.platformCharLimit) || 0,
    suggestedSlot: updates.suggestedSlot !== undefined
      ? toNullableString(updates.suggestedSlot)
      : toNullableString(existing.suggestedSlot),
    scheduledFor: updates.scheduledFor !== undefined
      ? toNullableString(updates.scheduledFor)
      : toNullableString(existing.scheduledFor),
    status: updates.status ?? existing.status,
    latePostId: updates.latePostId !== undefined
      ? toNullableString(updates.latePostId)
      : toNullableString(existing.latePostId),
    publishedUrl: updates.publishedUrl !== undefined
      ? toNullableString(updates.publishedUrl)
      : toNullableString(existing.publishedUrl),
    createdAt: String(existing.createdAt),
    reviewedAt: updates.reviewedAt !== undefined
      ? toNullableString(updates.reviewedAt)
      : toNullableString(existing.reviewedAt),
    publishedAt: updates.publishedAt !== undefined
      ? toNullableString(updates.publishedAt)
      : toNullableString(existing.publishedAt),
    textOnly: updates.textOnly ?? existing.textOnly,
    mediaType: updates.mediaType ?? existing.mediaType,
    platformSpecificData: updates.platformSpecificData ?? existing.platformSpecificData,
  }
}

function metadataToUpdateInsert(metadata: QueueItemMetadata): Partial<QueueItemInsert> {
  return {
    platform: metadata.platform,
    account_id: metadata.accountId,
    hashtags: metadata.hashtags,
    links: metadata.links,
    character_count: metadata.characterCount,
    platform_char_limit: metadata.platformCharLimit,
    suggested_slot: metadata.suggestedSlot,
    scheduled_for: metadata.scheduledFor,
    status: metadata.status,
    late_post_id: metadata.latePostId,
    published_url: metadata.publishedUrl,
    text_only: metadata.textOnly,
    media_type: metadata.mediaType,
    platform_specific: metadata.platformSpecificData,
  }
}

export async function getPendingItems(): Promise<QueueItem[]> {
  return dbGetByStatus('pending_review').map(rowToQueueItem)
}

export async function getGroupedPendingItems(): Promise<GroupedQueueItem[]> {
  const items = await getPendingItems()

  const groups = new Map<string, QueueItem[]>()

  for (const item of items) {
    const platform = item.metadata.platform.toLowerCase()
    const clipSlug = item.id.endsWith(`-${platform}`)
      ? item.id.slice(0, -(platform.length + 1))
      : item.id
    const groupKey = `${item.metadata.sourceVideo}::${clipSlug}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, [])
    }
    groups.get(groupKey)?.push(item)
  }

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
      mediaType: first.metadata.mediaType,
      items: groupItems,
    })
  }

  result.sort((a, b) => {
    if (a.hasMedia !== b.hasMedia) return a.hasMedia ? -1 : 1
    const aDate = Math.min(...a.items.map((item) => new Date(item.metadata.createdAt).getTime()))
    const bDate = Math.min(...b.items.map((item) => new Date(item.metadata.createdAt).getTime()))
    return aDate - bDate
  })

  return result
}

export async function getItem(id: string): Promise<QueueItem | null> {
  validateId(id)
  const row = dbGetItem(id)
  return row ? rowToQueueItem(row) : null
}

export async function createItem(
  id: string,
  metadata: QueueItemMetadata,
  postContent: string,
  mediaSourcePath?: string,
): Promise<QueueItem> {
  validateId(id)

  const folderPath = join(getQueueDir(), basename(id))
  let mediaFolderPath: string | null = null

  if (mediaSourcePath) {
    await ensureDirectory(folderPath)
    const ext = extname(mediaSourcePath) || '.mp4'
    const mediaPath = join(folderPath, `media${ext}`)
    await copyFile(mediaSourcePath, mediaPath)
    mediaFolderPath = folderPath
  }

  insertQueueItem(metadataToInsert(id, metadata, postContent, mediaFolderPath))

  const row = dbGetItem(id)
  if (!row) {
    throw new Error(`Failed to load created queue item: ${id}`)
  }

  logger.debug(`Created queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  return rowToQueueItem(row)
}

export async function updateItem(
  id: string,
  updates: { postContent?: string; metadata?: Partial<QueueItemMetadata> },
): Promise<QueueItem | null> {
  validateId(id)

  const existingRow = dbGetItem(id)
  if (!existingRow) return null

  const existingItem = rowToQueueItem(existingRow)
  const dbUpdates: Partial<QueueItemInsert> = {}

  if (updates.metadata) {
    const mergedMetadata = mergeMetadata(existingItem.metadata, updates.metadata)
    Object.assign(dbUpdates, metadataToUpdateInsert(mergedMetadata))
  }

  if (updates.postContent !== undefined) {
    dbUpdates.post_content = String(updates.postContent)
  }

  dbUpdateItem(id, dbUpdates)

  const updatedRow = dbGetItem(id)
  if (!updatedRow) return null

  logger.debug(`Updated queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  return rowToQueueItem(updatedRow)
}

export async function approveItem(
  id: string,
  publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string; accountId?: string },
): Promise<void> {
  validateId(id)

  const row = dbGetItem(id)
  if (!row) return

  markPublished(id, publishData)

  if (row.media_folder_path) {
    const sourcePath = row.media_folder_path
    if (await fileExists(sourcePath)) {
      const publishedDir = getPublishedDir()
      await ensureDirectory(publishedDir)

      const destPath = join(publishedDir, basename(id))
      const resolvedDest = resolve(destPath)
      const resolvedPublishedDir = resolve(publishedDir)
      if (!resolvedDest.startsWith(resolvedPublishedDir + sep) && resolvedDest !== resolvedPublishedDir) {
        throw new Error(`Invalid destination path for item ${id}`)
      }

      try {
        await renameFile(sourcePath, destPath)
      } catch (renameErr: unknown) {
        const errCode = (renameErr as NodeJS.ErrnoException | null)?.code
        if (errCode === 'EPERM') {
          logger.warn(`rename failed (EPERM) for ${String(id).replace(/[\r\n]/g, '')}, falling back to copy+delete`)
          await copyDirectory(sourcePath, destPath)
          await removeDirectory(sourcePath, { recursive: true, force: true })
        } else {
          throw renameErr
        }
      }

      dbUpdateItem(id, { media_folder_path: destPath })
    }
  }

  logger.debug(`Approved queue item: ${String(id).replace(/[\r\n]/g, '')}`)
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
  validateId(id)

  const row = dbGetItem(id)
  const folderPath = row?.media_folder_path ?? join(getQueueDir(), basename(id))
  deleteQueueItem(id)

  try {
    if (await fileExists(folderPath)) {
      await removeDirectory(folderPath, { recursive: true })
    }
    logger.debug(`Rejected and deleted queue item: ${String(id).replace(/[\r\n]/g, '')}`)
  } catch (err) {
    logger.debug(`Failed to reject queue item ${String(id).replace(/[\r\n]/g, '')}: ${String(err).replace(/[\r\n]/g, '')}`)
  }
}

export async function getPublishedItems(): Promise<QueueItem[]> {
  return dbGetByStatus('published').map(rowToQueueItem)
}

export async function itemExists(id: string): Promise<'pending' | 'published' | null> {
  validateId(id)

  const status = dbItemExists(id)
  if (status === 'pending_review') return 'pending'
  return status
}

import { Readable } from 'node:stream'
import logger from '../../L1-infra/logger/configLogger.js'
import * as storageService from './storageService.js'
import type { ContentRecord } from './storageService.js'
import { getContentType } from './contentMetadata.js'

// ── Types ────────────────────────────────────────────────────────────────

export interface ReviewItem {
  id: string
  videoSlug: string
  platform: string
  clipType: string
  status: string
  mediaType: string
  mediaUrl: string
  postContent: string
  hashtags: string[]
  scheduledFor: string | null
  latePostId: string | null
  publishedUrl: string | null
  createdAt: string
  thumbnailUrl: string | null
  ideaIds: string[]
  mediaFilename: string
  thumbnailFilename: string
  blobBasePath: string
}

export interface ReviewGroup {
  videoSlug: string
  clipType: string
  items: ReviewItem[]
}

// ── Helpers ──────────────────────────────────────────────────────────────

function mapContentRecordToReviewItem(
  record: ContentRecord & { partitionKey: string; rowKey: string },
): ReviewItem {
  const itemId = record.rowKey
  const mediaFilename = record.mediaFilename || ''
  const thumbnailFilename = record.thumbnailFilename || ''

  return {
    id: itemId,
    videoSlug: record.partitionKey,
    platform: record.platform,
    clipType: record.clipType,
    status: record.status,
    mediaType: record.mediaType || 'video',
    mediaUrl: mediaFilename ? `/api/media/${itemId}/${mediaFilename}` : '',
    postContent: record.postContent || '',
    hashtags: record.hashtags ? record.hashtags.split(',').filter(Boolean) : [],
    scheduledFor: record.scheduledFor || null,
    latePostId: record.latePostId || null,
    publishedUrl: record.publishedUrl || null,
    createdAt: record.createdAt || new Date().toISOString(),
    thumbnailUrl: thumbnailFilename ? `/api/media/${itemId}/${thumbnailFilename}` : null,
    ideaIds: record.ideaIds ? record.ideaIds.split(',').filter(Boolean) : [],
    mediaFilename,
    thumbnailFilename,
    blobBasePath: record.blobBasePath || `content/${itemId}/`,
  }
}

function getContentTypeForFilename(filename: string): string {
  return getContentType(filename)
}

// ── Query functions ──────────────────────────────────────────────────────

export async function listPendingItems(): Promise<ReviewItem[]> {
  const records = await storageService.getContentItems({ status: 'pending_review' })
  return records.map(mapContentRecordToReviewItem)
}

export async function getGroupedItems(): Promise<ReviewGroup[]> {
  const items = await listPendingItems()

  // All known platform suffixes that can appear in item IDs.
  // Ordered longest-first so "youtube-shorts" matches before "youtube".
  const platformSuffixes = [
    'youtube-shorts', 'instagram-reels', 'instagram-feed',
    'twitter', 'youtube', 'tiktok', 'instagram', 'linkedin', 'x',
  ]

  // Deduplicate: if the same rowKey exists under multiple partitions (re-processed
  // recordings), keep only the newest one.
  const deduped = new Map<string, ReviewItem>()
  for (const item of items) {
    const existing = deduped.get(item.id)
    if (!existing || item.createdAt > existing.createdAt || (item.createdAt === existing.createdAt && item.videoSlug > existing.videoSlug)) {
      deduped.set(item.id, item)
    }
  }

  // Group by clip slug ONLY (not videoSlug) so the same clip processed from
  // two different recordings merges into a single review group instead of
  // showing as two identical-looking cards.
  const groupMap = new Map<string, ReviewItem[]>()
  for (const item of deduped.values()) {
    let clipSlug = item.id
    for (const suffix of platformSuffixes) {
      if (item.id.endsWith(`-${suffix}`)) {
        clipSlug = item.id.slice(0, -(suffix.length + 1))
        break
      }
    }
    if (!groupMap.has(clipSlug)) {
      groupMap.set(clipSlug, [])
    }
    groupMap.get(clipSlug)!.push(item)
  }

  const groups: ReviewGroup[] = []
  for (const [clipSlug, groupItems] of groupMap) {
    const first = groupItems[0]
    groups.push({
      videoSlug: clipSlug,
      clipType: first.clipType,
      items: groupItems,
    })
  }

  // Sort: media items first (shorts/clips), then text-only, then by date
  groups.sort((a, b) => {
    const aHasMedia = a.items.some(i => Boolean(i.mediaFilename))
    const bHasMedia = b.items.some(i => Boolean(i.mediaFilename))
    if (aHasMedia !== bHasMedia) return aHasMedia ? -1 : 1
    return a.items[0].createdAt.localeCompare(b.items[0].createdAt)
  })

  return groups
}

export async function getItemById(
  videoSlug: string,
  itemId: string,
): Promise<ReviewItem | null> {
  const record = await storageService.getContentItem(videoSlug, itemId)
  if (!record) return null
  return mapContentRecordToReviewItem(record)
}

// ── Media streaming ──────────────────────────────────────────────────────

export interface MediaStreamResult {
  stream: Readable
  contentType: string
  contentLength?: number
  contentRange?: string
  statusCode?: number
  acceptRanges?: string
}

export async function getMediaStream(
  itemId: string,
  filename: string,
  range?: string,
): Promise<MediaStreamResult> {
  const { key } = await storageService.resolveContentFile(itemId, filename)
  const result = await storageService.getStorageMediaStream(key, range)
  return { ...result, contentType: result.contentType || getContentTypeForFilename(filename) }
}

// ── Mutation functions ───────────────────────────────────────────────────

export async function approveItem(
  videoSlug: string,
  itemId: string,
): Promise<void> {
  await storageService.updateContentStatus(videoSlug, itemId, 'approved', {
    reviewedAt: new Date().toISOString(),
  })
  logger.info(`Approved content item: ${itemId}`)
}

export async function markPublished(
  videoSlug: string,
  itemId: string,
  publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string },
): Promise<void> {
  await storageService.updateContentStatus(videoSlug, itemId, 'published', {
    latePostId: publishData.latePostId,
    scheduledFor: publishData.scheduledFor,
    publishedUrl: publishData.publishedUrl || '',
    publishedAt: new Date().toISOString(),
  })
  logger.info(`Marked content item as published: ${itemId} → ${publishData.latePostId}`)
}

export async function rejectItem(
  videoSlug: string,
  itemId: string,
): Promise<void> {
  await storageService.updateContentStatus(videoSlug, itemId, 'rejected')
  logger.info(`Rejected content item: ${itemId}`)
}

export async function updateItem(
  videoSlug: string,
  itemId: string,
  changes: { postContent?: string },
): Promise<ReviewItem | null> {
  const record = await storageService.getContentItem(videoSlug, itemId)
  if (!record) return null

  const updateFields: Partial<ContentRecord> = {}

  if (changes.postContent !== undefined) {
    updateFields.postContent = changes.postContent
    updateFields.characterCount = changes.postContent.length

    // Re-upload post.md blob
    const blobPath = `${record.blobBasePath || `content/${itemId}/`}post.md`
    const buffer = Buffer.from(changes.postContent, 'utf8')
    await storageService.uploadStorageBuffer(blobPath, buffer, 'text/markdown')
    logger.debug(`Updated post.md blob for ${itemId}`)
  }

  if (Object.keys(updateFields).length > 0) {
    await storageService.updateContentStatus(videoSlug, itemId, record.status, updateFields)
  }

  // Return updated item
  const updated = await storageService.getContentItem(videoSlug, itemId)
  if (!updated) return null
  return mapContentRecordToReviewItem(updated)
}

// ── Post content retrieval ───────────────────────────────────────────────

export async function getPostContent(itemId: string): Promise<string> {
  const record = await storageService.findContentItemByRowKey(itemId)
  return record?.postContent ?? ''
}

// ── Media download for Late API ──────────────────────────────────────────

export async function downloadMediaToFile(
  itemId: string,
  filename: string,
  localPath: string,
): Promise<void> {
  const { key } = await storageService.resolveContentFile(itemId, filename)
  await storageService.downloadBlobToFile(key, localPath)
}

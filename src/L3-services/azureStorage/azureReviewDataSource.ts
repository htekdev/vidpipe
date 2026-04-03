import { Readable } from 'node:stream'
import logger from '../../L1-infra/logger/configLogger.js'
import * as azureStorageService from './azureStorageService.js'
import type { ContentRecord } from './azureStorageService.js'
import * as blobClient from '../../L2-clients/azure/blobClient.js'

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
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp4': return 'video/mp4'
    case 'webm': return 'video/webm'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'md': return 'text/markdown'
    case 'json': return 'application/json'
    default: return 'application/octet-stream'
  }
}

// ── Query functions ──────────────────────────────────────────────────────

export async function listPendingItems(): Promise<ReviewItem[]> {
  const records = await azureStorageService.getContentItems({ status: 'pending_review' })
  return records.map(mapContentRecordToReviewItem)
}

export async function getGroupedItems(): Promise<ReviewGroup[]> {
  const items = await listPendingItems()

  const groupMap = new Map<string, ReviewItem[]>()
  for (const item of items) {
    const slug = item.videoSlug
    if (!groupMap.has(slug)) {
      groupMap.set(slug, [])
    }
    groupMap.get(slug)!.push(item)
  }

  const groups: ReviewGroup[] = []
  for (const [videoSlug, groupItems] of groupMap) {
    groups.push({ videoSlug, items: groupItems })
  }

  return groups
}

export async function getItemById(
  videoSlug: string,
  itemId: string,
): Promise<ReviewItem | null> {
  const record = await azureStorageService.getContentItem(videoSlug, itemId)
  if (!record) return null
  return mapContentRecordToReviewItem(record)
}

// ── Media streaming ──────────────────────────────────────────────────────

export interface MediaStreamResult {
  stream: Readable
  contentType: string
}

export async function getMediaStream(
  itemId: string,
  filename: string,
): Promise<MediaStreamResult> {
  const blobPath = `content/${itemId}/${filename}`
  const stream = await blobClient.downloadStream(blobPath)
  const contentType = getContentTypeForFilename(filename)
  return { stream, contentType }
}

// ── Mutation functions ───────────────────────────────────────────────────

export async function approveItem(
  videoSlug: string,
  itemId: string,
): Promise<void> {
  await azureStorageService.updateContentStatus(videoSlug, itemId, 'approved', {
    reviewedAt: new Date().toISOString(),
  })
  logger.info(`Approved content item: ${itemId}`)
}

export async function markPublished(
  videoSlug: string,
  itemId: string,
  publishData: { latePostId: string; scheduledFor: string; publishedUrl?: string },
): Promise<void> {
  await azureStorageService.updateContentStatus(videoSlug, itemId, 'published', {
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
  await azureStorageService.updateContentStatus(videoSlug, itemId, 'rejected')
  logger.info(`Rejected content item: ${itemId}`)
}

export async function updateItem(
  videoSlug: string,
  itemId: string,
  changes: { postContent?: string },
): Promise<ReviewItem | null> {
  const record = await azureStorageService.getContentItem(videoSlug, itemId)
  if (!record) return null

  const updateFields: Partial<ContentRecord> = {}

  if (changes.postContent !== undefined) {
    updateFields.postContent = changes.postContent
    updateFields.characterCount = changes.postContent.length

    // Re-upload post.md blob
    const blobPath = `content/${itemId}/post.md`
    const buffer = Buffer.from(changes.postContent, 'utf8')
    await blobClient.uploadBuffer(blobPath, buffer, 'text/markdown')
    logger.debug(`Updated post.md blob for ${itemId}`)
  }

  if (Object.keys(updateFields).length > 0) {
    await azureStorageService.updateContentStatus(videoSlug, itemId, record.status, updateFields)
  }

  // Return updated item
  const updated = await azureStorageService.getContentItem(videoSlug, itemId)
  if (!updated) return null
  return mapContentRecordToReviewItem(updated)
}

// ── Post content retrieval ───────────────────────────────────────────────

export async function getPostContent(itemId: string): Promise<string> {
  const blobPath = `content/${itemId}/post.md`
  try {
    const buffer = await blobClient.downloadToBuffer(blobPath)
    return buffer.toString('utf8')
  } catch {
    logger.warn(`No post.md found for ${itemId}`)
    return ''
  }
}

// ── Media download for Late API ──────────────────────────────────────────

export async function downloadMediaToFile(
  itemId: string,
  filename: string,
  localPath: string,
): Promise<void> {
  const blobPath = `content/${itemId}/${filename}`
  await blobClient.downloadToFile(blobPath, localPath)
}

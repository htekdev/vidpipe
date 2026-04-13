import { readdir, readFile } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import * as blobClient from '../../L2-clients/azure/blobClient.js'
import * as tableClient from '../../L2-clients/azure/tableClient.js'

const VIDEOS_TABLE = 'Videos'
const CONTENT_TABLE = 'Content'

export interface VideoRecord {
  [key: string]: unknown
  originalFilename: string
  slug: string
  blobPath: string
  sourceUrl: string
  duration: number
  size: number
  status: 'processing' | 'completed' | 'failed'
  contentCount: number
  processedAt: string
  createdAt: string
}

export interface ContentRecord {
  [key: string]: unknown
  platform: string
  clipType: string
  status: 'pending_review' | 'approved' | 'published' | 'rejected'
  blobBasePath: string
  mediaType: string
  mediaFilename: string
  postContent: string
  hashtags: string
  characterCount: number
  scheduledFor: string
  latePostId: string
  publishedUrl: string
  sourceVideoRunId: string
  thumbnailFilename: string
  ideaIds: string
  createdAt: string
  reviewedAt: string
  publishedAt: string
}

export async function uploadVideoFile(
  localPath: string,
  blobPath: string,
): Promise<string> {
  logger.info(`Uploading video to Azure blob: ${blobPath}`)
  return blobClient.uploadFile(blobPath, localPath, 'video/mp4')
}

export async function downloadBlobToFile(
  blobPath: string,
  localPath: string,
): Promise<void> {
  return blobClient.downloadToFile(blobPath, localPath)
}

export function isAzureConfigured(): boolean {
  return blobClient.isAzureConfigured()
}

export function getRunId(): string {
  return process.env.GITHUB_RUN_ID || randomUUID()
}

export async function uploadRawVideo(
  localPath: string,
  runId: string,
  metadata: {
    originalFilename: string
    slug: string
    sourceUrl?: string
    duration?: number
    size: number
  },
): Promise<string> {
  const blobPath = `raw/${runId}-${metadata.originalFilename}`

  logger.info(`Uploading raw video to Azure: ${blobPath}`)
  await blobClient.uploadFile(blobPath, localPath, 'video/mp4')

  await tableClient.upsertEntity(VIDEOS_TABLE, 'video', runId, {
    originalFilename: metadata.originalFilename,
    slug: metadata.slug,
    blobPath,
    sourceUrl: metadata.sourceUrl || '',
    duration: metadata.duration || 0,
    size: metadata.size,
    status: 'completed',
    contentCount: 0,
    processedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  } satisfies VideoRecord)

  logger.info(`Created video record: ${runId}`)
  return blobPath
}

export async function uploadContentItem(
  localItemDir: string,
  itemId: string,
  videoSlug: string,
  runId: string,
  metadata?: Partial<ContentRecord>,
): Promise<string> {
  const blobBasePath = `content/${itemId}/`

  // Upload all files in the item directory
  const files = await readdir(localItemDir)
  for (const file of files) {
    const localFilePath = join(localItemDir, file)
    const blobPath = `${blobBasePath}${file}`
    const contentType = getContentType(file)
    await blobClient.uploadFile(blobPath, localFilePath, contentType)
  }

  // Read metadata.json if exists to populate table record
  let itemMetadata: Record<string, unknown> = {}
  const metadataPath = join(localItemDir, 'metadata.json')
  try {
    const metadataContent = await readFile(metadataPath, 'utf8')
    itemMetadata = JSON.parse(metadataContent) as Record<string, unknown>
  } catch {
    // No metadata.json — use provided metadata
  }

  // Read post content
  let postContent = ''
  const postPath = join(localItemDir, 'post.md')
  try {
    postContent = await readFile(postPath, 'utf8')
  } catch {
    // No post.md
  }

  // Determine media file
  const mediaFilename = files.find(f => f.startsWith('media.')) || ''
  const thumbnailFilename = files.find(f => f.startsWith('thumbnail.')) || ''

  const record: ContentRecord = {
    platform: String(itemMetadata.platform || metadata?.platform || ''),
    clipType: String(itemMetadata.clipType || metadata?.clipType || ''),
    status: metadata?.status || 'pending_review',
    blobBasePath,
    mediaType: String(itemMetadata.mediaType || metadata?.mediaType || 'video'),
    mediaFilename,
    postContent,
    hashtags: Array.isArray(itemMetadata.hashtags) ? (itemMetadata.hashtags as string[]).join(',') : (metadata?.hashtags || ''),
    characterCount: Number(itemMetadata.characterCount || metadata?.characterCount || postContent.length),
    scheduledFor: String(itemMetadata.scheduledFor || metadata?.scheduledFor || ''),
    latePostId: String(itemMetadata.latePostId || metadata?.latePostId || ''),
    publishedUrl: String(itemMetadata.publishedUrl || metadata?.publishedUrl || ''),
    sourceVideoRunId: runId,
    thumbnailFilename,
    ideaIds: Array.isArray(itemMetadata.ideaIds) ? (itemMetadata.ideaIds as string[]).join(',') : (metadata?.ideaIds || ''),
    createdAt: String(itemMetadata.createdAt || new Date().toISOString()),
    reviewedAt: String(itemMetadata.reviewedAt || metadata?.reviewedAt || ''),
    publishedAt: String(itemMetadata.publishedAt || metadata?.publishedAt || ''),
  }

  await tableClient.upsertEntity(CONTENT_TABLE, videoSlug, itemId, record)
  logger.info(`Uploaded content item: ${itemId} (${record.platform}/${record.clipType}) — blob + table record created`)

  return blobBasePath
}

export async function uploadPublishQueue(
  publishQueueDir: string,
  videoSlug: string,
  runId: string,
): Promise<{ uploaded: number; errors: string[] }> {
  const errors: string[] = []
  let uploaded = 0

  let items: string[]
  try {
    items = await readdir(publishQueueDir)
  } catch {
    logger.warn(`Publish queue directory not found: ${publishQueueDir}`)
    return { uploaded: 0, errors: ['Publish queue directory not found'] }
  }

  for (const itemId of items) {
    const itemDir = join(publishQueueDir, itemId)
    try {
      await uploadContentItem(itemDir, itemId, videoSlug, runId)
      uploaded++
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      errors.push(`${itemId}: ${msg}`)
      logger.error(`Failed to upload content item ${itemId}: ${msg}`)
    }
  }

  // Update video record with content count
  await tableClient.updateEntity(VIDEOS_TABLE, 'video', runId, {
    contentCount: uploaded,
  })

  logger.info(`Uploaded ${uploaded} content items to Azure (${errors.length} errors)`)
  return { uploaded, errors }
}

export async function migrateLocalContent(
  outputDir: string,
): Promise<{ uploaded: number; errors: string[] }> {
  const errors: string[] = []
  let uploaded = 0
  const runId = `migration-${Date.now()}`

  // Migrate publish-queue items (as pending_review)
  const publishQueueDir = join(outputDir, 'publish-queue')
  try {
    const items = await readdir(publishQueueDir)
    for (const itemId of items) {
      try {
        // Extract video slug from item id (everything before last dash + platform)
        const videoSlug = extractVideoSlug(itemId)
        await uploadContentItem(
          join(publishQueueDir, itemId),
          itemId,
          videoSlug,
          runId,
          { status: 'pending_review' },
        )
        uploaded++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`publish-queue/${itemId}: ${msg}`)
      }
    }
  } catch {
    logger.info('No publish-queue directory found for migration')
  }

  // Migrate published items (as published)
  const publishedDir = join(outputDir, 'published')
  try {
    const items = await readdir(publishedDir)
    for (const itemId of items) {
      try {
        const videoSlug = extractVideoSlug(itemId)
        await uploadContentItem(
          join(publishedDir, itemId),
          itemId,
          videoSlug,
          runId,
          { status: 'published' },
        )
        uploaded++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        errors.push(`published/${itemId}: ${msg}`)
      }
    }
  } catch {
    logger.info('No published directory found for migration')
  }

  logger.info(`Migration complete: ${uploaded} items uploaded, ${errors.length} errors`)
  return { uploaded, errors }
}

export async function getContentItems(
  filters?: { videoSlug?: string; status?: string },
): Promise<Array<ContentRecord & { partitionKey: string; rowKey: string }>> {
  const parts: string[] = []

  if (filters?.videoSlug) {
    parts.push(`PartitionKey eq '${filters.videoSlug}'`)
  }
  if (filters?.status) {
    parts.push(`status eq '${filters.status}'`)
  }

  const filter = parts.length > 0 ? parts.join(' and ') : ''
  const entities = await tableClient.queryEntities<ContentRecord & { partitionKey: string; rowKey: string }>(
    CONTENT_TABLE,
    filter,
  )

  return entities
}

export async function getContentItem(
  videoSlug: string,
  itemId: string,
): Promise<(ContentRecord & { partitionKey: string; rowKey: string }) | null> {
  const entity = await tableClient.getEntity<ContentRecord & { partitionKey: string; rowKey: string }>(
    CONTENT_TABLE,
    videoSlug,
    itemId,
  )
  return entity
}

/**
 * Find a content item by RowKey (itemId) when the partitionKey (videoSlug) is unknown.
 * Uses a server-side RowKey filter instead of loading all items.
 */
export async function findContentItemByRowKey(
  itemId: string,
): Promise<(ContentRecord & { partitionKey: string; rowKey: string }) | null> {
  const results = await tableClient.queryEntities<ContentRecord & { partitionKey: string; rowKey: string }>(
    CONTENT_TABLE,
    `RowKey eq '${itemId}'`,
  )
  return results[0] ?? null
}

export async function updateContentStatus(
  videoSlug: string,
  itemId: string,
  status: ContentRecord['status'],
  extraFields?: Partial<ContentRecord>,
): Promise<void> {
  await tableClient.updateEntity(CONTENT_TABLE, videoSlug, itemId, {
    status,
    ...extraFields,
  })
  logger.info(`Updated content status: ${itemId} → ${status}`)
}

export async function getVideoRecord(
  runId: string,
): Promise<(VideoRecord & { partitionKey: string; rowKey: string }) | null> {
  return tableClient.getEntity<VideoRecord & { partitionKey: string; rowKey: string }>(
    VIDEOS_TABLE,
    'video',
    runId,
  )
}

export async function listVideos(
  status?: string,
): Promise<Array<VideoRecord & { partitionKey: string; rowKey: string }>> {
  const filter = status ? `PartitionKey eq 'video' and status eq '${status}'` : "PartitionKey eq 'video'"
  return tableClient.queryEntities<VideoRecord & { partitionKey: string; rowKey: string }>(
    VIDEOS_TABLE,
    filter,
  )
}

export async function downloadContentMedia(blobPath: string): Promise<import('node:stream').Readable> {
  return blobClient.downloadStream(blobPath)
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp4': return 'video/mp4'
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'json': return 'application/json'
    case 'md': return 'text/markdown'
    case 'srt': case 'vtt': case 'ass': return 'text/plain'
    default: return 'application/octet-stream'
  }
}

function extractVideoSlug(itemId: string): string {
  // Item IDs are typically "{slug}-{platform}" e.g. "my-video-youtube"
  // We need to strip the platform suffix
  const platforms = ['youtube-shorts', 'instagram-reels', 'instagram-feed', 'twitter', 'youtube', 'tiktok', 'instagram', 'linkedin', 'x']
  for (const platform of platforms) {
    if (itemId.endsWith(`-${platform}`)) {
      return itemId.slice(0, -(platform.length + 1))
    }
  }
  return itemId
}

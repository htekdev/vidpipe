import { fileExists, listDirectoryWithTypes, readTextFile } from '../../L1-infra/fileSystem/fileSystem.js'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { join } from '../../L1-infra/paths/paths.js'
import { insertQueueItem, itemExists } from '../../L2-clients/dataStore/queueStore.js'
import type { QueueItemInsert } from '../../L2-clients/dataStore/queueStore.js'
import { getVideo, upsertVideo } from '../../L2-clients/dataStore/videoStore.js'
import type { VideoStatus } from '../../L2-clients/dataStore/videoStore.js'
import type { QueueItemMetadata } from '../postStore/postStore.js'

export interface MigrationResult {
  videosImported: number
  videosSkipped: number
  queueItemsImported: number
  queueItemsSkipped: number
  publishedItemsImported: number
  publishedItemsSkipped: number
  errors: string[]
}

interface LegacyProcessingStateVideo {
  readonly status: VideoStatus
  readonly sourcePath: string
}

interface LegacyProcessingState {
  readonly videos: Record<string, LegacyProcessingStateVideo>
}

type QueueItemStatus = QueueItemInsert['status']
type QueueCategory = 'queue' | 'published'

const validVideoStatuses = new Set<VideoStatus>(['pending', 'processing', 'completed', 'failed'])
const validClipTypes = new Set<QueueItemInsert['clip_type']>(['video', 'short', 'medium-clip'])
const validMediaTypes = new Set<NonNullable<QueueItemInsert['media_type']>>(['video', 'image'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function requireString(value: unknown, fieldName: string, context: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${fieldName} in ${context}`)
  }

  return value
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function parseLinks(value: unknown): Array<{ url: string; title?: string }> {
  if (!Array.isArray(value)) return []

  const links: Array<{ url: string; title?: string }> = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      links.push({ url: entry })
      continue
    }

    if (!isRecord(entry) || typeof entry.url !== 'string') {
      continue
    }

    if (typeof entry.title === 'string') {
      links.push({ url: entry.url, title: entry.title })
    } else {
      links.push({ url: entry.url })
    }
  }

  return links
}

function parseJson<T>(raw: string, filePath: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse JSON at ${filePath}: ${message}`)
  }
}

function parseProcessingState(content: string, filePath: string): LegacyProcessingState {
  const parsed = parseJson<unknown>(content, filePath)
  if (!isRecord(parsed) || !isRecord(parsed.videos)) {
    throw new Error(`Invalid processing state format at ${filePath}`)
  }

  const videos: Record<string, LegacyProcessingStateVideo> = {}
  for (const [slug, value] of Object.entries(parsed.videos)) {
    if (!isRecord(value) || !validVideoStatuses.has(value.status as VideoStatus) || typeof value.sourcePath !== 'string') {
      throw new Error(`Invalid video entry for ${slug} in ${filePath}`)
    }

    videos[slug] = {
      status: value.status as VideoStatus,
      sourcePath: value.sourcePath,
    }
  }

  return { videos }
}

function parseQueueMetadata(content: string, filePath: string): QueueItemMetadata {
  const parsed = parseJson<unknown>(content, filePath)
  if (!isRecord(parsed)) {
    throw new Error(`Invalid metadata format at ${filePath}`)
  }

  const clipType = parsed.clipType
  if (!validClipTypes.has(clipType as QueueItemInsert['clip_type'])) {
    throw new Error(`Invalid clipType in ${filePath}`)
  }

  const mediaType = parsed.mediaType
  if (mediaType !== undefined && mediaType !== null && !validMediaTypes.has(mediaType as NonNullable<QueueItemInsert['media_type']>)) {
    throw new Error(`Invalid mediaType in ${filePath}`)
  }

  const platformSpecificData = parsed.platformSpecificData
  if (platformSpecificData !== undefined && platformSpecificData !== null && !isRecord(platformSpecificData)) {
    throw new Error(`Invalid platformSpecificData in ${filePath}`)
  }

  return {
    id: requireString(parsed.id, 'id', filePath),
    platform: requireString(parsed.platform, 'platform', filePath),
    accountId: typeof parsed.accountId === 'string' ? parsed.accountId : '',
    sourceVideo: requireString(parsed.sourceVideo, 'sourceVideo', filePath),
    sourceClip: toNullableString(parsed.sourceClip),
    clipType: clipType as QueueItemMetadata['clipType'],
    sourceMediaPath: toNullableString(parsed.sourceMediaPath),
    hashtags: parseHashtags(parsed.hashtags),
    links: parseLinks(parsed.links),
    characterCount: toNumber(parsed.characterCount),
    platformCharLimit: toNumber(parsed.platformCharLimit),
    suggestedSlot: toNullableString(parsed.suggestedSlot),
    scheduledFor: toNullableString(parsed.scheduledFor),
    status: parsed.status === 'published' ? 'published' : 'pending_review',
    latePostId: toNullableString(parsed.latePostId),
    publishedUrl: toNullableString(parsed.publishedUrl),
    createdAt: toOptionalString(parsed.createdAt) ?? new Date(0).toISOString(),
    reviewedAt: toNullableString(parsed.reviewedAt),
    publishedAt: toNullableString(parsed.publishedAt),
    textOnly: typeof parsed.textOnly === 'boolean' ? parsed.textOnly : undefined,
    mediaType: mediaType === undefined || mediaType === null ? undefined : (mediaType as QueueItemMetadata['mediaType']),
    platformSpecificData: isRecord(platformSpecificData) ? platformSpecificData : undefined,
  }
}

function toQueueInsert(
  metadata: QueueItemMetadata,
  postContent: string,
  status: QueueItemStatus,
  folderPath: string,
): QueueItemInsert {
  return {
    id: metadata.id,
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
    status,
    late_post_id: metadata.latePostId,
    published_url: metadata.publishedUrl,
    post_content: postContent,
    text_only: metadata.textOnly,
    platform_specific: metadata.platformSpecificData,
    media_folder_path: folderPath,
  }
}

function recordError(result: MigrationResult, message: string, error: unknown): void {
  const suffix = error instanceof Error ? error.message : String(error)
  const fullMessage = `${message}: ${suffix}`
  result.errors.push(fullMessage)
  logger.warn(fullMessage)
}

function incrementImported(result: MigrationResult, category: QueueCategory): void {
  if (category === 'queue') {
    result.queueItemsImported += 1
    return
  }

  result.publishedItemsImported += 1
}

function incrementSkipped(result: MigrationResult, category: QueueCategory): void {
  if (category === 'queue') {
    result.queueItemsSkipped += 1
    return
  }

  result.publishedItemsSkipped += 1
}

async function migrateProcessingState(outputDir: string, result: MigrationResult): Promise<void> {
  const statePath = join(outputDir, 'processing-state.json')
  if (!await fileExists(statePath)) {
    logger.info(`[Migration] No processing-state.json found at ${statePath}`)
    return
  }

  try {
    const state = parseProcessingState(await readTextFile(statePath), statePath)

    for (const [slug, video] of Object.entries(state.videos)) {
      if (getVideo(slug)) {
        result.videosSkipped += 1
        continue
      }

      upsertVideo(slug, video.sourcePath, video.status)
      result.videosImported += 1
    }
  } catch (error) {
    recordError(result, `Failed to migrate processing state from ${statePath}`, error)
  }
}

async function migrateQueueItems(
  dirPath: string,
  status: QueueItemStatus,
  result: MigrationResult,
  category: QueueCategory,
): Promise<void> {
  if (!await fileExists(dirPath)) {
    logger.info(`[Migration] No ${category} directory found at ${dirPath}`)
    return
  }

  let entries: Awaited<ReturnType<typeof listDirectoryWithTypes>>
  try {
    entries = await listDirectoryWithTypes(dirPath)
  } catch (error) {
    recordError(result, `Failed to list ${category} directory ${dirPath}`, error)
    return
  }

  const folders = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of folders) {
    const folderPath = join(dirPath, entry.name)
    const metadataPath = join(folderPath, 'metadata.json')
    const postPath = join(folderPath, 'post.md')

    try {
      const metadata = parseQueueMetadata(await readTextFile(metadataPath), metadataPath)
      const existingStatus = itemExists(metadata.id)
      if (existingStatus !== null) {
        incrementSkipped(result, category)
        continue
      }

      const postContent = await readTextFile(postPath)
      insertQueueItem(toQueueInsert(metadata, postContent, status, folderPath))
      incrementImported(result, category)
    } catch (error) {
      recordError(result, `Failed to migrate ${category} item from ${folderPath}`, error)
    }
  }
}

export async function migrateJsonToSqlite(): Promise<MigrationResult> {
  const { OUTPUT_DIR } = getConfig()
  const result: MigrationResult = {
    videosImported: 0,
    videosSkipped: 0,
    queueItemsImported: 0,
    queueItemsSkipped: 0,
    publishedItemsImported: 0,
    publishedItemsSkipped: 0,
    errors: [],
  }

  await migrateProcessingState(OUTPUT_DIR, result)
  await migrateQueueItems(join(OUTPUT_DIR, 'publish-queue'), 'pending_review', result, 'queue')
  await migrateQueueItems(join(OUTPUT_DIR, 'published'), 'published', result, 'published')

  logger.info(
    `[Migration] Completed JSON-to-SQLite migration: ${result.videosImported} videos imported, ${result.videosSkipped} videos skipped, ${result.queueItemsImported} queue items imported, ${result.queueItemsSkipped} queue items skipped, ${result.publishedItemsImported} published items imported, ${result.publishedItemsSkipped} published items skipped, ${result.errors.length} errors`,
  )

  return result
}

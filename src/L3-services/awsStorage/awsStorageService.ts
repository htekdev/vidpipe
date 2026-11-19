import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import * as db from '../../L2-clients/aws/dynamoClient.js'
import * as s3 from '../../L2-clients/aws/s3Client.js'
import { getContentType, readContentDirectory } from '../storage/contentMetadata.js'
import type { ContentRecord, StoredContentRecord, StoredVideoRecord } from '../../L0-pure/types/index.js'

function tables(): { content: string; videos: string } {
  const config = getConfig()
  if (!isStorageConfigured()) throw new Error('AWS storage requires AWS_REGION, AWS_S3_BUCKET, AWS_DYNAMODB_CONTENT_TABLE and AWS_DYNAMODB_VIDEOS_TABLE.')
  return { content: config.AWS_DYNAMODB_CONTENT_TABLE, videos: config.AWS_DYNAMODB_VIDEOS_TABLE }
}
function content(record: Record<string, unknown>): StoredContentRecord {
  return { ...record, partitionKey: String(record.videoSlug), rowKey: String(record.itemId) } as StoredContentRecord
}
function video(record: Record<string, unknown>): StoredVideoRecord {
  return { ...record, partitionKey: 'video', rowKey: String(record.runId) } as StoredVideoRecord
}

async function reconcileWrite(table: string, key: Record<string, unknown>, attempt: string): Promise<Record<string, unknown> | null | undefined> {
  try { return await db.getItem(table, key) }
  catch (error) {
    logger.warn(`Retaining AWS upload attempt ${attempt}; metadata outcome could not be verified: ${String(error)}`)
    return undefined
  }
}

/** Check resources, not static credentials: roles, profiles and SSO use the SDK chain. */
export function isStorageConfigured(): boolean {
  const config = getConfig()
  return Boolean(config.AWS_REGION && config.AWS_S3_BUCKET && config.AWS_DYNAMODB_CONTENT_TABLE && config.AWS_DYNAMODB_VIDEOS_TABLE)
}

export async function uploadVideoFile(localPath: string, blobPath: string): Promise<string> {
  return s3.uploadFile(blobPath, localPath, 'video/mp4')
}
export const downloadBlobToFile = s3.downloadToFile
export const downloadContentMedia = s3.downloadStream

/** Upload an original recording then conditionally register its run identity. */
export async function uploadRawVideo(localPath: string, runId: string, metadata: {
  originalFilename: string; slug: string; sourceUrl?: string; duration?: number; size: number
}): Promise<string> {
  const table = tables().videos
  const existing = await db.getItem(table, { runId })
  if (existing) return String(existing.blobPath)
  const blobPath = `raw/${encodeURIComponent(runId)}/${randomUUID()}/${encodeURIComponent(metadata.originalFilename)}`
  const now = new Date().toISOString()
  const record = { ...metadata, sourceUrl: metadata.sourceUrl ?? '', duration: metadata.duration ?? 0, runId, blobPath, status: 'completed', contentCount: 0, createdAt: now, processedAt: now }
  db.validateMetadata(record)
  let metadataAttempted = false
  try {
    await s3.uploadFile(blobPath, localPath, 'video/mp4')
    metadataAttempted = true
    if (await db.createItem(table, record, 'runId')) return blobPath
  } catch (error) {
    const persisted = metadataAttempted ? await reconcileWrite(table, { runId }, blobPath) : null
    if (persisted?.blobPath === blobPath) return blobPath
    if (metadataAttempted && persisted === undefined) throw error
    await s3.deleteObject(blobPath).catch(cleanup => logger.warn(`AWS upload cleanup failed: ${String(cleanup)}`))
    if (persisted) return String(persisted.blobPath)
    throw error
  }
  const winner = await db.getItem(table, { runId })
  if (winner?.blobPath === blobPath) return blobPath
  await s3.deleteObject(blobPath)
  if (!winner) throw new Error(`Video upload conflict without existing record: ${runId}`)
  return String(winner.blobPath)
}

/** Isolate each attempt and publish metadata only after every local asset succeeds. */
export async function uploadContentItem(localItemDir: string, itemId: string, videoSlug: string, runId: string, metadata?: Partial<ContentRecord>): Promise<string> {
  return (await createContentItem(localItemDir, itemId, videoSlug, runId, metadata)).blobBasePath
}

/** Conditional import result used by migration to count racing skips accurately. */
export async function createContentItem(localItemDir: string, itemId: string, videoSlug: string, runId: string, metadata?: Partial<ContentRecord>): Promise<{ created: boolean; blobBasePath: string }> {
  const table = tables().content
  const existing = await db.getItem(table, { itemId, videoSlug })
  if (existing) return { created: false, blobBasePath: String(existing.blobBasePath) }
  const { files, record } = await readContentDirectory(localItemDir, runId, metadata)
  const blobBasePath = `content/${encodeURIComponent(videoSlug)}/${encodeURIComponent(itemId)}/${randomUUID()}/`
  const entity = { ...record, itemId, videoSlug, blobBasePath, statusSortKey: `${record.createdAt}#${itemId}#${videoSlug}` }
  db.validateMetadata(entity)
  const owned: string[] = []
  let metadataAttempted = false
  try {
    for (const filename of files) {
      const key = `${blobBasePath}${filename}`
      owned.push(key)
      await s3.uploadFile(key, join(localItemDir, filename), getContentType(filename))
    }
    metadataAttempted = true
    if (await db.createItem(table, entity)) return { created: true, blobBasePath }
  } catch (error) {
    const persisted = metadataAttempted ? await reconcileWrite(table, { itemId, videoSlug }, blobBasePath) : null
    if (persisted?.blobBasePath === blobBasePath) return { created: true, blobBasePath }
    if (metadataAttempted && persisted === undefined) throw error
    await Promise.all(owned.map(key => s3.deleteObject(key).catch(cleanup => logger.warn(`AWS upload cleanup failed: ${String(cleanup)}`))))
    if (persisted) return { created: false, blobBasePath: String(persisted.blobBasePath) }
    throw error
  }
  const winner = await db.getItem(table, { itemId, videoSlug })
  if (winner?.blobBasePath === blobBasePath) return { created: true, blobBasePath }
  await Promise.all(owned.map(key => s3.deleteObject(key).catch(cleanup => logger.warn(`AWS upload cleanup failed: ${String(cleanup)}`))))
  if (!winner) throw new Error(`Content upload conflict without existing record: ${videoSlug}/${itemId}`)
  return { created: false, blobBasePath: String(winner.blobBasePath) }
}

/** Strongly read a complete content identity. */
export async function getContentItem(videoSlug: string, itemId: string): Promise<StoredContentRecord | null> {
  const result = await db.getItem(tables().content, { itemId, videoSlug })
  return result ? content(result) : null
}

/** Query the item-ID base partition, preserving duplicates and selecting newest deterministically. */
export async function findContentItemByRowKey(itemId: string): Promise<StoredContentRecord | null> {
  const records = await db.queryAll({
    TableName: tables().content, KeyConditionExpression: 'itemId = :id', ExpressionAttributeValues: { ':id': itemId },
  })
  records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || String(b.videoSlug).localeCompare(String(a.videoSlug)))
  return records[0] ? content(records[0]) : null
}

/** Query queue indexes, rechecking authoritative records before exposing stale statuses. */
export async function getContentItems(filters?: { videoSlug?: string; status?: string }): Promise<StoredContentRecord[]> {
  const table = tables().content
  let records: Record<string, unknown>[]
  if (filters?.videoSlug) {
    records = await db.queryAll({ TableName: table, IndexName: 'videoSlug-itemId-index', KeyConditionExpression: 'videoSlug = :slug', ExpressionAttributeValues: { ':slug': filters.videoSlug } })
  } else if (filters?.status) {
    records = await db.queryAll({ TableName: table, IndexName: 'status-createdAt-index', KeyConditionExpression: '#status = :status', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':status': filters.status } })
  } else {
    return (await db.scanAll({ TableName: table })).map(content)
  }
  const current = await Promise.all(records.map(row => db.getItem(table, { itemId: row.itemId, videoSlug: row.videoSlug })))
  return current.filter((row): row is Record<string, unknown> => !!row && (!filters?.status || row.status === filters.status)).map(content)
}

/** Validate merged metadata size and condition the update against the authoritative current status. */
export async function updateContentStatus(videoSlug: string, itemId: string, status: ContentRecord['status'], extraFields?: Partial<ContentRecord>): Promise<void> {
  const existing = await getContentItem(videoSlug, itemId)
  if (!existing) throw new Error(`Content item not found: ${videoSlug}/${itemId}`)
  const { itemId: _id, videoSlug: _slug, partitionKey: _partition, rowKey: _row, ...fields } = extraFields ?? {}
  db.validateMetadata({ ...existing, ...fields, status })
  await db.updateItem(tables().content, { itemId, videoSlug }, { ...fields, status }, existing.status)
}

/** Strongly read an uploaded video. */
export async function getVideoRecord(runId: string): Promise<StoredVideoRecord | null> {
  const result = await db.getItem(tables().videos, { runId })
  return result ? video(result) : null
}

/** List videos administratively or through their status index. */
export async function listVideos(status?: string): Promise<StoredVideoRecord[]> {
  const table = tables().videos
  if (!status) return (await db.scanAll({ TableName: table })).map(video)
  const records = await db.queryAll({ TableName: table, IndexName: 'status-createdAt-index', KeyConditionExpression: '#status = :status', ExpressionAttributeNames: { '#status': 'status' }, ExpressionAttributeValues: { ':status': status } })
  const current = await Promise.all(records.map(row => db.getItem(table, { runId: row.runId })))
  return current.filter((row): row is Record<string, unknown> => !!row && row.status === status).map(video)
}

/** Count newly created queue content, while allowing local runs without a source-video record. */
export async function recordUploadedContent(runId: string, count: number): Promise<void> {
  if (count > 0 && await getVideoRecord(runId)) {
    await db.incrementCounter(tables().videos, { runId }, 'contentCount', count)
  }
}

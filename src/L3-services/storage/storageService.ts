import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getConfig } from '../../L1-infra/config/environment.js'
import logger from '../../L1-infra/logger/configLogger.js'
import * as azure from '../azureStorage/azureStorageService.js'
import * as aws from '../awsStorage/awsStorageService.js'
import * as azureBlob from '../../L2-clients/azure/blobClient.js'
import * as azureTable from '../../L2-clients/azure/tableClient.js'
import * as s3 from '../../L2-clients/aws/s3Client.js'
import { validateMetadata } from '../../L2-clients/aws/dynamoClient.js'
import { getContentType, readContentDirectory, resolveVideoSlug } from './contentMetadata.js'
import type { ContentRecord, StoredContentRecord, StorageMigrationResult } from '../../L0-pure/types/index.js'
export type { ContentRecord, VideoRecord, StoredContentRecord, StoredVideoRecord, StorageMigrationResult } from '../../L0-pure/types/index.js'

/** Storage contract shared by Azure and AWS, preserving the existing public call signatures. */
export type StorageBackend = Pick<typeof azure,
  'uploadVideoFile' | 'downloadBlobToFile' | 'uploadRawVideo' | 'uploadContentItem' |
  'getContentItems' | 'getContentItem' | 'findContentItemByRowKey' | 'updateContentStatus' |
  'getVideoRecord' | 'listVideos' | 'downloadContentMedia'>

/** Resolve the provider lazily, never initializing unused backend clients. */
export function getStorageProviderName(): 'azure' | 'aws' {
  const provider = getConfig().STORAGE_PROVIDER ?? 'azure'
  if (provider !== 'azure' && provider !== 'aws') throw new Error(`Unsupported storage provider: ${String(provider)}`)
  return provider
}
function backend(): StorageBackend {
  return getStorageProviderName() === 'aws' ? aws : azure
}
/** Check selected backend configuration without probing credentials or making requests. */
export function isStorageConfigured(): boolean {
  return getStorageProviderName() === 'aws' ? aws.isStorageConfigured() : azure.isAzureConfigured()
}
/** Compatibility alias for legacy storage callers. */
export const isAzureConfigured = isStorageConfigured
export function getRunId(): string { return process.env.GITHUB_RUN_ID || randomUUID() }
export const uploadVideoFile: typeof azure.uploadVideoFile = (localPath, blobPath) => backend().uploadVideoFile(localPath, blobPath)
export const downloadBlobToFile: typeof azure.downloadBlobToFile = (blobPath, localPath) => backend().downloadBlobToFile(blobPath, localPath)
export const uploadRawVideo: typeof azure.uploadRawVideo = (...args) => backend().uploadRawVideo(...args)
export const uploadContentItem: typeof azure.uploadContentItem = (...args) => backend().uploadContentItem(...args)
export const getContentItems: typeof azure.getContentItems = filters => backend().getContentItems(filters)
export const getContentItem: typeof azure.getContentItem = (videoSlug, itemId) => backend().getContentItem(videoSlug, itemId)
export const findContentItemByRowKey: typeof azure.findContentItemByRowKey = itemId => backend().findContentItemByRowKey(itemId)
export const updateContentStatus: typeof azure.updateContentStatus = (...args) => backend().updateContentStatus(...args)
export const getVideoRecord: typeof azure.getVideoRecord = runId => backend().getVideoRecord(runId)
export const listVideos: typeof azure.listVideos = status => backend().listVideos(status)
export const downloadContentMedia: typeof azure.downloadContentMedia = blobPath => backend().downloadContentMedia(blobPath)

/** Small-object writes used by shared review edits. */
export async function uploadStorageBuffer(key: string, buffer: Buffer, contentType?: string): Promise<string> {
  return getStorageProviderName() === 'aws' ? s3.uploadBuffer(key, buffer, contentType) : azureBlob.uploadBuffer(key, buffer, contentType)
}
/** Provider-neutral media stream, retaining S3 byte range response metadata. */
export async function getStorageMediaStream(key: string, range?: string): Promise<{
  stream: import('node:stream').Readable; contentType?: string; contentLength?: number; contentRange?: string; statusCode?: number; acceptRanges?: string
}> {
  if (getStorageProviderName() === 'aws') return s3.getMediaStream(key, range)
  return { stream: await azureBlob.downloadStream(key) }
}

/** Validate cloud URLs before translating their namespace into a backend-relative object key. */
export async function downloadStorageUrlToFile(value: string, localPath: string): Promise<void> {
  if (getStorageProviderName() === 'azure') {
    if (!value.startsWith('blob://') || /[?#]/.test(value)) throw new Error('Azure downloads require a blob:// URL.')
    const key = value.slice('blob://'.length)
    if (!key || key.includes('\\') || key.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid blob URL path.')
    return downloadBlobToFile(key, localPath)
  }
  // Inspect the raw path before URL parsing can normalize dot segments.
  const match = /^s3:\/\/([^/?#]+)\/([^?#]*)$/.exec(value)
  if (!match || match[1] !== getConfig().AWS_S3_BUCKET) throw new Error('S3 URL must use the configured bucket without credentials, query or fragment.')
  let key: string
  try { key = decodeURIComponent(match[2]) } catch { throw new Error('Invalid encoded S3 object path.') }
  if (!key || key.includes('\\') || /[\u0000-\u001f]/.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid S3 object path.')
  const rawPrefix = getConfig().AWS_S3_PREFIX
  let start = 0
  let end = rawPrefix.length
  while (start < end && rawPrefix[start] === '/') start++
  while (end > start && rawPrefix[end - 1] === '/') end--
  const prefix = rawPrefix.slice(start, end)
  if (prefix) {
    if (!key.startsWith(`${prefix}/`) || key.length <= prefix.length + 1) throw new Error('S3 object is outside the configured prefix.')
    key = key.slice(prefix.length + 1)
  }
  await downloadBlobToFile(key, localPath)
}

async function createImportedContent(path: string, id: string, slug: string, runId: string, record: ContentRecord): Promise<boolean> {
  if (getStorageProviderName() === 'aws') return (await aws.createContentItem(path, id, slug, runId, record)).created
  // Azure migration also needs conditional creation and isolated files, unlike legacy pipeline upserts.
  if (await azure.getContentItem(slug, id)) return false
  const { files, record: normalized } = await readContentDirectory(path, runId, record)
  const base = `content/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/${randomUUID()}/`
  const owned: string[] = []
  let metadataAttempted = false
  try {
    for (const filename of files) {
      const key = `${base}${filename}`
      owned.push(key)
      await azureBlob.uploadFile(key, join(path, filename), getContentType(filename))
    }
    metadataAttempted = true
    const tableFields = Object.fromEntries(Object.entries({ ...normalized, blobBasePath: base })
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([name, value]) => [name, typeof value === 'object' ? JSON.stringify(value) : value]))
    await azureTable.createEntity('Content', slug, id, tableFields)
    return true
  } catch (error) {
    const conflict = error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 409
    let existing: StoredContentRecord | null = null
    if (metadataAttempted) {
      try { existing = await azure.getContentItem(slug, id) }
      catch (readError) {
        logger.warn(`Retaining Azure upload attempt ${base}; metadata outcome could not be verified: ${String(readError)}`)
        throw error
      }
      if (existing?.blobBasePath === base) return true
    }
    await Promise.all(owned.map(key => azureBlob.deleteBlob(key).catch(() => {})))
    if (conflict || existing) return false
    throw error
  }
}

/** Import published history before pending content; reruns never reset cloud edits/statuses. */
export async function migrateLocalContent(outputDir: string, options?: { dryRun?: boolean }): Promise<StorageMigrationResult> {
  const result: StorageMigrationResult = { uploaded: 0, skipped: 0, errors: [], eligible: 0, invalid: 0, failed: 0 }
  const identities = new Set<string>()
  const runId = `migration-${randomUUID()}`
  for (const folder of ['published', 'publish-queue']) {
    let entries
    try { entries = await readdir(join(outputDir, folder), { withFileTypes: true }) }
    catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
      result.errors.push(`${folder}: ${error instanceof Error ? error.message : String(error)}`)
      result.failed++
      continue
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      let failureKind: 'invalid' | 'failed' = 'invalid'
      try {
        const path = join(outputDir, folder, entry.name)
        const parsed: unknown = JSON.parse(await readFile(join(path, 'metadata.json'), 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('metadata.json must contain an object')
        const metadata = parsed as Record<string, unknown>
        const id = String(metadata.id ?? metadata.itemId ?? entry.name)
        if (!id) throw new Error('Content identity must not be empty')
        const slug = resolveVideoSlug(metadata, id)
        const identity = JSON.stringify([id, slug])
        if (identities.has(identity)) { result.skipped++; continue }
        identities.add(identity)
        failureKind = 'failed'
        if (await getContentItem(slug, id)) { result.skipped++; continue }
        failureKind = 'invalid'
        const status = folder === 'published' ? 'published' : (metadata.status ?? 'pending_review')
        const { record } = await readContentDirectory(path, runId, { status: status as ContentRecord['status'] })
        if (getStorageProviderName() === 'aws') validateMetadata({ ...record, itemId: id, videoSlug: slug, statusSortKey: `${record.createdAt}#${id}#${slug}` })
        result.eligible++
        if (options?.dryRun) continue
        failureKind = 'failed'
        if (await createImportedContent(path, id, slug, runId, record)) result.uploaded++
        else result.skipped++
      } catch (error) {
        result[failureKind]++
        result.errors.push(`${folder}/${entry.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return result
}

/** Upload only items belonging to a recording, preserving per-item errors. */
export async function uploadPublishQueue(publishQueueDir: string, videoSlug: string, runId: string, options?: { sourceVideoSlug: string }): Promise<{ uploaded: number; errors: string[] }> {
  if (getStorageProviderName() === 'azure') return azure.uploadPublishQueue(publishQueueDir, videoSlug, runId, options)
  const result = { uploaded: 0, errors: [] as string[] }
  let entries
  try { entries = await readdir(publishQueueDir, { withFileTypes: true }) }
  catch (error) { return { uploaded: 0, errors: [`Publish queue directory unavailable: ${String(error)}`] } }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const path = join(publishQueueDir, entry.name)
      const { record, metadata } = await readContentDirectory(path, runId)
      if (resolveVideoSlug(metadata, entry.name) !== (options?.sourceVideoSlug ?? videoSlug)) continue
      if (await createImportedContent(path, String(metadata.id ?? metadata.itemId ?? entry.name), videoSlug, runId, record)) result.uploaded++
    } catch (error) { result.errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`) }
  }
  await aws.recordUploadedContent(runId, result.uploaded)
  return result
}

/** Resolve media through its recorded location, not a reconstructed legacy prefix. */
export async function resolveContentFile(itemId: string, filename: string, videoSlug?: string): Promise<{ record: StoredContentRecord; key: string }> {
  const record = videoSlug ? await getContentItem(videoSlug, itemId) : await findContentItemByRowKey(itemId)
  if (!record) throw Object.assign(new Error(`Content item not found: ${itemId}`), { statusCode: 404 })
  if (!filename || /[\\/]/.test(filename) || ![record.mediaFilename, record.thumbnailFilename].includes(filename)) {
    throw Object.assign(new Error('Invalid media filename'), { statusCode: 400 })
  }
  return { record, key: `${record.blobBasePath || `content/${itemId}/`}${filename}` }
}

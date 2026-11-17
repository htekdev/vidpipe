import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContentRecord } from '../../L0-pure/types/index.js'

/** Shared MIME mapping for review and uploads. */
export function getContentType(filename: string): string {
  const types: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', md: 'text/markdown', json: 'application/json',
    srt: 'text/plain', vtt: 'text/vtt', ass: 'text/plain',
  }
  return types[filename.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream'
}

/** Parse a queue folder without changing source files or dropping source metadata fields. */
export async function readContentDirectory(path: string, runId: string, overrides: Partial<ContentRecord> = {}): Promise<{
  files: string[]; record: ContentRecord; metadata: Record<string, unknown>
}> {
  const entries = await readdir(path, { withFileTypes: true })
  const files = entries.filter(entry => entry.isFile()).map(entry => entry.name).sort()
  let metadata: Record<string, unknown> = {}
  if (files.includes('metadata.json')) {
    const parsed: unknown = JSON.parse(await readFile(join(path, 'metadata.json'), 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('metadata.json must contain an object')
    metadata = parsed as Record<string, unknown>
  }
  const values = { ...metadata, ...overrides }
  const postContent = files.includes('post.md') ? await readFile(join(path, 'post.md'), 'utf8') : String(values.postContent ?? '')
  const mediaFilename = String(values.mediaFilename ?? files.find(file => file.startsWith('media.')) ?? '')
  const thumbnailFilename = String(values.thumbnailFilename ?? files.find(file => file.startsWith('thumbnail.')) ?? '')
  for (const filename of [mediaFilename, thumbnailFilename]) {
    if (filename && (!files.includes(filename) || /[\\/]/.test(filename))) throw new Error(`Missing or invalid media filename: ${filename}`)
  }
  const intentionalTextOnly = !mediaFilename && (values.textOnly === true || values.sourceMediaPath === null)
  const mediaType = intentionalTextOnly ? 'text' : String(values.mediaType ?? (mediaFilename ? (/\.(png|jpe?g|gif|webp)$/i.test(mediaFilename) ? 'image' : 'video') : 'text'))
  if ((mediaType === 'video' || mediaType === 'image') && !mediaFilename) throw new Error(`Missing required ${mediaType} media`)
  const status = String(values.status ?? 'pending_review')
  if (!['pending_review', 'approved', 'published', 'rejected'].includes(status)) throw new Error(`Invalid content status: ${status}`)
  const csv = (value: unknown): string => Array.isArray(value) ? value.map(String).join(',') : String(value ?? '')
  return {
    files, metadata,
    record: {
      ...values, platform: String(values.platform ?? ''), clipType: String(values.clipType ?? ''),
      status: status as ContentRecord['status'], blobBasePath: '', mediaType, mediaFilename, thumbnailFilename, postContent,
      hashtags: csv(values.hashtags), ideaIds: csv(values.ideaIds), characterCount: postContent.length,
      scheduledFor: String(values.scheduledFor ?? values.scheduledDate ?? ''), latePostId: String(values.latePostId ?? ''),
      publishedUrl: String(values.publishedUrl ?? ''), sourceVideoRunId: String(values.sourceVideoRunId ?? runId),
      createdAt: String(values.createdAt ?? new Date().toISOString()), reviewedAt: String(values.reviewedAt ?? ''),
      publishedAt: String(values.publishedAt ?? ''),
    },
  }
}

/** Resolve source relationships across Windows and POSIX metadata, then legacy queue names. */
export function resolveVideoSlug(metadata: Record<string, unknown>, itemId: string): string {
  const explicit = metadata.videoSlug ?? metadata.sourceVideoSlug
  if (typeof explicit === 'string' && explicit.trim()) return explicit
  const source = metadata.sourceVideo
  if (typeof source === 'string' && source.trim()) {
    return source.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop()!.replace(/\.(mp4|mov|mkv|webm)$/i, '')
  }
  const suffix = /-(youtube-shorts|instagram-reels|instagram-feed|twitter|youtube|tiktok|instagram|linkedin|x)$/.exec(itemId)
  if (suffix && suffix.index > 0) return itemId.slice(0, suffix.index)
  throw new Error('Cannot determine source video slug; set videoSlug or sourceVideo in metadata.json')
}

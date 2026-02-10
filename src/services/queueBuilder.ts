import { promises as fs } from 'fs'
import path from 'path'
import logger from '../config/logger'
import { PLATFORM_CHAR_LIMITS, toLateplatform } from '../types'
import { Platform } from '../types'
import type { VideoFile, ShortClip, MediumClip, SocialPost } from '../types'
import { getMediaRule, platformAcceptsMedia } from './platformContentStrategy'
import type { ClipType } from './platformContentStrategy'
import { createItem, itemExists, type QueueItemMetadata } from './postStore'

// ============================================================================
// TYPES
// ============================================================================

export interface QueueBuildResult {
  itemsCreated: number
  itemsSkipped: number
  errors: string[]
}

// ============================================================================
// MEDIA RESOLUTION (driven by platformContentStrategy)
// ============================================================================

/**
 * Resolve the media file path for a short clip on a given platform.
 * Uses the content strategy's variantKey to find the right variant,
 * then falls back to captionedPath → outputPath.
 */
function resolveShortMedia(clip: ShortClip, platform: Platform): string | null {
  const rule = getMediaRule(platform, 'short')
  if (!rule) return null // platform doesn't accept short media

  // If the rule specifies a variant key, look it up
  if (rule.variantKey && clip.variants?.length) {
    const match = clip.variants.find(v => v.platform === rule.variantKey)
    if (match) return match.path

    // Instagram fallback: try instagram-feed when instagram-reels missing
    if (platform === Platform.Instagram) {
      const fallback = clip.variants.find(v => v.platform === 'instagram-feed')
      if (fallback) return fallback.path
    }
  }

  // Fallback: captioned landscape → original
  return rule.captions
    ? (clip.captionedPath ?? clip.outputPath)
    : clip.outputPath
}

/**
 * Resolve the media file path for a medium clip on a given platform.
 */
function resolveMediumMedia(clip: MediumClip, platform: Platform): string | null {
  const rule = getMediaRule(platform, 'medium-clip')
  if (!rule) return null // platform doesn't accept medium-clip media

  return rule.captions
    ? (clip.captionedPath ?? clip.outputPath)
    : clip.outputPath
}

/**
 * Resolve the media file path for a video-level post on a given platform.
 */
function resolveVideoMedia(
  video: VideoFile,
  platform: Platform,
  captionedVideoPath: string | undefined,
): string | null {
  const rule = getMediaRule(platform, 'video')
  if (!rule) return null // platform doesn't accept main-video media

  return rule.captions
    ? (captionedVideoPath ?? path.join(video.videoDir, video.filename))
    : path.join(video.videoDir, video.filename)
}

// ============================================================================
// FRONTMATTER PARSER
// ============================================================================

/**
 * Parse YAML frontmatter from a post markdown file.
 * Handles simple key: value and key: [array] patterns — no yaml library needed.
 */
async function parsePostFrontmatter(postPath: string): Promise<Record<string, string>> {
  let content: string
  try {
    content = await fs.readFile(postPath, 'utf-8')
  } catch {
    return {}
  }

  const result: Record<string, string> = {}
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return result

  const yamlBlock = match[1]
  for (const line of yamlBlock.split(/\r?\n/)) {
    const kvMatch = line.match(/^(\w+):\s*(.*)$/)
    if (!kvMatch) continue

    const key = kvMatch[1]
    let value = kvMatch[2].trim()

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    // Treat 'null' string as empty
    if (value === 'null') continue

    result[key] = value
  }

  return result
}

// ============================================================================
// CONTENT EXTRACTOR
// ============================================================================

/** Strip YAML frontmatter from markdown, returning only the body content. */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export async function buildPublishQueue(
  video: VideoFile,
  shorts: ShortClip[],
  mediumClips: MediumClip[],
  socialPosts: SocialPost[],
  captionedVideoPath: string | undefined,
): Promise<QueueBuildResult> {
  const result: QueueBuildResult = { itemsCreated: 0, itemsSkipped: 0, errors: [] }

  for (const post of socialPosts) {
    try {
      const latePlatform = toLateplatform(post.platform)
      const frontmatter = await parsePostFrontmatter(post.outputPath)

      let clipSlug: string
      let clipType: ClipType
      let mediaPath: string | null = null
      let sourceClip: string | null = null

      if (frontmatter.shortSlug) {
        // Short or medium clip post
        const short = shorts.find(s => s.slug === frontmatter.shortSlug)
        const medium = mediumClips.find(m => m.slug === frontmatter.shortSlug)

        if (short) {
          clipSlug = short.slug
          clipType = 'short'
          sourceClip = path.dirname(short.outputPath)
          mediaPath = resolveShortMedia(short, post.platform)
        } else if (medium) {
          clipSlug = medium.slug
          clipType = 'medium-clip'
          sourceClip = path.dirname(medium.outputPath)
          mediaPath = resolveMediumMedia(medium, post.platform)
        } else {
          clipSlug = frontmatter.shortSlug
          clipType = 'short'
          logger.warn(`Clip not found for slug: ${frontmatter.shortSlug}`)
        }
      } else {
        // Video-level post (stage 10)
        clipSlug = video.slug
        clipType = 'video'
        mediaPath = resolveVideoMedia(video, post.platform, captionedVideoPath)
      }

      // Skip posts for platform+clipType combos not in the content matrix
      if (!platformAcceptsMedia(post.platform, clipType)) {
        logger.debug(`Skipping ${post.platform}/${clipType} — not in content matrix`)
        result.itemsSkipped++
        continue
      }

      const itemId = `${clipSlug}-${latePlatform}`

      // Idempotency: skip if already published
      const exists = await itemExists(itemId)
      if (exists === 'published') {
        result.itemsSkipped++
        continue
      }

      const metadata: QueueItemMetadata = {
        id: itemId,
        platform: latePlatform,
        accountId: '',
        sourceVideo: video.videoDir,
        sourceClip,
        clipType,
        sourceMediaPath: mediaPath,
        hashtags: post.hashtags,
        links: post.links.map(l => typeof l === 'string' ? { url: l } : l),
        characterCount: post.characterCount,
        platformCharLimit: PLATFORM_CHAR_LIMITS[latePlatform] ?? 2200,
        suggestedSlot: null,
        scheduledFor: null,
        status: 'pending_review',
        latePostId: null,
        publishedUrl: null,
        createdAt: new Date().toISOString(),
        reviewedAt: null,
        publishedAt: null,
      }

      // Use raw post content (strip frontmatter if the content includes it)
      const stripped = stripFrontmatter(post.content)
      const postContent = stripped.length > 0 ? stripped : post.content

      await createItem(itemId, metadata, postContent, mediaPath ?? undefined)
      result.itemsCreated++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      result.errors.push(`${post.platform}: ${msg}`)
      logger.error(`Queue builder error for ${post.platform}: ${msg}`)
    }
  }

  logger.info(
    `Queue builder: ${result.itemsCreated} created, ${result.itemsSkipped} skipped, ${result.errors.length} errors`,
  )
  return result
}

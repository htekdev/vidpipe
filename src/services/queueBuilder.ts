import { promises as fs } from 'fs'
import path from 'path'
import logger from '../config/logger'
import { PLATFORM_CHAR_LIMITS, toLateplatform } from '../types'
import type { VideoFile, ShortClip, MediumClip, SocialPost, Platform, VideoPlatform } from '../types'
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
// PLATFORM → VIDEO VARIANT MAPPING
// ============================================================================

const PLATFORM_TO_VIDEO_PLATFORM: Record<string, VideoPlatform> = {
  tiktok: 'tiktok',
  youtube: 'youtube-shorts',
  instagram: 'instagram-reels',
  linkedin: 'linkedin',
  x: 'twitter',
}

const INSTAGRAM_FALLBACK: VideoPlatform = 'instagram-feed'

/**
 * Find the best video variant for a platform from a ShortClip.
 * Falls back to captionedPath → outputPath when no matching variant exists.
 */
function findVariantForPlatform(clip: ShortClip, platform: Platform): string | null {
  if (!clip.variants || clip.variants.length === 0) return null

  const target = PLATFORM_TO_VIDEO_PLATFORM[platform]
  if (!target) return null

  const match = clip.variants.find(v => v.platform === target)
  if (match) return match.path

  // Instagram fallback: try instagram-feed if instagram-reels not found
  if (platform === 'instagram') {
    const fallback = clip.variants.find(v => v.platform === INSTAGRAM_FALLBACK)
    if (fallback) return fallback.path
  }

  return null
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
      let clipType: 'video' | 'short' | 'medium-clip'
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
          mediaPath = findVariantForPlatform(short, post.platform)
            ?? short.captionedPath ?? short.outputPath
        } else if (medium) {
          clipSlug = medium.slug
          clipType = 'medium-clip'
          sourceClip = path.dirname(medium.outputPath)
          mediaPath = medium.captionedPath ?? medium.outputPath
        } else {
          clipSlug = frontmatter.shortSlug
          clipType = 'short'
          logger.warn(`Clip not found for slug: ${frontmatter.shortSlug}`)
        }
      } else {
        // Video-level post (stage 10)
        clipSlug = video.slug
        clipType = 'video'
        if (post.platform === ('youtube' as Platform) && captionedVideoPath) {
          mediaPath = captionedVideoPath
        }
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
        ...(mediaPath == null && { textOnly: true }),
      }

      // Use raw post content (strip frontmatter if the content includes it)
      const postContent = stripFrontmatter(post.content) || post.content

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

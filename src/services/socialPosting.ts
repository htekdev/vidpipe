import { Platform, SocialPost } from '../types'
import logger from '../config/logger'

// ============================================================================
// SOCIAL PLATFORM CLIENT INTERFACE
// ============================================================================

export interface SocialPlatformClient {
  post(content: SocialPost): Promise<{ success: boolean; url?: string; error?: string }>
  validate(content: SocialPost): boolean
}

// ============================================================================
// PLACEHOLDER CLIENT
// ============================================================================

/**
 * Placeholder client used until real platform API integrations are wired up.
 * Each platform will eventually get its own client class.
 */
export class PlaceholderPlatformClient implements SocialPlatformClient {
  constructor(private readonly platform: Platform) {}

  async post(content: SocialPost): Promise<{ success: boolean; url?: string; error?: string }> {
    logger.info(`Placeholder: Would post to ${this.platform}`, {
      platform: this.platform,
      contentLength: content.content.length,
      hashtags: content.hashtags,
    })
    return { success: true }
  }

  validate(_content: SocialPost): boolean {
    // TODO: Implement platform-specific validation (character limits, media requirements, etc.)
    return true
  }
}

// ============================================================================
// PLATFORM CLIENT FACTORY
// ============================================================================

/**
 * Returns the appropriate SocialPlatformClient for a given platform.
 * Currently returns a PlaceholderPlatformClient for all platforms.
 */
export function getPlatformClient(platform: Platform): SocialPlatformClient {
  switch (platform) {
    case Platform.TikTok:
      // TODO: Replace with TikTokClient once TikTok API integration is implemented
      return new PlaceholderPlatformClient(platform)

    case Platform.YouTube:
      // TODO: Replace with YouTubeClient once YouTube Data API integration is implemented
      return new PlaceholderPlatformClient(platform)

    case Platform.Instagram:
      // TODO: Replace with InstagramClient once Instagram Graph API integration is implemented
      return new PlaceholderPlatformClient(platform)

    case Platform.LinkedIn:
      // TODO: Replace with LinkedInClient once LinkedIn API integration is implemented
      return new PlaceholderPlatformClient(platform)

    case Platform.X:
      // TODO: Replace with XClient once X (Twitter) API v2 integration is implemented
      return new PlaceholderPlatformClient(platform)

    default:
      logger.warn(`Unknown platform: ${platform}, using placeholder client`)
      return new PlaceholderPlatformClient(platform)
  }
}

// ============================================================================
// PUBLISH TO ALL PLATFORMS
// ============================================================================

/**
 * Publishes an array of SocialPost items to their respective platforms.
 * Returns a map of platform → result for each post.
 */
export async function publishToAllPlatforms(
  posts: SocialPost[],
): Promise<Map<Platform, { success: boolean; url?: string; error?: string }>> {
  const results = new Map<Platform, { success: boolean; url?: string; error?: string }>()

  for (const post of posts) {
    const client = getPlatformClient(post.platform)

    try {
      const result = await client.post(post)
      results.set(post.platform, result)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error(`Failed to publish to ${post.platform}`, { error: errorMessage })
      results.set(post.platform, { success: false, error: errorMessage })
    }
  }

  return results
}

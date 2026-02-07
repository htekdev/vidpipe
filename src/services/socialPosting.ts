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
    // TODO: Implement platform-specific validation
    // Each platform has different limits:
    //   - TikTok: 2200 char caption, video 15s-10min
    //   - YouTube: 5000 char description, shorts ≤60s
    //   - Instagram: 2200 char caption, reels ≤90s
    //   - LinkedIn: 3000 char post, video ≤10min
    //   - X (Twitter): 280 char tweet, video ≤140s
    logger.warn(`[${this.platform}] Content validation not yet implemented — accepting all content`)
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
      // Expected: TikTok Content Posting API (OAuth 2.0, video upload via URL or file)
      // Docs: https://developers.tiktok.com/doc/content-posting-api-get-started
      logger.warn('[TikTok] Using placeholder client — TikTok Content Posting API not yet integrated')
      return new PlaceholderPlatformClient(platform)

    case Platform.YouTube:
      // TODO: Replace with YouTubeClient once YouTube Data API integration is implemented
      // Expected: YouTube Data API v3 (OAuth 2.0, videos.insert for Shorts upload)
      // Docs: https://developers.google.com/youtube/v3/docs/videos/insert
      logger.warn('[YouTube] Using placeholder client — YouTube Data API v3 not yet integrated')
      return new PlaceholderPlatformClient(platform)

    case Platform.Instagram:
      // TODO: Replace with InstagramClient once Instagram Graph API integration is implemented
      // Expected: Instagram Graph API (OAuth 2.0, Reels publishing via container + publish)
      // Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
      logger.warn('[Instagram] Using placeholder client — Instagram Graph API not yet integrated')
      return new PlaceholderPlatformClient(platform)

    case Platform.LinkedIn:
      // TODO: Replace with LinkedInClient once LinkedIn API integration is implemented
      // Expected: LinkedIn Marketing API (OAuth 2.0, ugcPosts for video + text)
      // Docs: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares
      logger.warn('[LinkedIn] Using placeholder client — LinkedIn Marketing API not yet integrated')
      return new PlaceholderPlatformClient(platform)

    case Platform.X:
      // TODO: Replace with XClient once X (Twitter) API v2 integration is implemented
      // Expected: X API v2 (OAuth 2.0, media upload + tweet creation)
      // Docs: https://developer.x.com/en/docs/x-api/tweets/manage-tweets
      logger.warn('[X] Using placeholder client — X API v2 not yet integrated')
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

/**
 * ShortVideoAsset Class
 *
 * Represents a short clip (15-60s) extracted from a main video.
 * Handles platform variants, social posts, and transcript filtering.
 */
import { VideoAsset } from './VideoAsset.js'
import { SocialPostAsset } from './SocialPostAsset.js'
import { join } from '../L1-infra/paths/paths.js'
import { fileExists, listDirectory, readTextFile, ensureDirectory } from '../L1-infra/fileSystem/fileSystem.js'
import type { AssetOptions } from './Asset.js'
import type { ShortClip, Platform, Transcript, Segment, Word } from '../L0-pure/types/index.js'
import { Platform as PlatformEnum } from '../L0-pure/types/index.js'
import { extractCompositeClip } from '../L4-agents/videoServiceBridge.js'
import type { MainVideoAsset } from './MainVideoAsset.js'

/**
 * A short video clip extracted from a parent video.
 *
 * Short clips are 15-60 second segments designed for social media platforms
 * like TikTok, YouTube Shorts, and Instagram Reels. Each short can have
 * multiple platform-specific variants with different aspect ratios.
 */
export class ShortVideoAsset extends VideoAsset {
  /** Reference to the source video this short was extracted from */
  readonly parent: VideoAsset

  /** Clip metadata including segments, title, and description */
  readonly clip: ShortClip

  /** Directory containing this short's assets (shorts/{clip-slug}/) */
  readonly videoDir: string

  /** URL-safe identifier for this short */
  readonly slug: string

  /**
   * Create a new ShortVideoAsset.
   *
   * @param parent - The source VideoAsset this short was extracted from
   * @param clip - Clip metadata (slug, title, segments, etc.)
   * @param shortsBaseDir - Base directory for all shorts (e.g., recordings/{slug}/shorts/)
   */
  constructor(parent: VideoAsset, clip: ShortClip, shortsBaseDir: string) {
    super()
    this.parent = parent
    this.clip = clip
    this.slug = clip.slug
    this.videoDir = join(shortsBaseDir, clip.slug)
  }

  // ── Paths ────────────────────────────────────────────────────────────────────

  /** Path to the main short video file */
  get videoPath(): string {
    return join(this.videoDir, 'media.mp4')
  }

  /** Directory containing social posts for this short */
  get postsDir(): string {
    return join(this.videoDir, 'posts')
  }

  // ── Platform Variants ────────────────────────────────────────────────────────

  /**
   * Get paths to platform-specific video variants.
   *
   * Each platform may have a different aspect ratio (9:16 for TikTok/Reels,
   * 1:1 for Instagram Feed, etc.). Variants are stored as media-{platform}.mp4.
   *
   * @returns Map of platform to variant file path (only existing files)
   */
  async getPlatformVariants(): Promise<Map<Platform, string>> {
    const variants = new Map<Platform, string>()
    const platforms = Object.values(PlatformEnum)

    await Promise.all(
      platforms.map(async (platform) => {
        const variantPath = join(this.videoDir, `media-${platform}.mp4`)
        if (await fileExists(variantPath)) {
          variants.set(platform, variantPath)
        }
      }),
    )

    return variants
  }

  // ── Social Posts ─────────────────────────────────────────────────────────────

  /**
   * Get social media posts for this short as SocialPostAsset objects.
   * Returns one asset per platform.
   *
   * @returns Array of SocialPostAsset objects (one per platform)
   */
  async getSocialPosts(): Promise<SocialPostAsset[]> {
    const platforms: Platform[] = [
      PlatformEnum.TikTok,
      PlatformEnum.YouTube,
      PlatformEnum.Instagram,
      PlatformEnum.LinkedIn,
      PlatformEnum.X,
    ]
    return platforms.map((platform) => new SocialPostAsset(this, platform, this.postsDir))
  }

  // ── Asset Implementation ─────────────────────────────────────────────────────

  /**
   * Check if the rendered short video exists.
   */
  async exists(): Promise<boolean> {
    return fileExists(this.videoPath)
  }

  /**
   * Get the rendered short video path, extracting from parent if needed.
   *
   * @param opts - Asset options (force regeneration, etc.)
   * @returns Path to the rendered short video
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    if (!opts?.force && await this.exists()) {
      return this.videoPath
    }

    // Ensure output directory exists
    await ensureDirectory(this.videoDir)

    // Get edited video (no overlays, no captions — shorts get their own processing)
    const mainParent = this.parent as MainVideoAsset
    const parentVideo = await mainParent.getEditedVideo()

    // Extract clip using FFmpeg (handles single and composite segments)
    await extractCompositeClip(parentVideo, this.clip.segments, this.videoPath)

    return this.videoPath
  }

  // ── Transcript ───────────────────────────────────────────────────────────────

  /**
   * Get transcript filtered to this short's time range.
   *
   * Uses the parent's ORIGINAL transcript (not adjusted) since short clips
   * reference timestamps in the original video.
   *
   * @param opts - Asset options
   * @returns Transcript containing only segments/words within this clip's time range
   */
  async getTranscript(opts?: AssetOptions): Promise<Transcript> {
    const parentTranscript = await this.parent.getTranscript(opts)

    // Get the overall time range for this short (may be composite)
    const startTime = Math.min(...this.clip.segments.map((s) => s.start))
    const endTime = Math.max(...this.clip.segments.map((s) => s.end))

    // Filter segments that overlap with any of our segments
    const filteredSegments: Segment[] = parentTranscript.segments.filter((seg) =>
      this.clip.segments.some(
        (clipSeg) => seg.start < clipSeg.end && seg.end > clipSeg.start,
      ),
    )

    // Filter words that fall within any of our segments
    const filteredWords: Word[] = parentTranscript.words.filter((word) =>
      this.clip.segments.some(
        (clipSeg) => word.start >= clipSeg.start && word.end <= clipSeg.end,
      ),
    )

    // Build filtered text from filtered segments
    const filteredText = filteredSegments.map((s) => s.text).join(' ')

    return {
      text: filteredText,
      segments: filteredSegments,
      words: filteredWords,
      language: parentTranscript.language,
      duration: this.clip.totalDuration,
    }
  }
}

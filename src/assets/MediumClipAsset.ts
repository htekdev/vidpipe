/**
 * MediumClipAsset - Represents a medium-length clip (60-180s)
 *
 * Medium clips are longer-form content extracted from the full video,
 * typically covering a complete topic or tutorial segment. Unlike shorts,
 * medium clips don't need platform variants (portrait/square) - they're
 * rendered in the original aspect ratio.
 */
import { VideoAsset } from './VideoAsset.js'
import { SocialPostAsset } from './SocialPostAsset.js'
import { join } from '../core/paths.js'
import { fileExists, ensureDirectory } from '../core/fileSystem.js'
import type { MediumClip, Platform } from '../types/index.js'
import { Platform as PlatformEnum } from '../types/index.js'
import type { AssetOptions } from './Asset.js'
import { extractCompositeClip } from '../tools/ffmpeg/clipExtraction.js'
import type { MainVideoAsset } from './MainVideoAsset.js'

/**
 * Asset representing a medium-length clip extracted from a longer video.
 *
 * Medium clips are 60-180 second segments that cover complete topics.
 * They're stored in a dedicated directory with their own captions and
 * social media posts.
 */
export class MediumClipAsset extends VideoAsset {
  /** Parent video this clip was extracted from */
  readonly parent: VideoAsset

  /** Clip metadata (start/end times, title, segments) */
  readonly clip: MediumClip

  /** Directory containing this clip's assets */
  readonly videoDir: string

  /** URL-safe identifier for this clip */
  readonly slug: string

  /**
   * Create a medium clip asset.
   *
   * @param parent - The source video this clip was extracted from
   * @param clip - Clip metadata including time ranges and title
   * @param clipsBaseDir - Base directory for all medium clips (e.g., recordings/{slug}/medium-clips)
   */
  constructor(parent: VideoAsset, clip: MediumClip, clipsBaseDir: string) {
    super()
    this.parent = parent
    this.clip = clip
    this.slug = clip.slug
    this.videoDir = join(clipsBaseDir, clip.slug)
  }

  // ── Paths ──────────────────────────────────────────────────────────────────

  /**
   * Path to the rendered clip video file.
   */
  get videoPath(): string {
    return join(this.videoDir, 'media.mp4')
  }

  /**
   * Directory containing social media posts for this clip.
   */
  get postsDir(): string {
    return join(this.videoDir, 'posts')
  }

  // ── Social Posts ───────────────────────────────────────────────────────────

  /**
   * Get social media posts for this medium clip as SocialPostAsset objects.
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

  // ── Asset Implementation ───────────────────────────────────────────────────

  /**
   * Check if the rendered clip exists on disk.
   */
  async exists(): Promise<boolean> {
    return fileExists(this.videoPath)
  }

  /**
   * Get the rendered clip video path, extracting from parent if needed.
   * Extracts from the enhanced video so AI-generated overlays carry through.
   *
   * @param opts - Asset options (force regeneration, etc.)
   * @returns Path to the rendered video file
   */
  async getResult(opts?: AssetOptions): Promise<string> {
    if (!opts?.force && (await this.exists())) {
      return this.videoPath
    }

    // Ensure output directory exists
    await ensureDirectory(this.videoDir)

    // Get enhanced video (with overlays, no captions — medium clips get their own captioning)
    const mainParent = this.parent as MainVideoAsset
    const parentVideo = await mainParent.getEnhancedVideo()

    // Extract clip using FFmpeg (handles single and composite segments)
    await extractCompositeClip(parentVideo, this.clip.segments, this.videoPath)

    return this.videoPath
  }
}

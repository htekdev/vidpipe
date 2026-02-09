import { Platform } from '../types'
import type { VideoPlatform } from '../types'

// ============================================================================
// TYPES
// ============================================================================

export type ClipType = 'video' | 'short' | 'medium-clip'

/** How to resolve media for a specific platform + clip type combination. */
export interface MediaRule {
  /** Use the captioned variant when available */
  captions: boolean
  /**
   * Variant key to look up in ShortClip.variants / MediumClip.variants.
   * null = use the captioned/original clip directly (no variant lookup).
   */
  variantKey: VideoPlatform | null
}

// ============================================================================
// CONTENT MATRIX
// ============================================================================

/**
 * Central content matrix — defines what clip types each platform accepts
 * and how to resolve the media file for each.
 *
 * If a platform + clipType combination is NOT listed, that post type is
 * text-only (no media attached).
 *
 * | Platform  | video (main)        | short                | medium-clip         |
 * |-----------|---------------------|----------------------|---------------------|
 * | YouTube   | original, captioned | 9:16 portrait        | original, captioned |
 * | LinkedIn  | —                   | —                    | original, captioned |
 * | TikTok    | —                   | 9:16 portrait        | —                   |
 * | Instagram | —                   | 9:16 reels + 4:5 feed| original, captioned |
 * | X/Twitter | —                   | original, captioned  | —                   |
 *
 * Posts whose clip type has no entry here will still be created but without
 * media (the social-media agents decide which clip types get posts per platform).
 */
const CONTENT_MATRIX: Record<Platform, Partial<Record<ClipType, MediaRule>>> = {
  [Platform.YouTube]: {
    video:          { captions: true, variantKey: null },
    short:          { captions: true, variantKey: 'youtube-shorts' },
    'medium-clip':  { captions: true, variantKey: null },
  },
  [Platform.LinkedIn]: {
    'medium-clip':  { captions: true, variantKey: null },
  },
  [Platform.TikTok]: {
    short:          { captions: true, variantKey: 'tiktok' },
  },
  [Platform.Instagram]: {
    short:          { captions: true, variantKey: 'instagram-reels' },
    'medium-clip':  { captions: true, variantKey: null },
  },
  [Platform.X]: {
    short:          { captions: true, variantKey: null },
  },
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get the media rule for a platform + clip type.
 * Returns null if that combination should be text-only.
 */
export function getMediaRule(platform: Platform, clipType: ClipType): MediaRule | null {
  return CONTENT_MATRIX[platform]?.[clipType] ?? null
}

/**
 * Check whether a platform accepts a given clip type (i.e. should attach media).
 */
export function platformAcceptsMedia(platform: Platform, clipType: ClipType): boolean {
  return getMediaRule(platform, clipType) !== null
}

/**
 * Pipeline Spec type definitions.
 *
 * A PipelineSpec declaratively describes how the video-editing pipeline should
 * behave — which stages run, how clips are selected, and how content is
 * distributed.  Specs can be shipped as built-in presets (`full`, `clean`,
 * `minimal`), loaded from YAML files, or constructed programmatically.
 *
 * ### Merge semantics
 * When both a spec and SKIP_* flags are present the spec acts as the *base*
 * configuration.  SKIP_* flags can only *disable* stages — they never enable
 * something the spec has disabled.
 */

// ─── Clip Strategy ───────────────────────────────────────────────────────────

/**
 * How clip segments are ordered in the final output.
 *
 * - `hook-first`   – Reorder segments so the most compelling moment plays first
 *                    (current shorts behaviour: cold-open, curiosity-gap, etc.)
 * - `chronological` – Preserve the original video order (no hook reordering).
 */
export type ClipStrategy = 'hook-first' | 'chronological'

/**
 * How social-media post copy is adapted for each platform.
 *
 * - `per-platform` – TikTok gets casual / emoji-heavy copy, LinkedIn gets
 *                    professional copy, etc. (current default behaviour).
 * - `unified`      – Same tone and format for every platform.
 */
export type ToneStrategy = 'unified' | 'per-platform'

// ─── Config Sections ─────────────────────────────────────────────────────────

/** Minimum / maximum clip duration in **seconds**. */
export interface DurationRange {
  readonly min: number
  readonly max: number
}

/** Configuration for one clip tier (shorts *or* medium). */
export interface ClipConfig {
  /** Whether this clip tier is enabled. */
  readonly enabled: boolean

  /**
   * Segment ordering strategy.
   * Only meaningful when `enabled` is true.
   * @default 'chronological' for medium, 'hook-first' for shorts
   */
  readonly strategy?: ClipStrategy

  /** Acceptable clip duration range. */
  readonly duration?: DurationRange

  /**
   * Minimum viral-score (1–20) a clip must reach to be extracted.
   * Lower values accept more clips; higher values are more selective.
   */
  readonly minViralScore?: number

  /** Maximum number of clips to extract from a single video. */
  readonly maxClips?: number
}

/** Video-processing stage toggles. */
export interface ProcessingConfig {
  readonly silenceRemoval: boolean
  readonly visualEnhancement: boolean
  readonly captions: boolean
  readonly introOutro: boolean
}

/** Clip extraction config (both tiers). */
export interface ClipsConfig {
  readonly shorts: ClipConfig
  readonly medium: ClipConfig
}

/** Content-generation toggles. */
export interface ContentConfig {
  readonly chapters: boolean
  readonly summary: boolean
  readonly blog: boolean
}

/** Platform targeting and distribution strategy. */
export interface PlatformConfig {
  /** Which platforms to generate content for. */
  readonly targets: readonly string[]

  /** How post copy is adapted across platforms. */
  readonly toneStrategy: ToneStrategy

  /**
   * Whether to generate platform-specific aspect-ratio variants
   * (9:16, 1:1, 4:5) for clips.  When `false`, only the original
   * landscape video is used everywhere.
   */
  readonly variants: boolean
}

/** Distribution / publishing config. */
export interface DistributionConfig {
  /** Master toggle for all social-media stages. */
  readonly enabled: boolean

  /** Whether to build the publish queue (queue-build stage). */
  readonly publish: boolean

  /** Platform-level configuration. */
  readonly platforms: PlatformConfig
}

/**
 * Complete pipeline specification.
 *
 * A spec fully describes which pipeline stages run, how clips are selected
 * and ordered, and how content is distributed across social platforms.
 *
 * All fields are required in a *resolved* spec (after merging with defaults).
 * Partial specs are accepted as input and filled in by the merger.
 */
export interface PipelineSpec {
  /** Human-readable name (e.g. `'clean'`). */
  readonly name: string

  /** One-line description shown in `vidpipe specs` output. */
  readonly description: string

  /** Video-processing stage toggles. */
  readonly processing: ProcessingConfig

  /** Clip extraction configuration. */
  readonly clips: ClipsConfig

  /** Content-generation toggles. */
  readonly content: ContentConfig

  /** Distribution / publishing configuration. */
  readonly distribution: DistributionConfig
}

// ─── Partial Spec (for user input / YAML files) ─────────────────────────────

/** Deep-partial clip config — allows partial duration overrides. */
export interface PartialClipConfig {
  readonly enabled?: boolean
  readonly strategy?: ClipStrategy
  readonly duration?: Partial<DurationRange>
  readonly minViralScore?: number
  readonly maxClips?: number
}

/** Deep-partial version of PipelineSpec for user-provided input. */
export interface PartialPipelineSpec {
  readonly name?: string
  readonly description?: string
  readonly processing?: Partial<ProcessingConfig>
  readonly clips?: {
    readonly shorts?: PartialClipConfig
    readonly medium?: PartialClipConfig
  }
  readonly content?: Partial<ContentConfig>
  readonly distribution?: {
    readonly enabled?: boolean
    readonly publish?: boolean
    readonly platforms?: Partial<PlatformConfig>
  }
}

// ─── Skip Flags (for merger) ─────────────────────────────────────────────────

/**
 * The subset of resolved config that represents stage-skip flags.
 * Used by the merger to overlay CLI / env-var flags onto a spec.
 */
export interface SkipFlags {
  readonly SKIP_SILENCE_REMOVAL?: boolean
  readonly SKIP_VISUAL_ENHANCEMENT?: boolean
  readonly SKIP_CAPTIONS?: boolean
  readonly SKIP_INTRO_OUTRO?: boolean
  readonly SKIP_SHORTS?: boolean
  readonly SKIP_MEDIUM_CLIPS?: boolean
  readonly SKIP_SOCIAL?: boolean
  readonly SKIP_SOCIAL_PUBLISH?: boolean
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** A single validation error from `validateSpec()`. */
export interface SpecValidationError {
  readonly path: string
  readonly message: string
}

// ─── Preset Names ────────────────────────────────────────────────────────────

/** Names of built-in presets. */
export type PresetName = 'full' | 'clean' | 'minimal'

/** Type guard for preset names. */
export function isPresetName(value: string): value is PresetName {
  return value === 'full' || value === 'clean' || value === 'minimal'
}

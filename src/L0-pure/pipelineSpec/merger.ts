/**
 * Merge a partial spec with defaults and overlay SKIP_* flags.
 *
 * ### Resolution order
 * 1. Start with a base spec (a preset or the `full` preset as default)
 * 2. Deep-merge the user's partial spec on top
 * 3. Apply SKIP_* flag overrides — flags can only *disable* stages
 *
 * This module is L0-pure — no I/O, no imports above L0.
 */

import type {
  PipelineSpec,
  PartialPipelineSpec,
  PartialClipConfig,
  SkipFlags,
  ClipConfig,
  DurationRange,
} from './types.js'
import { PRESET_FULL } from './presets.js'

// ─── Deep merge helpers ──────────────────────────────────────────────────────

function mergeDuration(base: DurationRange | undefined, override: Partial<DurationRange> | undefined): DurationRange | undefined {
  if (!override) return base
  if (!base) return override as DurationRange
  return {
    min: override.min ?? base.min,
    max: override.max ?? base.max,
  }
}

function mergeClipConfig(base: ClipConfig, override: PartialClipConfig | undefined): ClipConfig {
  if (!override) return base
  return {
    enabled: override.enabled ?? base.enabled,
    strategy: override.strategy ?? base.strategy,
    duration: mergeDuration(base.duration, override.duration),
    minViralScore: override.minViralScore ?? base.minViralScore,
    maxClips: override.maxClips ?? base.maxClips,
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Merge a partial spec onto a base spec, filling missing values from the base.
 *
 * @param partial - User-provided (potentially incomplete) spec
 * @param base    - Base spec to fill missing values from (defaults to `full`)
 * @returns A fully-resolved PipelineSpec
 */
export function mergeWithDefaults(
  partial: PartialPipelineSpec,
  base: PipelineSpec = PRESET_FULL,
): PipelineSpec {
  return {
    name: partial.name ?? base.name,
    description: partial.description ?? base.description,

    processing: {
      silenceRemoval: partial.processing?.silenceRemoval ?? base.processing.silenceRemoval,
      visualEnhancement: partial.processing?.visualEnhancement ?? base.processing.visualEnhancement,
      captions: partial.processing?.captions ?? base.processing.captions,
      introOutro: partial.processing?.introOutro ?? base.processing.introOutro,
    },

    clips: {
      shorts: mergeClipConfig(base.clips.shorts, partial.clips?.shorts),
      medium: mergeClipConfig(base.clips.medium, partial.clips?.medium),
    },

    content: {
      chapters: partial.content?.chapters ?? base.content.chapters,
      summary: partial.content?.summary ?? base.content.summary,
      blog: partial.content?.blog ?? base.content.blog,
    },

    distribution: {
      enabled: partial.distribution?.enabled ?? base.distribution.enabled,
      publish: partial.distribution?.publish ?? base.distribution.publish,
      platforms: {
        targets: partial.distribution?.platforms?.targets ?? base.distribution.platforms.targets,
        toneStrategy: partial.distribution?.platforms?.toneStrategy ?? base.distribution.platforms.toneStrategy,
        variants: partial.distribution?.platforms?.variants ?? base.distribution.platforms.variants,
      },
    },
  }
}

/**
 * Apply SKIP_* flag overrides onto a resolved spec.
 *
 * Flags can only **disable** stages — they never enable something
 * the spec has disabled.  This preserves backward compatibility:
 * `--no-shorts` always disables shorts, regardless of the spec.
 *
 * @param spec  - Fully resolved spec (from preset or user file)
 * @param flags - SKIP_* flags from CLI / env vars
 * @returns A new spec with flags applied
 */
export function applySkipFlags(spec: PipelineSpec, flags: SkipFlags): PipelineSpec {
  return {
    ...spec,

    processing: {
      silenceRemoval: spec.processing.silenceRemoval && !flags.SKIP_SILENCE_REMOVAL,
      visualEnhancement: spec.processing.visualEnhancement && !flags.SKIP_VISUAL_ENHANCEMENT,
      captions: spec.processing.captions && !flags.SKIP_CAPTIONS,
      introOutro: spec.processing.introOutro && !flags.SKIP_INTRO_OUTRO,
    },

    clips: {
      shorts: {
        ...spec.clips.shorts,
        enabled: spec.clips.shorts.enabled && !flags.SKIP_SHORTS,
      },
      medium: {
        ...spec.clips.medium,
        enabled: spec.clips.medium.enabled && !flags.SKIP_MEDIUM_CLIPS,
      },
    },

    distribution: {
      ...spec.distribution,
      enabled: spec.distribution.enabled && !flags.SKIP_SOCIAL,
      publish: spec.distribution.publish && !flags.SKIP_SOCIAL_PUBLISH,
    },
  }
}

/**
 * Build a resolved spec from SKIP_* flags alone (no user spec provided).
 *
 * This produces a spec equivalent to the current behaviour when no `--spec`
 * flag is passed — the `full` preset with SKIP_* overrides applied.
 */
export function resolveFromFlags(flags: SkipFlags): PipelineSpec {
  return applySkipFlags(PRESET_FULL, flags)
}

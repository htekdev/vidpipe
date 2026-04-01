/**
 * Built-in pipeline presets.
 *
 * Each preset is a fully-resolved {@link PipelineSpec} that can be used
 * directly or as a starting-point for custom specs.
 *
 * | Preset    | Use case                                            |
 * |-----------|-----------------------------------------------------|
 * | `full`    | Maximum content production (current default)        |
 * | `clean`   | Substance over virality — longer clips, same tone   |
 * | `minimal` | Just clean up the video — no clips, no social       |
 */

import type { PipelineSpec, PresetName } from './types.js'

// ─── full ────────────────────────────────────────────────────────────────────

/** Current default behaviour — hook-first shorts, per-platform everything. */
export const PRESET_FULL: PipelineSpec = {
  name: 'full',
  description: 'Full pipeline with hook-first shorts, per-platform optimization',

  processing: {
    silenceRemoval: true,
    visualEnhancement: true,
    captions: true,
    introOutro: true,
  },

  clips: {
    shorts: {
      enabled: true,
      strategy: 'hook-first',
      duration: { min: 15, max: 60 },
      minViralScore: 8,
      maxClips: 5,
    },
    medium: {
      enabled: true,
      strategy: 'chronological',
      duration: { min: 60, max: 180 },
      minViralScore: 10,
      maxClips: 5,
    },
  },

  content: {
    chapters: true,
    summary: true,
    blog: true,
  },

  distribution: {
    enabled: true,
    publish: true,
    platforms: {
      targets: ['youtube', 'linkedin', 'instagram', 'x', 'tiktok'],
      toneStrategy: 'per-platform',
      variants: true,
    },
  },
} as const

// ─── clean ───────────────────────────────────────────────────────────────────

/**
 * Substance-over-virality preset.
 *
 * - No shorts (no hook-first reordering)
 * - Medium clips with extended duration (up to 10 min) and chronological order
 * - Unified platform tone — same post everywhere
 * - No platform-specific aspect-ratio variants
 */
export const PRESET_CLEAN: PipelineSpec = {
  name: 'clean',
  description: 'Simple cleanup with longer clips and unified platform handling',

  processing: {
    silenceRemoval: true,
    visualEnhancement: false,
    captions: true,
    introOutro: true,
  },

  clips: {
    shorts: {
      enabled: false,
    },
    medium: {
      enabled: true,
      strategy: 'chronological',
      duration: { min: 60, max: 600 },
      minViralScore: 6,
      maxClips: 5,
    },
  },

  content: {
    chapters: true,
    summary: true,
    blog: true,
  },

  distribution: {
    enabled: true,
    publish: true,
    platforms: {
      targets: ['youtube', 'linkedin', 'instagram', 'x', 'tiktok'],
      toneStrategy: 'unified',
      variants: false,
    },
  },
} as const

// ─── minimal ─────────────────────────────────────────────────────────────────

/** Just clean up the video — no clips, no social posts. */
export const PRESET_MINIMAL: PipelineSpec = {
  name: 'minimal',
  description: 'Cleanup only — no clips, no social, no blog',

  processing: {
    silenceRemoval: true,
    visualEnhancement: false,
    captions: true,
    introOutro: false,
  },

  clips: {
    shorts: {
      enabled: false,
    },
    medium: {
      enabled: false,
    },
  },

  content: {
    chapters: true,
    summary: true,
    blog: false,
  },

  distribution: {
    enabled: false,
    publish: false,
    platforms: {
      targets: [],
      toneStrategy: 'unified',
      variants: false,
    },
  },
} as const

// ─── Lookup ──────────────────────────────────────────────────────────────────

/** All presets keyed by name. */
export const PRESETS: Readonly<Record<PresetName, PipelineSpec>> = {
  full: PRESET_FULL,
  clean: PRESET_CLEAN,
  minimal: PRESET_MINIMAL,
}

/** Return the preset for a given name, or `undefined` if not found. */
export function getPreset(name: string): PipelineSpec | undefined {
  return PRESETS[name as PresetName]
}

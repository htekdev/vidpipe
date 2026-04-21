/**
 * Barrel export for pipeline spec utilities.
 */
export type {
  ClipStrategy,
  ToneStrategy,
  DurationRange,
  ClipConfig,
  PartialClipConfig,
  ProcessingConfig,
  ClipsConfig,
  ContentConfig,
  PlatformConfig,
  DistributionConfig,
  PipelineSpec,
  PartialPipelineSpec,
  SkipFlags,
  SpecValidationError,
  PresetName,
} from './types.js'

export { isPresetName } from './types.js'
export { PRESET_FULL, PRESET_CLEAN, PRESET_MINIMAL, PRESETS, getPreset } from './presets.js'
export { validateSpec } from './validation.js'
export { mergeWithDefaults, applySkipFlags, resolveFromFlags } from './merger.js'

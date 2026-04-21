import { describe, test, expect } from 'vitest'
import {
  mergeWithDefaults,
  applySkipFlags,
  resolveFromFlags,
} from '../../../../L0-pure/pipelineSpec/merger.js'
import {
  PRESET_FULL,
  PRESET_CLEAN,
  PRESET_MINIMAL,
} from '../../../../L0-pure/pipelineSpec/presets.js'

// ─── mergeWithDefaults ───────────────────────────────────────────────────────

describe('mergeWithDefaults', () => {
  test('empty partial returns full preset values', () => {
    const result = mergeWithDefaults({})
    expect(result.name).toBe(PRESET_FULL.name)
    expect(result.description).toBe(PRESET_FULL.description)
    expect(result.processing).toEqual(PRESET_FULL.processing)
    expect(result.clips.shorts).toEqual(PRESET_FULL.clips.shorts)
    expect(result.clips.medium).toEqual(PRESET_FULL.clips.medium)
    expect(result.content).toEqual(PRESET_FULL.content)
    expect(result.distribution).toEqual(PRESET_FULL.distribution)
  })

  test('disabling shorts keeps all other fields from full', () => {
    const result = mergeWithDefaults({
      clips: { shorts: { enabled: false } },
    })
    expect(result.clips.shorts.enabled).toBe(false)
    // Other shorts fields preserved from full
    expect(result.clips.shorts.strategy).toBe(PRESET_FULL.clips.shorts.strategy)
    expect(result.clips.shorts.duration).toEqual(PRESET_FULL.clips.shorts.duration)
    expect(result.clips.shorts.minViralScore).toBe(PRESET_FULL.clips.shorts.minViralScore)
    expect(result.clips.shorts.maxClips).toBe(PRESET_FULL.clips.shorts.maxClips)
    // Medium untouched
    expect(result.clips.medium).toEqual(PRESET_FULL.clips.medium)
    // Processing untouched
    expect(result.processing).toEqual(PRESET_FULL.processing)
  })

  test('overriding toneStrategy keeps other platform fields', () => {
    const result = mergeWithDefaults({
      distribution: { platforms: { toneStrategy: 'unified' } },
    })
    expect(result.distribution.platforms.toneStrategy).toBe('unified')
    // Other platform fields preserved
    expect(result.distribution.platforms.targets).toEqual(PRESET_FULL.distribution.platforms.targets)
    expect(result.distribution.platforms.variants).toBe(PRESET_FULL.distribution.platforms.variants)
    // Distribution toggles preserved
    expect(result.distribution.enabled).toBe(PRESET_FULL.distribution.enabled)
    expect(result.distribution.publish).toBe(PRESET_FULL.distribution.publish)
  })

  test('partial duration override of min only keeps base max', () => {
    const result = mergeWithDefaults({
      clips: { shorts: { duration: { min: 5 } } },
    })
    expect(result.clips.shorts.duration?.min).toBe(5)
    expect(result.clips.shorts.duration?.max).toBe(PRESET_FULL.clips.shorts.duration?.max)
  })

  test('partial duration override of max only keeps base min', () => {
    const result = mergeWithDefaults({
      clips: { medium: { duration: { max: 300 } } },
    })
    expect(result.clips.medium.duration?.min).toBe(PRESET_FULL.clips.medium.duration?.min)
    expect(result.clips.medium.duration?.max).toBe(300)
  })

  test('overriding name and description', () => {
    const result = mergeWithDefaults({
      name: 'custom',
      description: 'My custom pipeline',
    })
    expect(result.name).toBe('custom')
    expect(result.description).toBe('My custom pipeline')
    // Everything else from full
    expect(result.processing).toEqual(PRESET_FULL.processing)
  })

  test('overriding content fields independently', () => {
    const result = mergeWithDefaults({
      content: { blog: false },
    })
    expect(result.content.blog).toBe(false)
    expect(result.content.chapters).toBe(PRESET_FULL.content.chapters)
    expect(result.content.summary).toBe(PRESET_FULL.content.summary)
  })

  test('overriding processing fields independently', () => {
    const result = mergeWithDefaults({
      processing: { visualEnhancement: false },
    })
    expect(result.processing.visualEnhancement).toBe(false)
    expect(result.processing.silenceRemoval).toBe(PRESET_FULL.processing.silenceRemoval)
    expect(result.processing.captions).toBe(PRESET_FULL.processing.captions)
    expect(result.processing.introOutro).toBe(PRESET_FULL.processing.introOutro)
  })

  test('using clean preset as base', () => {
    const result = mergeWithDefaults(
      { clips: { medium: { maxClips: 10 } } },
      PRESET_CLEAN,
    )
    expect(result.name).toBe('clean')
    expect(result.clips.medium.maxClips).toBe(10)
    expect(result.clips.medium.strategy).toBe(PRESET_CLEAN.clips.medium.strategy)
    expect(result.clips.shorts.enabled).toBe(false)
  })

  test('returns new object — does not mutate base', () => {
    const before = JSON.parse(JSON.stringify(PRESET_FULL))
    mergeWithDefaults({ name: 'modified' })
    expect(PRESET_FULL.name).toBe(before.name)
  })
})

// ─── applySkipFlags ──────────────────────────────────────────────────────────

describe('applySkipFlags', () => {
  test('empty flags → spec unchanged', () => {
    const result = applySkipFlags(PRESET_FULL, {})
    expect(result.clips.shorts.enabled).toBe(true)
    expect(result.clips.medium.enabled).toBe(true)
    expect(result.distribution.enabled).toBe(true)
    expect(result.processing.silenceRemoval).toBe(true)
  })

  test('SKIP_SHORTS disables shorts only', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SHORTS: true })
    expect(result.clips.shorts.enabled).toBe(false)
    // Everything else unchanged
    expect(result.clips.medium.enabled).toBe(true)
    expect(result.distribution.enabled).toBe(true)
    expect(result.processing.silenceRemoval).toBe(true)
  })

  test('SKIP_SHORTS on clean preset keeps shorts disabled', () => {
    const result = applySkipFlags(PRESET_CLEAN, { SKIP_SHORTS: true })
    expect(result.clips.shorts.enabled).toBe(false)
  })

  test('SKIP_MEDIUM_CLIPS disables medium clips', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_MEDIUM_CLIPS: true })
    expect(result.clips.medium.enabled).toBe(false)
    expect(result.clips.shorts.enabled).toBe(true)
  })

  test('SKIP_SOCIAL disables distribution.enabled', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SOCIAL: true })
    expect(result.distribution.enabled).toBe(false)
    // Publish is independent of SKIP_SOCIAL flag
    expect(result.distribution.publish).toBe(true)
  })

  test('SKIP_SOCIAL_PUBLISH disables distribution.publish', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SOCIAL_PUBLISH: true })
    expect(result.distribution.publish).toBe(false)
    expect(result.distribution.enabled).toBe(true)
  })

  test('SKIP_SILENCE_REMOVAL disables silenceRemoval', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SILENCE_REMOVAL: true })
    expect(result.processing.silenceRemoval).toBe(false)
    expect(result.processing.captions).toBe(true)
  })

  test('SKIP_VISUAL_ENHANCEMENT disables visualEnhancement', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_VISUAL_ENHANCEMENT: true })
    expect(result.processing.visualEnhancement).toBe(false)
  })

  test('SKIP_CAPTIONS disables captions', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_CAPTIONS: true })
    expect(result.processing.captions).toBe(false)
  })

  test('SKIP_INTRO_OUTRO disables introOutro', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_INTRO_OUTRO: true })
    expect(result.processing.introOutro).toBe(false)
  })

  test('multiple flags at once', () => {
    const result = applySkipFlags(PRESET_FULL, {
      SKIP_SHORTS: true,
      SKIP_MEDIUM_CLIPS: true,
      SKIP_SOCIAL: true,
      SKIP_CAPTIONS: true,
    })
    expect(result.clips.shorts.enabled).toBe(false)
    expect(result.clips.medium.enabled).toBe(false)
    expect(result.distribution.enabled).toBe(false)
    expect(result.processing.captions).toBe(false)
    // Non-flagged fields remain
    expect(result.processing.silenceRemoval).toBe(true)
    expect(result.processing.visualEnhancement).toBe(true)
    expect(result.content).toEqual(PRESET_FULL.content)
  })

  test('flags cannot enable something the spec has disabled', () => {
    // SKIP_SHORTS: false should not enable shorts on minimal
    const result = applySkipFlags(PRESET_MINIMAL, { SKIP_SHORTS: false })
    expect(result.clips.shorts.enabled).toBe(false)
  })

  test('preserves non-enabled clip config fields', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SHORTS: true })
    // strategy, duration, etc. should be spread from original
    expect(result.clips.shorts.strategy).toBe(PRESET_FULL.clips.shorts.strategy)
    expect(result.clips.shorts.duration).toEqual(PRESET_FULL.clips.shorts.duration)
  })

  test('preserves platform config through distribution skip', () => {
    const result = applySkipFlags(PRESET_FULL, { SKIP_SOCIAL: true })
    expect(result.distribution.platforms).toEqual(PRESET_FULL.distribution.platforms)
  })

  test('returns new object — does not mutate input spec', () => {
    const before = JSON.parse(JSON.stringify(PRESET_FULL))
    applySkipFlags(PRESET_FULL, { SKIP_SHORTS: true })
    expect(PRESET_FULL.clips.shorts.enabled).toBe(before.clips.shorts.enabled)
  })
})

// ─── resolveFromFlags ────────────────────────────────────────────────────────

describe('resolveFromFlags', () => {
  test('empty flags returns full preset equivalent', () => {
    const result = resolveFromFlags({})
    expect(result.name).toBe(PRESET_FULL.name)
    expect(result.clips.shorts.enabled).toBe(true)
    expect(result.clips.medium.enabled).toBe(true)
    expect(result.distribution.enabled).toBe(true)
    expect(result.processing).toEqual(PRESET_FULL.processing)
    expect(result.content).toEqual(PRESET_FULL.content)
  })

  test('SKIP_SHORTS + SKIP_MEDIUM_CLIPS disables both clip tiers', () => {
    const result = resolveFromFlags({
      SKIP_SHORTS: true,
      SKIP_MEDIUM_CLIPS: true,
    })
    expect(result.clips.shorts.enabled).toBe(false)
    expect(result.clips.medium.enabled).toBe(false)
    // Distribution still on
    expect(result.distribution.enabled).toBe(true)
  })

  test('all skip flags disable everything possible', () => {
    const result = resolveFromFlags({
      SKIP_SILENCE_REMOVAL: true,
      SKIP_VISUAL_ENHANCEMENT: true,
      SKIP_CAPTIONS: true,
      SKIP_INTRO_OUTRO: true,
      SKIP_SHORTS: true,
      SKIP_MEDIUM_CLIPS: true,
      SKIP_SOCIAL: true,
      SKIP_SOCIAL_PUBLISH: true,
    })
    expect(result.processing.silenceRemoval).toBe(false)
    expect(result.processing.visualEnhancement).toBe(false)
    expect(result.processing.captions).toBe(false)
    expect(result.processing.introOutro).toBe(false)
    expect(result.clips.shorts.enabled).toBe(false)
    expect(result.clips.medium.enabled).toBe(false)
    expect(result.distribution.enabled).toBe(false)
    expect(result.distribution.publish).toBe(false)
    // Content is not affected by skip flags
    expect(result.content).toEqual(PRESET_FULL.content)
  })
})

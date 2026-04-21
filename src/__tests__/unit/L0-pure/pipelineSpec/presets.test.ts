import { describe, test, expect } from 'vitest'
import {
  PRESET_FULL,
  PRESET_CLEAN,
  PRESET_MINIMAL,
  PRESETS,
  getPreset,
} from '../../../../L0-pure/pipelineSpec/presets.js'
import { isPresetName } from '../../../../L0-pure/pipelineSpec/types.js'
import type { PipelineSpec } from '../../../../L0-pure/pipelineSpec/types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function assertRequiredFields(spec: PipelineSpec, expectedName: string): void {
  expect(spec.name).toBe(expectedName)
  expect(typeof spec.description).toBe('string')
  expect(spec.description.length).toBeGreaterThan(0)
  expect(spec.processing).toBeDefined()
  expect(spec.clips).toBeDefined()
  expect(spec.content).toBeDefined()
  expect(spec.distribution).toBeDefined()
}

// ─── Preset structure ────────────────────────────────────────────────────────

describe('presets', () => {
  describe('PRESET_FULL', () => {
    test('has all required top-level fields', () => {
      assertRequiredFields(PRESET_FULL, 'full')
    })

    test('processing — all stages enabled', () => {
      expect(PRESET_FULL.processing).toEqual({
        silenceRemoval: true,
        visualEnhancement: true,
        captions: true,
        introOutro: true,
      })
    })

    test('shorts — enabled with hook-first strategy', () => {
      expect(PRESET_FULL.clips.shorts.enabled).toBe(true)
      expect(PRESET_FULL.clips.shorts.strategy).toBe('hook-first')
    })

    test('shorts — 15-60s duration range', () => {
      expect(PRESET_FULL.clips.shorts.duration).toEqual({ min: 15, max: 60 })
    })

    test('medium — enabled with chronological strategy', () => {
      expect(PRESET_FULL.clips.medium.enabled).toBe(true)
      expect(PRESET_FULL.clips.medium.strategy).toBe('chronological')
    })

    test('medium — 60-180s duration range', () => {
      expect(PRESET_FULL.clips.medium.duration).toEqual({ min: 60, max: 180 })
    })

    test('content — chapters, summary, blog all enabled', () => {
      expect(PRESET_FULL.content).toEqual({
        chapters: true,
        summary: true,
        blog: true,
      })
    })

    test('distribution — enabled with per-platform tone and variants', () => {
      expect(PRESET_FULL.distribution.enabled).toBe(true)
      expect(PRESET_FULL.distribution.publish).toBe(true)
      expect(PRESET_FULL.distribution.platforms.toneStrategy).toBe('per-platform')
      expect(PRESET_FULL.distribution.platforms.variants).toBe(true)
    })

    test('distribution — targets all 5 platforms', () => {
      expect(PRESET_FULL.distribution.platforms.targets).toEqual(
        ['youtube', 'linkedin', 'instagram', 'x', 'tiktok'],
      )
    })
  })

  describe('PRESET_CLEAN', () => {
    test('has all required top-level fields', () => {
      assertRequiredFields(PRESET_CLEAN, 'clean')
    })

    test('shorts — disabled', () => {
      expect(PRESET_CLEAN.clips.shorts.enabled).toBe(false)
    })

    test('medium — enabled with chronological strategy', () => {
      expect(PRESET_CLEAN.clips.medium.enabled).toBe(true)
      expect(PRESET_CLEAN.clips.medium.strategy).toBe('chronological')
    })

    test('medium — wider duration range (60-600s)', () => {
      expect(PRESET_CLEAN.clips.medium.duration).toEqual({ min: 60, max: 600 })
    })

    test('distribution — unified toneStrategy', () => {
      expect(PRESET_CLEAN.distribution.platforms.toneStrategy).toBe('unified')
    })

    test('distribution — no aspect-ratio variants', () => {
      expect(PRESET_CLEAN.distribution.platforms.variants).toBe(false)
    })

    test('processing — visual enhancement disabled', () => {
      expect(PRESET_CLEAN.processing.visualEnhancement).toBe(false)
      expect(PRESET_CLEAN.processing.silenceRemoval).toBe(true)
      expect(PRESET_CLEAN.processing.captions).toBe(true)
    })
  })

  describe('PRESET_MINIMAL', () => {
    test('has all required top-level fields', () => {
      assertRequiredFields(PRESET_MINIMAL, 'minimal')
    })

    test('shorts — disabled', () => {
      expect(PRESET_MINIMAL.clips.shorts.enabled).toBe(false)
    })

    test('medium — disabled', () => {
      expect(PRESET_MINIMAL.clips.medium.enabled).toBe(false)
    })

    test('distribution — disabled', () => {
      expect(PRESET_MINIMAL.distribution.enabled).toBe(false)
      expect(PRESET_MINIMAL.distribution.publish).toBe(false)
    })

    test('distribution — empty targets', () => {
      expect(PRESET_MINIMAL.distribution.platforms.targets).toEqual([])
    })

    test('content — blog disabled', () => {
      expect(PRESET_MINIMAL.content.blog).toBe(false)
    })

    test('content — chapters and summary still enabled', () => {
      expect(PRESET_MINIMAL.content.chapters).toBe(true)
      expect(PRESET_MINIMAL.content.summary).toBe(true)
    })

    test('processing — introOutro and visualEnhancement disabled', () => {
      expect(PRESET_MINIMAL.processing.introOutro).toBe(false)
      expect(PRESET_MINIMAL.processing.visualEnhancement).toBe(false)
    })
  })

  // ─── PRESETS map ─────────────────────────────────────────────────────────────

  describe('PRESETS', () => {
    test('contains exactly three presets', () => {
      expect(Object.keys(PRESETS)).toHaveLength(3)
    })

    test('maps full → PRESET_FULL', () => {
      expect(PRESETS.full).toBe(PRESET_FULL)
    })

    test('maps clean → PRESET_CLEAN', () => {
      expect(PRESETS.clean).toBe(PRESET_CLEAN)
    })

    test('maps minimal → PRESET_MINIMAL', () => {
      expect(PRESETS.minimal).toBe(PRESET_MINIMAL)
    })
  })

  // ─── getPreset() ─────────────────────────────────────────────────────────────

  describe('getPreset', () => {
    test('returns PRESET_FULL for "full"', () => {
      expect(getPreset('full')).toBe(PRESET_FULL)
    })

    test('returns PRESET_CLEAN for "clean"', () => {
      expect(getPreset('clean')).toBe(PRESET_CLEAN)
    })

    test('returns PRESET_MINIMAL for "minimal"', () => {
      expect(getPreset('minimal')).toBe(PRESET_MINIMAL)
    })

    test('returns undefined for unknown preset name', () => {
      expect(getPreset('unknown')).toBeUndefined()
    })

    test('returns undefined for empty string', () => {
      expect(getPreset('')).toBeUndefined()
    })
  })

  // ─── isPresetName() ──────────────────────────────────────────────────────────

  describe('isPresetName', () => {
    test('returns true for "full"', () => {
      expect(isPresetName('full')).toBe(true)
    })

    test('returns true for "clean"', () => {
      expect(isPresetName('clean')).toBe(true)
    })

    test('returns true for "minimal"', () => {
      expect(isPresetName('minimal')).toBe(true)
    })

    test('returns false for unknown name', () => {
      expect(isPresetName('custom')).toBe(false)
    })

    test('returns false for empty string', () => {
      expect(isPresetName('')).toBe(false)
    })

    test('returns false for uppercase variant', () => {
      expect(isPresetName('FULL')).toBe(false)
    })

    test('returns false for partial name', () => {
      expect(isPresetName('ful')).toBe(false)
    })
  })
})

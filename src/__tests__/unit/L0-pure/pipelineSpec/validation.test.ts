import { describe, test, expect } from 'vitest'
import { validateSpec } from '../../../../L0-pure/pipelineSpec/validation.js'
import { PRESET_FULL } from '../../../../L0-pure/pipelineSpec/presets.js'

describe('validateSpec', () => {
  // ─── Valid specs ───────────────────────────────────────────────────────────

  describe('valid specs', () => {
    test('full preset produces zero errors', () => {
      const errors = validateSpec(PRESET_FULL)
      expect(errors).toEqual([])
    })

    test('empty object (partial spec) produces zero errors', () => {
      const errors = validateSpec({})
      expect(errors).toEqual([])
    })

    test('minimal valid partial spec produces zero errors', () => {
      const errors = validateSpec({
        name: 'custom',
        processing: { silenceRemoval: true },
        clips: { shorts: { enabled: false } },
      })
      expect(errors).toEqual([])
    })

    test('spec with all valid platforms produces zero errors', () => {
      const errors = validateSpec({
        distribution: {
          platforms: {
            targets: ['youtube', 'linkedin', 'instagram', 'x', 'tiktok'],
          },
        },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── Non-object input ─────────────────────────────────────────────────────

  describe('non-object input', () => {
    test('null → error', () => {
      const errors = validateSpec(null)
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('')
      expect(errors[0].message).toContain('must be an object')
    })

    test('undefined → error', () => {
      const errors = validateSpec(undefined)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('must be an object')
    })

    test('string → error', () => {
      const errors = validateSpec('full')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('must be an object')
    })

    test('number → error', () => {
      const errors = validateSpec(42)
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('must be an object')
    })

    test('array → error', () => {
      const errors = validateSpec([1, 2, 3])
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('must be an object')
    })
  })

  // ─── Clip strategy validation ─────────────────────────────────────────────

  describe('clip strategy validation', () => {
    test('invalid strategy → error with correct path', () => {
      const errors = validateSpec({
        clips: { shorts: { strategy: 'random' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.strategy')
      expect(errors[0].message).toContain('hook-first')
      expect(errors[0].message).toContain('chronological')
    })

    test('invalid medium strategy → error with correct path', () => {
      const errors = validateSpec({
        clips: { medium: { strategy: 'best-of' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.medium.strategy')
    })

    test('valid strategies → no errors', () => {
      const errors = validateSpec({
        clips: {
          shorts: { strategy: 'hook-first' },
          medium: { strategy: 'chronological' },
        },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── Duration validation ──────────────────────────────────────────────────

  describe('duration validation', () => {
    test('min > max → error', () => {
      const errors = validateSpec({
        clips: { shorts: { duration: { min: 100, max: 50 } } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.duration')
      expect(errors[0].message).toContain('min must be less than or equal to max')
    })

    test('negative min → error', () => {
      const errors = validateSpec({
        clips: { shorts: { duration: { min: -5, max: 60 } } },
      })
      expect(errors.some(e => e.path === 'clips.shorts.duration.min')).toBe(true)
    })

    test('negative max → error', () => {
      const errors = validateSpec({
        clips: { medium: { duration: { min: 10, max: -1 } } },
      })
      expect(errors.some(e => e.path === 'clips.medium.duration.max')).toBe(true)
    })

    test('non-object duration → error', () => {
      const errors = validateSpec({
        clips: { shorts: { duration: 'long' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.duration')
      expect(errors[0].message).toContain('must be an object')
    })

    test('min equals max → no error', () => {
      const errors = validateSpec({
        clips: { shorts: { duration: { min: 30, max: 30 } } },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── minViralScore validation ─────────────────────────────────────────────

  describe('minViralScore validation', () => {
    test('0 → error (below range 1-20)', () => {
      const errors = validateSpec({
        clips: { shorts: { minViralScore: 0 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.minViralScore')
      expect(errors[0].message).toContain('between 1 and 20')
    })

    test('21 → error (above range)', () => {
      const errors = validateSpec({
        clips: { shorts: { minViralScore: 21 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.minViralScore')
    })

    test('-1 → error (negative)', () => {
      const errors = validateSpec({
        clips: { medium: { minViralScore: -1 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.medium.minViralScore')
    })

    test('string value → error', () => {
      const errors = validateSpec({
        clips: { shorts: { minViralScore: 'high' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.minViralScore')
    })

    test('1 → valid (lower bound)', () => {
      const errors = validateSpec({
        clips: { shorts: { minViralScore: 1 } },
      })
      expect(errors).toEqual([])
    })

    test('20 → valid (upper bound)', () => {
      const errors = validateSpec({
        clips: { shorts: { minViralScore: 20 } },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── maxClips validation ──────────────────────────────────────────────────

  describe('maxClips validation', () => {
    test('0 → error (not positive)', () => {
      const errors = validateSpec({
        clips: { shorts: { maxClips: 0 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.maxClips')
      expect(errors[0].message).toContain('positive integer')
    })

    test('negative → error', () => {
      const errors = validateSpec({
        clips: { medium: { maxClips: -3 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.medium.maxClips')
    })

    test('non-integer → error', () => {
      const errors = validateSpec({
        clips: { shorts: { maxClips: 3.5 } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.maxClips')
    })

    test('string value → error', () => {
      const errors = validateSpec({
        clips: { shorts: { maxClips: 'five' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.maxClips')
    })

    test('1 → valid (minimum positive integer)', () => {
      const errors = validateSpec({
        clips: { shorts: { maxClips: 1 } },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── toneStrategy validation ──────────────────────────────────────────────

  describe('toneStrategy validation', () => {
    test('invalid value → error', () => {
      const errors = validateSpec({
        distribution: { platforms: { toneStrategy: 'casual' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.platforms.toneStrategy')
      expect(errors[0].message).toContain('unified')
      expect(errors[0].message).toContain('per-platform')
    })

    test('"unified" → valid', () => {
      const errors = validateSpec({
        distribution: { platforms: { toneStrategy: 'unified' } },
      })
      expect(errors).toEqual([])
    })

    test('"per-platform" → valid', () => {
      const errors = validateSpec({
        distribution: { platforms: { toneStrategy: 'per-platform' } },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── Platform targets validation ──────────────────────────────────────────

  describe('platform targets validation', () => {
    test('unknown platform → error', () => {
      const errors = validateSpec({
        distribution: { platforms: { targets: ['facebook'] } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.platforms.targets')
      expect(errors[0].message).toContain("'facebook'")
    })

    test('multiple unknown platforms → multiple errors', () => {
      const errors = validateSpec({
        distribution: { platforms: { targets: ['facebook', 'snapchat'] } },
      })
      expect(errors).toHaveLength(2)
      expect(errors[0].message).toContain("'facebook'")
      expect(errors[1].message).toContain("'snapchat'")
    })

    test('non-array targets → error', () => {
      const errors = validateSpec({
        distribution: { platforms: { targets: 'youtube' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.platforms.targets')
      expect(errors[0].message).toContain('must be an array')
    })

    test('empty array → valid', () => {
      const errors = validateSpec({
        distribution: { platforms: { targets: [] } },
      })
      expect(errors).toEqual([])
    })
  })

  // ─── Boolean field validation ─────────────────────────────────────────────

  describe('boolean field validation', () => {
    test('processing boolean fields with non-boolean values → errors', () => {
      const errors = validateSpec({
        processing: {
          silenceRemoval: 'yes',
          captions: 1,
        },
      })
      expect(errors).toHaveLength(2)
      expect(errors.some(e => e.path === 'processing.silenceRemoval')).toBe(true)
      expect(errors.some(e => e.path === 'processing.captions')).toBe(true)
    })

    test('content boolean fields with non-boolean values → errors', () => {
      const errors = validateSpec({
        content: { chapters: 'true', blog: 0 },
      })
      expect(errors).toHaveLength(2)
      expect(errors.some(e => e.path === 'content.chapters')).toBe(true)
      expect(errors.some(e => e.path === 'content.blog')).toBe(true)
    })

    test('distribution.enabled as string → error', () => {
      const errors = validateSpec({
        distribution: { enabled: 'true' },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.enabled')
    })

    test('distribution.publish as number → error', () => {
      const errors = validateSpec({
        distribution: { publish: 1 },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.publish')
    })

    test('clips.shorts.enabled as string → error', () => {
      const errors = validateSpec({
        clips: { shorts: { enabled: 'false' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips.shorts.enabled')
    })

    test('distribution.platforms.variants as string → error', () => {
      const errors = validateSpec({
        distribution: { platforms: { variants: 'yes' } },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.platforms.variants')
    })
  })

  // ─── Name / description validation ────────────────────────────────────────

  describe('name and description validation', () => {
    test('non-string name → error', () => {
      const errors = validateSpec({ name: 123 })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('name')
    })

    test('non-string description → error', () => {
      const errors = validateSpec({ description: true })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('description')
    })

    test('string name and description → valid', () => {
      const errors = validateSpec({ name: 'custom', description: 'My spec' })
      expect(errors).toEqual([])
    })
  })

  // ─── Structural edge cases ────────────────────────────────────────────────

  describe('structural edge cases', () => {
    test('clips as non-object → error', () => {
      const errors = validateSpec({ clips: 'all' })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('clips')
    })

    test('distribution.platforms as non-object → error', () => {
      const errors = validateSpec({
        distribution: { platforms: 'youtube' },
      })
      expect(errors).toHaveLength(1)
      expect(errors[0].path).toBe('distribution.platforms')
    })

    test('multiple errors accumulated across sections', () => {
      const errors = validateSpec({
        clips: { shorts: { strategy: 'bad', maxClips: -1 } },
        distribution: { enabled: 'yes', platforms: { targets: ['facebook'] } },
      })
      expect(errors.length).toBeGreaterThanOrEqual(3)
    })
  })
})

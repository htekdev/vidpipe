/**
 * Pure validation for pipeline specs.
 *
 * `validateSpec()` checks a raw (potentially partial) object against the
 * PipelineSpec schema and returns an array of {@link SpecValidationError}s.
 * An empty array means the spec is valid.
 *
 * This module is L0-pure — no I/O, no imports above L0.
 */

import type { SpecValidationError } from './types.js'

const VALID_STRATEGIES = ['hook-first', 'chronological'] as const
const VALID_TONE_STRATEGIES = ['unified', 'per-platform'] as const
const VALID_PLATFORMS = ['youtube', 'linkedin', 'instagram', 'x', 'tiktok'] as const

type SpecInput = Record<string, unknown>

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function validateClipConfig(clip: unknown, path: string, errors: SpecValidationError[]): void {
  if (!isObject(clip)) return // optional — will be filled from defaults

  if ('enabled' in clip && typeof clip.enabled !== 'boolean') {
    errors.push({ path: `${path}.enabled`, message: 'must be a boolean' })
  }

  if ('strategy' in clip && clip.strategy !== undefined) {
    if (!(VALID_STRATEGIES as readonly string[]).includes(clip.strategy as string)) {
      errors.push({ path: `${path}.strategy`, message: `must be one of: ${VALID_STRATEGIES.join(', ')}` })
    }
  }

  if ('duration' in clip && clip.duration !== undefined) {
    const dur = clip.duration
    if (!isObject(dur)) {
      errors.push({ path: `${path}.duration`, message: 'must be an object with min and max' })
    } else {
      if ('min' in dur && (typeof dur.min !== 'number' || dur.min < 0)) {
        errors.push({ path: `${path}.duration.min`, message: 'must be a non-negative number' })
      }
      if ('max' in dur && (typeof dur.max !== 'number' || dur.max < 0)) {
        errors.push({ path: `${path}.duration.max`, message: 'must be a non-negative number' })
      }
      if (typeof dur.min === 'number' && typeof dur.max === 'number' && dur.min > dur.max) {
        errors.push({ path: `${path}.duration`, message: 'min must be less than or equal to max' })
      }
    }
  }

  if ('minViralScore' in clip && clip.minViralScore !== undefined) {
    const score = clip.minViralScore
    if (typeof score !== 'number' || score < 1 || score > 20) {
      errors.push({ path: `${path}.minViralScore`, message: 'must be a number between 1 and 20' })
    }
  }

  if ('maxClips' in clip && clip.maxClips !== undefined) {
    const max = clip.maxClips
    if (typeof max !== 'number' || max < 1 || !Number.isInteger(max)) {
      errors.push({ path: `${path}.maxClips`, message: 'must be a positive integer' })
    }
  }
}

function validateProcessing(proc: unknown, errors: SpecValidationError[]): void {
  if (!isObject(proc)) return
  const boolFields = ['silenceRemoval', 'visualEnhancement', 'captions', 'introOutro'] as const
  for (const field of boolFields) {
    if (field in proc && typeof proc[field] !== 'boolean') {
      errors.push({ path: `processing.${field}`, message: 'must be a boolean' })
    }
  }
}

function validateContent(content: unknown, errors: SpecValidationError[]): void {
  if (!isObject(content)) return
  const boolFields = ['chapters', 'summary', 'blog'] as const
  for (const field of boolFields) {
    if (field in content && typeof content[field] !== 'boolean') {
      errors.push({ path: `content.${field}`, message: 'must be a boolean' })
    }
  }
}

function validateDistribution(dist: unknown, errors: SpecValidationError[]): void {
  if (!isObject(dist)) return

  if ('enabled' in dist && typeof dist.enabled !== 'boolean') {
    errors.push({ path: 'distribution.enabled', message: 'must be a boolean' })
  }
  if ('publish' in dist && typeof dist.publish !== 'boolean') {
    errors.push({ path: 'distribution.publish', message: 'must be a boolean' })
  }

  if ('platforms' in dist && dist.platforms !== undefined) {
    const plat = dist.platforms
    if (!isObject(plat)) {
      errors.push({ path: 'distribution.platforms', message: 'must be an object' })
      return
    }

    if ('targets' in plat) {
      if (!Array.isArray(plat.targets)) {
        errors.push({ path: 'distribution.platforms.targets', message: 'must be an array' })
      } else {
        for (const target of plat.targets) {
          if (!(VALID_PLATFORMS as readonly string[]).includes(target as string)) {
            errors.push({
              path: 'distribution.platforms.targets',
              message: `unknown platform '${String(target)}' — valid: ${VALID_PLATFORMS.join(', ')}`,
            })
          }
        }
      }
    }

    if ('toneStrategy' in plat && plat.toneStrategy !== undefined) {
      if (!(VALID_TONE_STRATEGIES as readonly string[]).includes(plat.toneStrategy as string)) {
        errors.push({
          path: 'distribution.platforms.toneStrategy',
          message: `must be one of: ${VALID_TONE_STRATEGIES.join(', ')}`,
        })
      }
    }

    if ('variants' in plat && typeof plat.variants !== 'boolean') {
      errors.push({ path: 'distribution.platforms.variants', message: 'must be a boolean' })
    }
  }
}

/**
 * Validate a raw spec object and return any errors found.
 *
 * An empty array means the spec is valid.
 * The input can be a partial spec (missing fields are filled from defaults
 * by the merger, not by the validator).
 */
export function validateSpec(raw: unknown): SpecValidationError[] {
  const errors: SpecValidationError[] = []

  if (!isObject(raw)) {
    errors.push({ path: '', message: 'spec must be an object' })
    return errors
  }

  const spec = raw as SpecInput

  // name and description are optional strings
  if ('name' in spec && spec.name !== undefined && typeof spec.name !== 'string') {
    errors.push({ path: 'name', message: 'must be a string' })
  }
  if ('description' in spec && spec.description !== undefined && typeof spec.description !== 'string') {
    errors.push({ path: 'description', message: 'must be a string' })
  }

  if ('processing' in spec) validateProcessing(spec.processing, errors)

  if ('clips' in spec && spec.clips !== undefined) {
    if (!isObject(spec.clips)) {
      errors.push({ path: 'clips', message: 'must be an object' })
    } else {
      if ('shorts' in spec.clips) validateClipConfig(spec.clips.shorts, 'clips.shorts', errors)
      if ('medium' in spec.clips) validateClipConfig(spec.clips.medium, 'clips.medium', errors)
    }
  }

  if ('content' in spec) validateContent(spec.content, errors)
  if ('distribution' in spec) validateDistribution(spec.distribution, errors)

  return errors
}

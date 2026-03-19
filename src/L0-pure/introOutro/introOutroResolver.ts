import type { IntroOutroConfig, IntroOutroToggle, IntroOutroVideoType } from '../types/index.js'

/**
 * Resolve whether intro/outro should be applied for a given video type and platform.
 *
 * Resolution order:
 * 1. `platformOverrides[platform][videoType]` — most specific
 * 2. `rules[videoType]` — per-video-type default
 * 3. `{ intro: config.enabled, outro: config.enabled }` — global fallback
 */
export function resolveIntroOutroToggle(
  config: IntroOutroConfig,
  videoType: IntroOutroVideoType,
  platform?: string,
): IntroOutroToggle {
  const globalDefault: IntroOutroToggle = { intro: config.enabled, outro: config.enabled }
  const videoTypeRule = config.rules?.[videoType]
  const baseToggle: IntroOutroToggle = videoTypeRule
    ? { intro: videoTypeRule.intro, outro: videoTypeRule.outro }
    : globalDefault

  if (!platform || !config.platformOverrides?.[platform]?.[videoType]) {
    return baseToggle
  }

  const platformRule = config.platformOverrides[platform]![videoType]!
  return {
    intro: platformRule.intro ?? baseToggle.intro,
    outro: platformRule.outro ?? baseToggle.outro,
  }
}

/**
 * Resolve the intro video file path for a given aspect ratio and platform.
 *
 * Resolution order:
 * 1. `intro.aspectRatios[aspectRatio]` — aspect-ratio-specific file
 * 2. `intro.platforms[platform]` — platform-specific file
 * 3. `intro.default` — default file
 * 4. `null` — no intro configured
 */
export function resolveIntroPath(
  config: IntroOutroConfig,
  platform?: string,
  aspectRatio?: string,
): string | null {
  if (!config.intro) return null
  if (aspectRatio && config.intro.aspectRatios?.[aspectRatio]) {
    return config.intro.aspectRatios[aspectRatio]!
  }
  if (platform && config.intro.platforms?.[platform]) {
    return config.intro.platforms[platform]!
  }
  return config.intro.default ?? null
}

/**
 * Resolve the outro video file path for a given aspect ratio and platform.
 *
 * Resolution order:
 * 1. `outro.aspectRatios[aspectRatio]` — aspect-ratio-specific file
 * 2. `outro.platforms[platform]` — platform-specific file
 * 3. `outro.default` — default file
 * 4. `null` — no outro configured
 */
export function resolveOutroPath(
  config: IntroOutroConfig,
  platform?: string,
  aspectRatio?: string,
): string | null {
  if (!config.outro) return null
  if (aspectRatio && config.outro.aspectRatios?.[aspectRatio]) {
    return config.outro.aspectRatios[aspectRatio]!
  }
  if (platform && config.outro.platforms?.[platform]) {
    return config.outro.platforms[platform]!
  }
  return config.outro.default ?? null
}

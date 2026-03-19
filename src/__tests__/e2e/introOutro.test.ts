// Updated: review feedback fixes — temp file cleanup, ffprobe path, fileExists caching
// Regression: getIntroOutroVideo prefers clip.outputPath over re-extraction
import { describe, test, expect } from 'vitest'
import { resolveIntroOutroToggle, resolveIntroPath, resolveOutroPath } from '../../L0-pure/introOutro/introOutroResolver.js'
import type { IntroOutroConfig } from '../../L0-pure/types/index.js'

// E2E tests for intro/outro — no mocking.
// FFmpeg-dependent tests are skipped when FFmpeg is unavailable.

describe('intro/outro e2e', () => {
  test('full config resolution chain works end-to-end', () => {
    const config: IntroOutroConfig = {
      enabled: true,
      fadeDuration: 0.5,
      intro: {
        default: './assets/intro.mp4',
        platforms: { youtube: './assets/intro-yt.mp4' },
        aspectRatios: { '9:16': './assets/intro-portrait.mp4' },
      },
      outro: {
        default: './assets/outro.mp4',
        aspectRatios: { '9:16': './assets/outro-portrait.mp4', '1:1': './assets/outro-square.mp4' },
      },
      rules: {
        main: { intro: true, outro: true },
        shorts: { intro: false, outro: true },
        'medium-clips': { intro: true, outro: true },
      },
      platformOverrides: {
        tiktok: { shorts: { intro: true, outro: true } },
      },
    }

    // Main video: intro + outro enabled
    const mainToggle = resolveIntroOutroToggle(config, 'main')
    expect(mainToggle).toEqual({ intro: true, outro: true })
    expect(resolveIntroPath(config)).toBe('./assets/intro.mp4')
    expect(resolveOutroPath(config)).toBe('./assets/outro.mp4')

    // Shorts: intro disabled by rule
    const shortsToggle = resolveIntroOutroToggle(config, 'shorts')
    expect(shortsToggle).toEqual({ intro: false, outro: true })

    // TikTok shorts: platform override enables intro
    const tiktokShortsToggle = resolveIntroOutroToggle(config, 'shorts', 'tiktok')
    expect(tiktokShortsToggle).toEqual({ intro: true, outro: true })

    // Aspect ratio resolution: 9:16 gets portrait file
    expect(resolveIntroPath(config, undefined, '9:16')).toBe('./assets/intro-portrait.mp4')
    expect(resolveOutroPath(config, undefined, '9:16')).toBe('./assets/outro-portrait.mp4')

    // YouTube platform gets platform-specific intro
    expect(resolveIntroPath(config, 'youtube')).toBe('./assets/intro-yt.mp4')

    // Aspect ratio takes priority over platform
    expect(resolveIntroPath(config, 'youtube', '9:16')).toBe('./assets/intro-portrait.mp4')

    // Unknown ratio falls through to platform then default
    expect(resolveIntroPath(config, 'youtube', '4:5')).toBe('./assets/intro-yt.mp4')
    expect(resolveIntroPath(config, undefined, '4:5')).toBe('./assets/intro.mp4')
  })
})

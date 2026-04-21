import { describe, test, expect } from 'vitest'
import {
  resolveIntroOutroToggle,
  resolveIntroPath,
  resolveOutroPath,
} from '../../../../src/L0-pure/introOutro/introOutroResolver.js'
import type { IntroOutroConfig } from '../../../../src/L0-pure/types/index.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseConfig: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
}

const configWithRules: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  rules: {
    main: { intro: true, outro: true },
    shorts: { intro: false, outro: false },
    'medium-clips': { intro: true, outro: false },
  },
}

const configWithPlatformOverrides: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  rules: {
    main: { intro: true, outro: true },
    shorts: { intro: false, outro: false },
  },
  platformOverrides: {
    youtube: {
      main: { intro: true, outro: false },
      shorts: { intro: true, outro: true },
    },
    tiktok: {
      shorts: { intro: false, outro: true },
    },
  },
}

const configWithPartialPlatformOverride: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  rules: {
    main: { intro: true, outro: true },
  },
  platformOverrides: {
    youtube: {
      main: { outro: false },
    },
  },
}

const configDisabled: IntroOutroConfig = {
  enabled: false,
  fadeDuration: 0,
}

const configWithIntroOutroPaths: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  intro: {
    default: '/assets/intro-default.mp4',
    platforms: {
      youtube: '/assets/intro-youtube.mp4',
      tiktok: '/assets/intro-tiktok.mp4',
    },
  },
  outro: {
    default: '/assets/outro-default.mp4',
    platforms: {
      youtube: '/assets/outro-youtube.mp4',
      instagram: '/assets/outro-instagram.mp4',
    },
  },
}

const configWithDefaultOnlyPaths: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  intro: { default: '/assets/intro.mp4' },
  outro: { default: '/assets/outro.mp4' },
}

const configWithPlatformOnlyPaths: IntroOutroConfig = {
  enabled: true,
  fadeDuration: 0.5,
  intro: { platforms: { youtube: '/assets/intro-yt.mp4' } },
  outro: { platforms: { youtube: '/assets/outro-yt.mp4' } },
}

// ---------------------------------------------------------------------------
// resolveIntroOutroToggle
// ---------------------------------------------------------------------------

describe('introOutroResolver', () => {
  describe('REQ-001: resolveIntroOutroToggle returns platformOverrides when platform+videoType match', () => {
    test('introOutroResolver.REQ-001 - uses platform+videoType override', () => {
      const result = resolveIntroOutroToggle(configWithPlatformOverrides, 'main', 'youtube')
      expect(result).toEqual({ intro: true, outro: false })
    })

    test('introOutroResolver.REQ-001 - uses different platform override', () => {
      const result = resolveIntroOutroToggle(configWithPlatformOverrides, 'shorts', 'tiktok')
      expect(result).toEqual({ intro: false, outro: true })
    })

    test('introOutroResolver.REQ-001 - overrides base rule completely', () => {
      // Base rule for shorts is { intro: false, outro: false }
      // youtube override for shorts is { intro: true, outro: true }
      const result = resolveIntroOutroToggle(configWithPlatformOverrides, 'shorts', 'youtube')
      expect(result).toEqual({ intro: true, outro: true })
    })
  })

  describe('REQ-002: resolveIntroOutroToggle falls back to rules[videoType] when no platform override', () => {
    test('introOutroResolver.REQ-002 - uses videoType rule when no platform given', () => {
      const result = resolveIntroOutroToggle(configWithRules, 'shorts')
      expect(result).toEqual({ intro: false, outro: false })
    })

    test('introOutroResolver.REQ-002 - uses videoType rule when platform has no override for that type', () => {
      // tiktok has override for shorts but not main
      const result = resolveIntroOutroToggle(configWithPlatformOverrides, 'main', 'tiktok')
      expect(result).toEqual({ intro: true, outro: true })
    })

    test('introOutroResolver.REQ-002 - uses videoType rule when platform is unknown', () => {
      const result = resolveIntroOutroToggle(configWithPlatformOverrides, 'main', 'linkedin')
      expect(result).toEqual({ intro: true, outro: true })
    })

    test('introOutroResolver.REQ-002 - uses medium-clips rule', () => {
      const result = resolveIntroOutroToggle(configWithRules, 'medium-clips')
      expect(result).toEqual({ intro: true, outro: false })
    })
  })

  describe('REQ-003: resolveIntroOutroToggle falls back to { intro: enabled, outro: enabled } when no rules', () => {
    test('introOutroResolver.REQ-003 - enabled config returns both true', () => {
      const result = resolveIntroOutroToggle(baseConfig, 'main')
      expect(result).toEqual({ intro: true, outro: true })
    })

    test('introOutroResolver.REQ-003 - disabled config returns both false', () => {
      const result = resolveIntroOutroToggle(configDisabled, 'shorts')
      expect(result).toEqual({ intro: false, outro: false })
    })

    test('introOutroResolver.REQ-003 - applies global fallback for all video types', () => {
      expect(resolveIntroOutroToggle(baseConfig, 'main')).toEqual({ intro: true, outro: true })
      expect(resolveIntroOutroToggle(baseConfig, 'shorts')).toEqual({ intro: true, outro: true })
      expect(resolveIntroOutroToggle(baseConfig, 'medium-clips')).toEqual({ intro: true, outro: true })
    })

    test('introOutroResolver.REQ-003 - uses global fallback when rules exist but not for requested videoType', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        rules: {
          main: { intro: false, outro: false },
        },
      }
      // shorts has no rule defined — should fall back to global
      const result = resolveIntroOutroToggle(config, 'shorts')
      expect(result).toEqual({ intro: true, outro: true })
    })
  })

  describe('REQ-004: resolveIntroOutroToggle merges partial platform overrides with base toggle', () => {
    test('introOutroResolver.REQ-004 - partial override merges with base rule', () => {
      // Base rule for main: { intro: true, outro: true }
      // youtube override for main: { outro: false } (intro not specified)
      const result = resolveIntroOutroToggle(configWithPartialPlatformOverride, 'main', 'youtube')
      expect(result).toEqual({ intro: true, outro: false })
    })

    test('introOutroResolver.REQ-004 - partial override preserves unset fields from base', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        rules: {
          shorts: { intro: false, outro: true },
        },
        platformOverrides: {
          instagram: {
            shorts: { intro: true },
          },
        },
      }
      // Base for shorts: { intro: false, outro: true }
      // instagram override: { intro: true } — outro should come from base
      const result = resolveIntroOutroToggle(config, 'shorts', 'instagram')
      expect(result).toEqual({ intro: true, outro: true })
    })

    test('introOutroResolver.REQ-004 - partial override merges with global fallback when no rule exists', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        platformOverrides: {
          youtube: {
            main: { outro: false },
          },
        },
      }
      // No rules defined — base is global { intro: true, outro: true }
      // youtube override for main: { outro: false }
      const result = resolveIntroOutroToggle(config, 'main', 'youtube')
      expect(result).toEqual({ intro: true, outro: false })
    })
  })

  // ---------------------------------------------------------------------------
  // resolveIntroPath
  // ---------------------------------------------------------------------------

  describe('REQ-005: resolveIntroPath returns platform-specific path when available', () => {
    test('introOutroResolver.REQ-005 - returns youtube-specific intro path', () => {
      const result = resolveIntroPath(configWithIntroOutroPaths, 'youtube')
      expect(result).toBe('/assets/intro-youtube.mp4')
    })

    test('introOutroResolver.REQ-005 - returns tiktok-specific intro path', () => {
      const result = resolveIntroPath(configWithIntroOutroPaths, 'tiktok')
      expect(result).toBe('/assets/intro-tiktok.mp4')
    })
  })

  describe('REQ-006: resolveIntroPath falls back to default path', () => {
    test('introOutroResolver.REQ-006 - returns default when no platform given', () => {
      const result = resolveIntroPath(configWithIntroOutroPaths)
      expect(result).toBe('/assets/intro-default.mp4')
    })

    test('introOutroResolver.REQ-006 - returns default when platform has no override', () => {
      const result = resolveIntroPath(configWithIntroOutroPaths, 'linkedin')
      expect(result).toBe('/assets/intro-default.mp4')
    })

    test('introOutroResolver.REQ-006 - returns default from default-only config', () => {
      const result = resolveIntroPath(configWithDefaultOnlyPaths)
      expect(result).toBe('/assets/intro.mp4')
    })
  })

  describe('REQ-007: resolveIntroPath returns null when no intro configured', () => {
    test('introOutroResolver.REQ-007 - returns null when intro is undefined', () => {
      const result = resolveIntroPath(baseConfig)
      expect(result).toBeNull()
    })

    test('introOutroResolver.REQ-007 - returns null when intro has no default and platform not matched', () => {
      const result = resolveIntroPath(configWithPlatformOnlyPaths, 'instagram')
      expect(result).toBeNull()
    })

    test('introOutroResolver.REQ-007 - returns null on disabled config with no intro', () => {
      const result = resolveIntroPath(configDisabled)
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // resolveOutroPath
  // ---------------------------------------------------------------------------

  describe('REQ-008: resolveOutroPath returns platform-specific path when available', () => {
    test('introOutroResolver.REQ-008 - returns youtube-specific outro path', () => {
      const result = resolveOutroPath(configWithIntroOutroPaths, 'youtube')
      expect(result).toBe('/assets/outro-youtube.mp4')
    })

    test('introOutroResolver.REQ-008 - returns instagram-specific outro path', () => {
      const result = resolveOutroPath(configWithIntroOutroPaths, 'instagram')
      expect(result).toBe('/assets/outro-instagram.mp4')
    })
  })

  describe('REQ-009: resolveOutroPath falls back to default path', () => {
    test('introOutroResolver.REQ-009 - returns default when no platform given', () => {
      const result = resolveOutroPath(configWithIntroOutroPaths)
      expect(result).toBe('/assets/outro-default.mp4')
    })

    test('introOutroResolver.REQ-009 - returns default when platform has no override', () => {
      const result = resolveOutroPath(configWithIntroOutroPaths, 'tiktok')
      expect(result).toBe('/assets/outro-default.mp4')
    })

    test('introOutroResolver.REQ-009 - returns default from default-only config', () => {
      const result = resolveOutroPath(configWithDefaultOnlyPaths)
      expect(result).toBe('/assets/outro.mp4')
    })
  })

  describe('REQ-010: resolveOutroPath returns null when no outro configured', () => {
    test('introOutroResolver.REQ-010 - returns null when outro is undefined', () => {
      const result = resolveOutroPath(baseConfig)
      expect(result).toBeNull()
    })

    test('introOutroResolver.REQ-010 - returns null when outro has no default and platform not matched', () => {
      const result = resolveOutroPath(configWithPlatformOnlyPaths, 'instagram')
      expect(result).toBeNull()
    })

    test('introOutroResolver.REQ-010 - returns null on disabled config with no outro', () => {
      const result = resolveOutroPath(configDisabled)
      expect(result).toBeNull()
    })
  })

  // ---------------------------------------------------------------------------
  // resolveIntroPath — aspect ratio priority
  // ---------------------------------------------------------------------------

  describe('REQ-011: resolveIntroPath prioritizes aspectRatio over platform', () => {
    test('introOutroResolver.REQ-011 - returns aspect-ratio-specific path when both ratio and platform exist', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        intro: {
          default: './default.mp4',
          platforms: { youtube: './yt.mp4' },
          aspectRatios: { '9:16': './portrait.mp4' },
        },
      }
      expect(resolveIntroPath(config, 'youtube', '9:16')).toBe('./portrait.mp4')
    })

    test('introOutroResolver.REQ-011 - falls back to platform when ratio not configured', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        intro: {
          default: './default.mp4',
          platforms: { youtube: './yt.mp4' },
          aspectRatios: {},
        },
      }
      expect(resolveIntroPath(config, 'youtube', '1:1')).toBe('./yt.mp4')
    })

    test('introOutroResolver.REQ-011 - falls back to default when neither ratio nor platform', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        intro: {
          default: './default.mp4',
          aspectRatios: {},
        },
      }
      expect(resolveIntroPath(config, undefined, '4:5')).toBe('./default.mp4')
    })
  })

  // ---------------------------------------------------------------------------
  // resolveOutroPath — aspect ratio priority
  // ---------------------------------------------------------------------------

  describe('REQ-012: resolveOutroPath prioritizes aspectRatio over platform', () => {
    test('introOutroResolver.REQ-012 - returns aspect-ratio-specific outro', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        outro: {
          default: './outro-default.mp4',
          aspectRatios: { '9:16': './outro-portrait.mp4' },
        },
      }
      expect(resolveOutroPath(config, undefined, '9:16')).toBe('./outro-portrait.mp4')
    })

    test('introOutroResolver.REQ-012 - falls back to platform then default for outro', () => {
      const config: IntroOutroConfig = {
        enabled: true,
        fadeDuration: 0.5,
        outro: {
          default: './outro-default.mp4',
          platforms: { tiktok: './outro-tiktok.mp4' },
          aspectRatios: {},
        },
      }
      expect(resolveOutroPath(config, 'tiktok', '1:1')).toBe('./outro-tiktok.mp4')
    })
  })
})

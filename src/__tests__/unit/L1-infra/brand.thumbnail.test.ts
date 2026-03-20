import { describe, it, expect, vi, beforeEach } from 'vitest'

// L1 tests: only mock Node.js builtins
const mockExistsSync = vi.hoisted(() => vi.fn())
const mockReadFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  }
})

const baseBrand = {
  name: 'TestBrand',
  handle: '@testbrand',
  tagline: 'Test tagline',
  voice: { tone: 'casual', personality: 'fun', style: 'brief' },
  advocacy: { primary: ['testing'], interests: ['typescript'], avoids: ['complexity'] },
  customVocabulary: ['Vitest', 'TypeScript'],
  hashtags: { always: ['#test'], preferred: ['#dev'], platforms: {} },
  contentGuidelines: {
    shortsFocus: 'Quick tips',
    blogFocus: 'Deep dives',
    socialFocus: 'Engagement',
  },
}

describe('brand.ts — getThumbnailConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
  })

  it('returns { enabled: false } when brand.json has no thumbnail section', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(baseBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getThumbnailConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getThumbnailConfig()

    expect(config).toEqual({ enabled: false })
  })

  it('returns full thumbnail config when present in brand.json', async () => {
    const brandWithThumbnail = {
      ...baseBrand,
      thumbnail: {
        enabled: true,
        referenceImage: './assets/ref.png',
        style: 'Bold tech style',
        size: '1536x1024',
        quality: 'high',
        rules: { main: true, shorts: true, 'medium-clips': false },
        platformOverrides: {
          tiktok: { size: '1024x1536' },
        },
      },
    }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(brandWithThumbnail))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getThumbnailConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getThumbnailConfig()

    expect(config.enabled).toBe(true)
    expect(config.referenceImage).toBe('./assets/ref.png')
    expect(config.style).toBe('Bold tech style')
    expect(config.size).toBe('1536x1024')
    expect(config.quality).toBe('high')
    expect(config.rules).toEqual({ main: true, shorts: true, 'medium-clips': false })
    expect(config.platformOverrides).toEqual({ tiktok: { size: '1024x1536' } })
  })

  it('returns disabled thumbnail config when thumbnail.enabled is false', async () => {
    const brandDisabled = {
      ...baseBrand,
      thumbnail: { enabled: false },
    }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(brandDisabled))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getThumbnailConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getThumbnailConfig()

    expect(config.enabled).toBe(false)
  })

  it('validates and warns on invalid thumbnail size', async () => {
    const { default: logger } = await import('../../../L1-infra/logger/configLogger.js')
    const warnSpy = vi.spyOn(logger, 'warn')

    const brandBadSize = {
      ...baseBrand,
      thumbnail: {
        enabled: true,
        size: '9999x9999',
      },
    }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(brandBadSize))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    getBrandConfig()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('thumbnail.size'),
    )
  })

  it('validates and warns on invalid thumbnail quality', async () => {
    const { default: logger } = await import('../../../L1-infra/logger/configLogger.js')
    const warnSpy = vi.spyOn(logger, 'warn')

    const brandBadQuality = {
      ...baseBrand,
      thumbnail: {
        enabled: true,
        quality: 'ultra',
      },
    }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(brandBadQuality))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    getBrandConfig()

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('thumbnail.quality'),
    )
  })

  it('getThumbnailConfig delegates to getBrandConfig (caching works)', async () => {
    const brandWithThumbnail = {
      ...baseBrand,
      thumbnail: { enabled: true, style: 'Minimal' },
    }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(brandWithThumbnail))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getThumbnailConfig } = await import('../../../L1-infra/config/brand.js')
    const first = getThumbnailConfig()
    const second = getThumbnailConfig()

    // Same reference — cached brand config returns the same thumbnail object
    expect(first).toBe(second)
    // Only read file once
    expect(mockReadFileSync).toHaveBeenCalledTimes(1)
  })
})

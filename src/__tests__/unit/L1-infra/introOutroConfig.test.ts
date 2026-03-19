/**
 * L1 Unit Test — getIntroOutroConfig from brand.ts
 *
 * Mocks: Node.js builtins only (node:fs). Logger is auto-mocked by global setup.
 * Uses vi.resetModules() + dynamic import to work around getBrandConfig() caching.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  handle: '@test',
  tagline: 'Testing',
  voice: { tone: 'casual', personality: 'fun', style: 'brief' },
  advocacy: { primary: ['testing'], interests: ['ts'], avoids: [] },
  customVocabulary: ['Vitest'],
  hashtags: { always: ['#test'], preferred: ['#dev'], platforms: {} },
  contentGuidelines: { shortsFocus: 'Quick', blogFocus: 'Deep', socialFocus: 'Fun' },
}

describe('L1 Unit: getIntroOutroConfig', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
  })

  it('returns disabled defaults when brand.json has no introOutro section', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(baseBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/tmp/brand.json' })

    const { getIntroOutroConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getIntroOutroConfig()

    expect(config.enabled).toBe(false)
    expect(config.fadeDuration).toBe(0)
  })

  it('returns introOutro config from brand.json when present', async () => {
    const brandWithIntroOutro = {
      ...baseBrand,
      introOutro: { enabled: true, fadeDuration: 1.5 },
    }
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify(brandWithIntroOutro))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/tmp/brand.json' })

    const { getIntroOutroConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getIntroOutroConfig()

    expect(config.enabled).toBe(true)
    expect(config.fadeDuration).toBe(1.5)
  })

  it('returns disabled defaults when brand file is missing', async () => {
    mockExistsSync.mockReturnValue(false)

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/tmp/brand.json' })

    const { getIntroOutroConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getIntroOutroConfig()

    // Default brand has no introOutro, so fallback kicks in
    expect(config.enabled).toBe(false)
    expect(config.fadeDuration).toBe(0)
  })
})

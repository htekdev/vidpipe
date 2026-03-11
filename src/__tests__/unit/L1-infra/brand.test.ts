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

const fakeBrand = {
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

describe('brand.ts', () => {
  beforeEach(() => {
    vi.resetModules()
    mockExistsSync.mockReset()
    mockReadFileSync.mockReset()
  })

  it('getBrandConfig returns defaults when brand file is missing', async () => {
    mockExistsSync.mockReturnValue(false)

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('Creator')
    expect(config.handle).toBe('@creator')
    expect(config.tagline).toBe('')
  })

  it('getBrandConfig returns parsed config when brand file exists', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(fakeBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    const config = getBrandConfig()

    expect(config.name).toBe('TestBrand')
    expect(config.handle).toBe('@testbrand')
    expect(config.voice.tone).toBe('casual')
  })

  it('getBrandConfig caches result on repeated calls', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(fakeBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getBrandConfig } = await import('../../../L1-infra/config/brand.js')
    getBrandConfig()
    const callsAfterFirst = mockReadFileSync.mock.calls.length

    getBrandConfig()
    expect(mockReadFileSync.mock.calls.length).toBe(callsAfterFirst)
  })

  it('getWhisperPrompt returns comma-separated vocabulary', async () => {
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(fakeBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getWhisperPrompt } = await import('../../../L1-infra/config/brand.js')
    const prompt = getWhisperPrompt()

    expect(prompt).toBe('Vitest, TypeScript')
  })

  it('getWhisperPrompt returns empty string when no vocabulary', async () => {
    const emptyVocabBrand = { ...fakeBrand, customVocabulary: [] }
    mockExistsSync.mockImplementation((p: unknown) => String(p).endsWith('brand.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(emptyVocabBrand))

    const { initConfig } = await import('../../../L1-infra/config/environment.js')
    initConfig({ brand: '/test/brand.json' })

    const { getWhisperPrompt } = await import('../../../L1-infra/config/brand.js')
    const prompt = getWhisperPrompt()

    expect(prompt).toBe('')
  })
})

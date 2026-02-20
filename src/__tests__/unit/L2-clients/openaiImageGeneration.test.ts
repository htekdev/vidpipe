import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// L2 tests can only mock external APIs and processes
const mockSharp = vi.hoisted(() => vi.fn())

vi.mock('sharp', () => {
  const instance = {
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('validated-png')),
    metadata: vi.fn().mockResolvedValue({ width: 1024, height: 1024 }),
  }
  return { default: mockSharp.mockReturnValue(instance) }
})

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  }
})

import { generateImage, COST_BY_QUALITY } from '../../../L2-clients/openai/imageGeneration.js'
import { initConfig } from '../../../L1-infra/config/environment.js'

function setApiKey(key: string): void {
  initConfig({ openaiKey: key })
}

describe('L2 openai imageGeneration', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('throws when OPENAI_API_KEY is missing', async () => {
    const orig = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = ''
    initConfig() // picks up empty env var
    try {
      await expect(generateImage('test', '/out/img.png')).rejects.toThrow('OPENAI_API_KEY')
    } finally {
      process.env.OPENAI_API_KEY = orig ?? ''
      initConfig() // restore
    }
  })

  it('calls fetch with correct parameters on success', async () => {
    setApiKey('test-key-123')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('fake-image-data').toString('base64') }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await generateImage('a diagram', '/out/test.png')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.model).toBe('gpt-image-1.5')
    expect(body.n).toBe(1)
  })

  it('throws on non-ok response', async () => {
    setApiKey('test-key-123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }))

    await expect(generateImage('test', '/out/img.png')).rejects.toThrow('429')
  })

  it('throws when response has no b64_json', async () => {
    setApiKey('test-key-123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{}] }),
    }))

    await expect(generateImage('test', '/out/img.png')).rejects.toThrow('b64_json')
  })

  it('returns the output path on success', async () => {
    setApiKey('test-key-123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    }))

    const result = await generateImage('test', '/out/img.png')
    expect(result).toBe('/out/img.png')
  })

  it('validates image data through sharp', async () => {
    setApiKey('test-key-123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    }))

    await generateImage('test', '/out/img.png')
    expect(mockSharp).toHaveBeenCalled()
  })

  it('throws on invalid image data from sharp', async () => {
    setApiKey('test-key-123')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    }))

    const sharpInstance = {
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockRejectedValue(new Error('Invalid')),
    }
    mockSharp.mockReturnValueOnce(sharpInstance)

    await expect(generateImage('test', '/out/img.png')).rejects.toThrow('Invalid image data')
  })

  it('exports COST_BY_QUALITY with correct values', () => {
    expect(COST_BY_QUALITY.low).toBe(0.04)
    expect(COST_BY_QUALITY.medium).toBe(0.07)
    expect(COST_BY_QUALITY.high).toBe(0.07)
  })

  it('applies style option to prompt', async () => {
    setApiKey('test-key-123')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await generateImage('diagram', '/out/img.png', { style: 'watercolor' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.prompt).toContain('watercolor')
  })

  it('uses specified size and quality options', async () => {
    setApiKey('test-key-123')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await generateImage('test', '/out/img.png', { size: '1536x1024', quality: 'low' })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.size).toBe('1536x1024')
    expect(body.quality).toBe('low')
  })

  it('appends base prompt for solid background', async () => {
    setApiKey('test-key-123')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await generateImage('my diagram', '/out/img.png')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.prompt).toContain('solid opaque background')
  })
})

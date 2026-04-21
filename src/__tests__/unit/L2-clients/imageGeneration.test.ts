import { describe, test, expect, vi, beforeEach } from 'vitest'

// vi.hoisted mock variables — used in vi.mock factories
const mockFetchRaw = vi.hoisted(() => vi.fn())
const mockSharp = vi.hoisted(() => vi.fn())
const mockGetConfig = vi.hoisted(() => vi.fn())
const mockReadFileBuffer = vi.hoisted(() => vi.fn())
const mockWriteFileBuffer = vi.hoisted(() => vi.fn())
const mockEnsureDirectory = vi.hoisted(() => vi.fn())
const mockDirname = vi.hoisted(() => vi.fn())

vi.mock('../../../L1-infra/http/httpClient.js', () => ({
  fetchRaw: mockFetchRaw,
}))

vi.mock('../../../L1-infra/image/image.js', () => ({
  sharp: mockSharp,
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readFileBuffer: mockReadFileBuffer,
  writeFileBuffer: mockWriteFileBuffer,
  ensureDirectory: mockEnsureDirectory,
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  dirname: mockDirname,
}))

import { generateImageWithReference } from '../../../L2-clients/openai/imageGeneration.js'

/** Encode a string as base64 for fake API responses */
function fakeB64(data: string): string {
  return Buffer.from(data).toString('base64')
}

/** Create a mock Response-like object for fetchRaw */
function mockOkResponse(b64Image: string) {
  return {
    ok: true,
    json: async () => ({ data: [{ b64_json: b64Image }] }),
  }
}

function mockErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    text: async () => body,
  }
}

describe('L2 generateImageWithReference', () => {
  const validatedPng = Buffer.from('validated-png-bytes')
  const smallImage = Buffer.alloc(1024, 0x42) // 1KB — under the 4MB limit

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: config returns a valid API key
    mockGetConfig.mockReturnValue({ OPENAI_API_KEY: 'sk-test-key-123' })

    // Default: readFileBuffer returns a small image
    mockReadFileBuffer.mockResolvedValue(smallImage)

    // Default: sharp validates successfully (for validateImageBuffer)
    const sharpInstance = {
      png: vi.fn().mockReturnThis(),
      resize: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(validatedPng),
    }
    mockSharp.mockReturnValue(sharpInstance)

    // Default: dirname returns parent
    mockDirname.mockReturnValue('/output')

    // Default: file ops succeed silently
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteFileBuffer.mockResolvedValue(undefined)

    // Default: API returns a valid image
    mockFetchRaw.mockResolvedValue(mockOkResponse(fakeB64('fake-png-data')))
  })

  test('sends multipart request to /images/edits', async () => {
    await generateImageWithReference(
      'a thumbnail with a rocket',
      '/output/thumb.png',
      '/ref/style.png',
    )

    expect(mockFetchRaw).toHaveBeenCalledOnce()
    const [url, options] = mockFetchRaw.mock.calls[0]

    expect(url).toBe('https://api.openai.com/v1/images/edits')
    expect(options.method).toBe('POST')
    expect(options.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(options.headers['Authorization']).toBe('Bearer sk-test-key-123')

    // Body should be a Buffer (concatenated multipart parts)
    expect(Buffer.isBuffer(options.body)).toBe(true)
    const bodyText = options.body.toString('utf-8')
    expect(bodyText).toContain('name="model"')
    expect(bodyText).toContain('gpt-image-1.5')
    expect(bodyText).toContain('name="prompt"')
    expect(bodyText).toContain('name="size"')
    expect(bodyText).toContain('name="quality"')
    expect(bodyText).toContain('name="n"')
  })

  test('includes reference image in multipart body', async () => {
    const refImage = Buffer.from('reference-image-pixels')
    mockReadFileBuffer.mockResolvedValue(refImage)

    await generateImageWithReference(
      'a chart',
      '/output/chart.png',
      '/ref/brand.png',
    )

    // Should have read the reference image
    expect(mockReadFileBuffer).toHaveBeenCalledWith('/ref/brand.png')

    // Body must contain the image file part with correct disposition
    const body: Buffer = mockFetchRaw.mock.calls[0][1].body
    const bodyText = body.toString('utf-8')
    expect(bodyText).toContain('name="image"')
    expect(bodyText).toContain('filename="reference.png"')
    expect(bodyText).toContain('Content-Type: image/png')

    // The actual image bytes should be in the body
    expect(body.includes(refImage)).toBe(true)
  })

  test('resizes images larger than 4MB', async () => {
    // Use a minimal buffer just over the 4MB threshold
    const largeImage = Buffer.alloc(4 * 1024 * 1024 + 1, 0xFF)
    mockReadFileBuffer.mockResolvedValue(largeImage)

    const resizedBuffer = Buffer.from('resized-small-image')
    const resizeInstance = {
      resize: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(resizedBuffer),
    }
    const validateInstance = {
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(validatedPng),
    }
    // First call: sharp(largeImage) for resize; second: sharp(rawBuffer) for validation
    mockSharp
      .mockReturnValueOnce(resizeInstance)
      .mockReturnValueOnce(validateInstance)

    await generateImageWithReference(
      'a thumbnail',
      '/output/thumb.png',
      '/ref/large.png',
    )

    // sharp should have been called twice: once for resize, once for validation
    expect(mockSharp).toHaveBeenCalledTimes(2)
    // Verify the first call received the large buffer (check length to avoid slow deep-equal)
    const firstCallArg = mockSharp.mock.calls[0][0] as Buffer
    expect(Buffer.isBuffer(firstCallArg)).toBe(true)
    expect(firstCallArg.length).toBe(4 * 1024 * 1024 + 1)
    expect(resizeInstance.resize).toHaveBeenCalledWith(1536, 1024, { fit: 'inside' })
    expect(resizeInstance.png).toHaveBeenCalled()

    // The multipart body should contain the resized buffer, not the original
    const body: Buffer = mockFetchRaw.mock.calls[0][1].body
    expect(body.includes(resizedBuffer)).toBe(true)
  })

  test('does not resize images under 4MB', async () => {
    // smallImage (1KB) is the default — well under 4MB
    await generateImageWithReference(
      'a thumbnail',
      '/output/thumb.png',
      '/ref/small.png',
    )

    // sharp should only be called once — for validateImageBuffer, not for resize
    expect(mockSharp).toHaveBeenCalledOnce()

    // The original small image should be in the body
    const body: Buffer = mockFetchRaw.mock.calls[0][1].body
    expect(body.includes(smallImage)).toBe(true)
  })

  test('throws when OPENAI_API_KEY is missing', async () => {
    mockGetConfig.mockReturnValue({ OPENAI_API_KEY: '' })

    await expect(
      generateImageWithReference('prompt', '/out/img.png', '/ref/style.png'),
    ).rejects.toThrow('OPENAI_API_KEY')
  })

  test('throws on API error response', async () => {
    mockFetchRaw.mockResolvedValue(mockErrorResponse(429, 'Rate limit exceeded'))

    await expect(
      generateImageWithReference('prompt', '/out/img.png', '/ref/style.png'),
    ).rejects.toThrow('429')
  })

  test('validates output via Sharp', async () => {
    const fakeRawBytes = Buffer.from('raw-api-image-bytes')
    const b64 = fakeRawBytes.toString('base64')
    mockFetchRaw.mockResolvedValue(mockOkResponse(b64))

    const validateInstance = {
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(validatedPng),
    }
    mockSharp.mockReturnValue(validateInstance)

    await generateImageWithReference('prompt', '/out/img.png', '/ref/style.png')

    // sharp should have been called with the decoded raw bytes from the API response
    expect(mockSharp).toHaveBeenCalledWith(fakeRawBytes)
    expect(validateInstance.png).toHaveBeenCalled()
    expect(validateInstance.toBuffer).toHaveBeenCalled()

    // The validated buffer (not raw) should be written to disk
    expect(mockWriteFileBuffer).toHaveBeenCalledWith('/out/img.png', validatedPng)
  })

  test('ensures output directory exists before writing', async () => {
    mockDirname.mockReturnValue('/deep/nested/output')

    await generateImageWithReference('prompt', '/deep/nested/output/img.png', '/ref/style.png')

    expect(mockDirname).toHaveBeenCalledWith('/deep/nested/output/img.png')
    expect(mockEnsureDirectory).toHaveBeenCalledWith('/deep/nested/output')
    expect(mockWriteFileBuffer).toHaveBeenCalledWith('/deep/nested/output/img.png', validatedPng)
  })

  test('returns the output path on success', async () => {
    const result = await generateImageWithReference(
      'a banner',
      '/output/banner.png',
      '/ref/style.png',
    )

    expect(result).toBe('/output/banner.png')
  })

  test('includes style prefix in prompt when style option provided', async () => {
    await generateImageWithReference(
      'a diagram',
      '/out/img.png',
      '/ref/style.png',
      { style: 'minimalist' },
    )

    const body: Buffer = mockFetchRaw.mock.calls[0][1].body
    const bodyText = body.toString('utf-8')
    expect(bodyText).toContain('Style: minimalist')
  })

  test('uses specified size and quality options', async () => {
    await generateImageWithReference(
      'a thumbnail',
      '/out/thumb.png',
      '/ref/style.png',
      { size: '1536x1024', quality: 'low' },
    )

    const body: Buffer = mockFetchRaw.mock.calls[0][1].body
    const bodyText = body.toString('utf-8')

    // Multipart fields should contain the specified values
    expect(bodyText).toContain('1536x1024')
    expect(bodyText).toMatch(/name="quality"\r\n\r\nlow/)
  })

  test('throws when sharp validation fails on API response', async () => {
    const validateInstance = {
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockRejectedValue(new Error('corrupt image')),
    }
    mockSharp.mockReturnValue(validateInstance)

    await expect(
      generateImageWithReference('prompt', '/out/img.png', '/ref/style.png'),
    ).rejects.toThrow('Invalid image data')
  })

  test('appends full-canvas base prompt to reference image prompt', async () => {
    mockGetConfig.mockReturnValue({ OPENAI_API_KEY: 'test-key' })
    mockReadFileBuffer.mockResolvedValue(Buffer.alloc(100))
    const sharpInstance = {
      resize: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(50)),
    }
    mockSharp.mockReturnValue(sharpInstance)
    mockFetchRaw.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: Buffer.from('test').toString('base64') }] }),
    })
    mockDirname.mockReturnValue('/out')
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteFileBuffer.mockResolvedValue(undefined)

    await generateImageWithReference('tech thumbnail', '/out/img.png', '/ref/style.png')

    const body = mockFetchRaw.mock.calls[0][1].body as Buffer
    const bodyStr = body.toString()
    expect(bodyStr).toContain('fill the entire canvas edge-to-edge')
    expect(bodyStr).toContain('NO borders')
  })
})

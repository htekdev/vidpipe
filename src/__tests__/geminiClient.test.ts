import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockGetConfig,
  mockLogger,
  mockCostTracker,
  mockUpload,
  mockGet,
  mockGenerateContent,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockCostTracker: { recordServiceUsage: vi.fn() },
  mockUpload: vi.fn(),
  mockGet: vi.fn(),
  mockGenerateContent: vi.fn(),
}))

vi.mock('../config/environment.js', () => ({ getConfig: mockGetConfig }))
vi.mock('../config/logger.js', () => ({ default: mockLogger }))
vi.mock('../services/costTracker.js', () => ({ costTracker: mockCostTracker }))

vi.mock('@google/genai', () => ({
  GoogleGenAI: function() {
    return {
      files: { upload: mockUpload, get: mockGet },
      models: { generateContent: mockGenerateContent },
    }
  },
  createUserContent: vi.fn((...args: unknown[]) => args),
  createPartFromUri: vi.fn((uri: string, mime: string) => ({ uri, mime })),
}))

// ── Import after mocks ──────────────────────────────────────────────────────

import { analyzeVideoEditorial, analyzeVideoClipDirection } from '../tools/gemini/geminiClient.js'

// ── Tests ───────────────────────────────────────────────────────────────────

describe('analyzeVideoClipDirection', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetConfig.mockReturnValue({ GEMINI_API_KEY: 'test-key' })

    mockUpload.mockResolvedValue({
      uri: 'https://gemini.test/file/123',
      mimeType: 'video/mp4',
      name: 'files/123',
      state: 'ACTIVE',
    })

    mockGet.mockResolvedValue({ state: 'ACTIVE' })

    mockGenerateContent.mockResolvedValue({
      text: '## Short Clips\n- 00:30-01:00: Great hook moment\n## Medium Clips\n- 02:00-04:00: Deep dive',
    })
  })

  it('returns markdown text with clip suggestions', async () => {
    const result = await analyzeVideoClipDirection('/video/test.mp4', 300)

    expect(result).toContain('Short Clips')
    expect(result).toContain('Medium Clips')
    expect(typeof result).toBe('string')
  })

  it('calls Gemini with correct model', async () => {
    await analyzeVideoClipDirection('/video/test.mp4', 300, 'gemini-2.5-pro')

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-pro' }),
    )
  })

  it('uses default model gemini-2.5-flash', async () => {
    await analyzeVideoClipDirection('/video/test.mp4', 300)

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
    )
  })

  it('tracks cost via costTracker', async () => {
    await analyzeVideoClipDirection('/video/test.mp4', 300)

    expect(mockCostTracker.recordServiceUsage).toHaveBeenCalledWith(
      'gemini',
      0,
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        durationSeconds: 300,
        estimatedInputTokens: expect.any(Number),
        estimatedOutputTokens: expect.any(Number),
        videoFile: '/video/test.mp4',
      }),
    )
  })

  it('throws when GEMINI_API_KEY is missing', async () => {
    mockGetConfig.mockReturnValue({ GEMINI_API_KEY: '' })

    await expect(
      analyzeVideoClipDirection('/video/test.mp4', 300),
    ).rejects.toThrow('GEMINI_API_KEY')
  })

  it('throws when Gemini returns empty response', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' })

    await expect(
      analyzeVideoClipDirection('/video/test.mp4', 300),
    ).rejects.toThrow('empty response')
  })

  it('throws when file upload fails (no URI)', async () => {
    mockUpload.mockResolvedValue({ uri: null, mimeType: null, name: null, state: 'FAILED' })

    await expect(
      analyzeVideoClipDirection('/video/test.mp4', 300),
    ).rejects.toThrow('no URI returned')
  })

  it('waits for PROCESSING file to become ACTIVE', async () => {
    // First upload returns PROCESSING, then get returns ACTIVE
    mockUpload.mockResolvedValue({
      uri: 'https://gemini.test/file/456',
      mimeType: 'video/mp4',
      name: 'files/456',
      state: 'PROCESSING',
    })
    mockGet
      .mockResolvedValueOnce({ state: 'PROCESSING' })
      .mockResolvedValueOnce({ state: 'ACTIVE' })

    const result = await analyzeVideoClipDirection('/video/test.mp4', 300)

    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(result).toContain('Short Clips')
  })

  it('throws when file processing fails', async () => {
    mockUpload.mockResolvedValue({
      uri: 'https://gemini.test/file/789',
      mimeType: 'video/mp4',
      name: 'files/789',
      state: 'PROCESSING',
    })
    mockGet.mockResolvedValue({ state: 'FAILED' })

    await expect(
      analyzeVideoClipDirection('/video/test.mp4', 300),
    ).rejects.toThrow('file processing failed')
  })
})

describe('analyzeVideoEditorial', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockGetConfig.mockReturnValue({ GEMINI_API_KEY: 'test-key' })

    mockUpload.mockResolvedValue({
      uri: 'https://gemini.test/file/123',
      mimeType: 'video/mp4',
      name: 'files/123',
      state: 'ACTIVE',
    })

    mockGet.mockResolvedValue({ state: 'ACTIVE' })

    mockGenerateContent.mockResolvedValue({
      text: '## Cut Points\n- 00:10: Hard cut\n## Pacing\n- 02:00-03:00: Too slow',
    })
  })

  it('returns editorial direction as markdown', async () => {
    const result = await analyzeVideoEditorial('/video/test.mp4', 300)

    expect(result).toContain('Cut Points')
    expect(typeof result).toBe('string')
  })

  it('throws when GEMINI_API_KEY is missing', async () => {
    mockGetConfig.mockReturnValue({ GEMINI_API_KEY: '' })

    await expect(
      analyzeVideoEditorial('/video/test.mp4', 300),
    ).rejects.toThrow('GEMINI_API_KEY')
  })

  it('tracks cost via costTracker', async () => {
    await analyzeVideoEditorial('/video/test.mp4', 300)

    expect(mockCostTracker.recordServiceUsage).toHaveBeenCalledWith(
      'gemini',
      0,
      expect.objectContaining({
        model: 'gemini-2.5-flash',
        durationSeconds: 300,
      }),
    )
  })
})

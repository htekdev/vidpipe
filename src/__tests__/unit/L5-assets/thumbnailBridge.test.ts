import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ThumbnailResult, ThumbnailConfig } from '../../../L0-pure/types/index.js'

// ── L1 mocks ────────────────────────────────────────────────────────────

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockJoin = vi.hoisted(() => vi.fn((...args: string[]) => args.join('/')))
vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: mockJoin,
}))

const mockFileExists = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  fileExists: mockFileExists,
}))

const mockGetThumbnailConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/brand.js', () => ({
  getThumbnailConfig: mockGetThumbnailConfig,
}))

// ── L4 mocks ────────────────────────────────────────────────────────────

const mockGenerateForClip = vi.hoisted(() => vi.fn())
const mockDestroy = vi.hoisted(() => vi.fn())
vi.mock('../../../L4-agents/ThumbnailAgent.js', () => ({
  ThumbnailAgent: class MockThumbnailAgent {
    generateForClip = mockGenerateForClip
    destroy = mockDestroy
  },
}))

// ── Import under test ───────────────────────────────────────────────────

import { generateThumbnailForClip } from '../../../L5-assets/thumbnailGeneration.js'
import type { ThumbnailContext } from '../../../L5-assets/thumbnailGeneration.js'

// ── Helpers ──────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ThumbnailContext> = {}): ThumbnailContext {
  return {
    title: 'Test Clip',
    description: 'A test clip description',
    videoPath: '/recordings/test-video/test.mp4',
    outputDir: '/recordings/test-video/shorts/clip-1',
    contentType: 'shorts',
    ...overrides,
  }
}

function enabledConfig(overrides: Partial<ThumbnailConfig> = {}): ThumbnailConfig {
  return {
    enabled: true,
    ...overrides,
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetThumbnailConfig.mockReturnValue({ enabled: false })
  mockFileExists.mockResolvedValue(false)
  mockGenerateForClip.mockResolvedValue([])
  mockDestroy.mockResolvedValue(undefined)
})

// ── Tests ────────────────────────────────────────────────────────────────

describe('L5 Unit: thumbnailGeneration — generateThumbnailForClip', () => {
  it('returns null when thumbnails are disabled', async () => {
    mockGetThumbnailConfig.mockReturnValue({ enabled: false })

    const result = await generateThumbnailForClip(makeContext())

    expect(result).toBeNull()
    expect(mockGenerateForClip).not.toHaveBeenCalled()
  })

  it('returns null when content type rule is false', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig({
      rules: { shorts: false },
    }))

    const result = await generateThumbnailForClip(makeContext({ contentType: 'shorts' }))

    expect(result).toBeNull()
    expect(mockGenerateForClip).not.toHaveBeenCalled()
  })

  it('allows generation when content type has no explicit rule (undefined)', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig({
      rules: { main: true },
    }))
    const thumbnailResult: ThumbnailResult = {
      prompt: 'Generate a thumbnail',
      outputPath: '/recordings/test-video/shorts/clip-1/thumbnail.png',
      referenceUsed: false,
    }
    mockGenerateForClip.mockResolvedValue([thumbnailResult])

    const result = await generateThumbnailForClip(makeContext({ contentType: 'shorts' }))

    expect(result).toBe(thumbnailResult.outputPath)
  })

  it('returns existing path when thumbnail already exists (idempotent)', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    mockFileExists.mockResolvedValue(true)

    const result = await generateThumbnailForClip(makeContext())

    expect(result).toBe('/recordings/test-video/shorts/clip-1/thumbnail.png')
    expect(mockGenerateForClip).not.toHaveBeenCalled()
  })

  it('regenerates when force=true even if thumbnail exists', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    mockFileExists.mockResolvedValue(true)
    const thumbnailResult: ThumbnailResult = {
      prompt: 'Generate a thumbnail',
      outputPath: '/recordings/test-video/shorts/clip-1/thumbnail.png',
      referenceUsed: true,
    }
    mockGenerateForClip.mockResolvedValue([thumbnailResult])

    const result = await generateThumbnailForClip(makeContext(), true)

    expect(result).toBe(thumbnailResult.outputPath)
    expect(mockGenerateForClip).toHaveBeenCalled()
  })

  it('calls ThumbnailAgent.generateForClip and returns the output path', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    const thumbnailResult: ThumbnailResult = {
      prompt: 'Bold thumbnail for Test Clip',
      outputPath: '/recordings/test-video/shorts/clip-1/thumbnail.png',
      referenceUsed: false,
    }
    mockGenerateForClip.mockResolvedValue([thumbnailResult])

    const result = await generateThumbnailForClip(makeContext())

    expect(result).toBe(thumbnailResult.outputPath)
    expect(mockGenerateForClip).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Test Clip',
      contentType: 'shorts',
    }))
  })

  it('returns null when agent generates no results', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    mockGenerateForClip.mockResolvedValue([])

    const result = await generateThumbnailForClip(makeContext())

    expect(result).toBeNull()
  })

  it('returns null on agent error (graceful degradation)', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    mockGenerateForClip.mockRejectedValue(new Error('DALL-E rate limit'))

    const result = await generateThumbnailForClip(makeContext())

    expect(result).toBeNull()
  })

  it('destroys agent even when generation fails', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    mockGenerateForClip.mockRejectedValue(new Error('API error'))

    await generateThumbnailForClip(makeContext())

    expect(mockDestroy).toHaveBeenCalled()
  })

  it('destroys agent after successful generation', async () => {
    mockGetThumbnailConfig.mockReturnValue(enabledConfig())
    const thumbnailResult: ThumbnailResult = {
      prompt: 'test',
      outputPath: '/out/thumbnail.png',
      referenceUsed: false,
    }
    mockGenerateForClip.mockResolvedValue([thumbnailResult])

    await generateThumbnailForClip(makeContext())

    expect(mockDestroy).toHaveBeenCalled()
  })
})

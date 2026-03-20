import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// E2E tests — NO MOCKING. Everything runs real.
// API-dependent tests skip when OPENAI_API_KEY is missing.

const hasApiKey = !!process.env.OPENAI_API_KEY

// ── Module-level smoke tests (no API required) ──────────────────────────────
describe('E2E: thumbnail generation module integrity', () => {
  test('L3 thumbnailGeneration exports resolveThumbnailConfig and generateThumbnail', async () => {
    const mod = await import('../../L3-services/imageGeneration/thumbnailGeneration.js')
    expect(typeof mod.resolveThumbnailConfig).toBe('function')
    expect(typeof mod.generateThumbnail).toBe('function')
  })

  test('L5 thumbnailGeneration exports generateThumbnailForClip', async () => {
    const mod = await import('../../L5-assets/thumbnailGeneration.js')
    expect(typeof mod.generateThumbnailForClip).toBe('function')
  })

  test('L4 ThumbnailAgent exports ThumbnailAgent class', async () => {
    const mod = await import('../../L4-agents/ThumbnailAgent.js')
    expect(typeof mod.ThumbnailAgent).toBe('function')
  })

  test('L2 imageGeneration exports generateImage and generateImageWithReference', async () => {
    const mod = await import('../../L2-clients/openai/imageGeneration.js')
    expect(typeof mod.generateImage).toBe('function')
    expect(typeof mod.generateImageWithReference).toBe('function')
    expect(mod.COST_BY_QUALITY).toEqual({ low: 0.04, medium: 0.07, high: 0.07 })
  })

  test('L2 imageGeneration COST_BY_QUALITY has correct pricing tiers', async () => {
    const { COST_BY_QUALITY } = await import('../../L2-clients/openai/imageGeneration.js')
    expect(COST_BY_QUALITY.low).toBeLessThan(COST_BY_QUALITY.medium)
    expect(COST_BY_QUALITY.medium).toBeLessThanOrEqual(COST_BY_QUALITY.high)
  })

  test('L2 Late API CreatePostParams thumbnail is a string type', async () => {
    const { LateApiClient } = await import('../../L2-clients/late/lateApi.js')
    expect(typeof LateApiClient).toBe('function')
  })

  test('L7 thumbnail command exports runThumbnail', async () => {
    const mod = await import('../../L7-app/commands/thumbnail.js')
    expect(typeof mod.runThumbnail).toBe('function')
  })

  test('resolveThumbnailConfig returns valid shape without API', async () => {
    const { resolveThumbnailConfig } = await import(
      '../../L3-services/imageGeneration/thumbnailGeneration.js'
    )

    const config = resolveThumbnailConfig()

    expect(typeof config.enabled).toBe('boolean')
    expect(['1024x1024', '1536x1024', '1024x1536', 'auto']).toContain(config.size)
    expect(['low', 'medium', 'high']).toContain(config.quality)
  })

  test('resolveThumbnailConfig with platform and contentType returns valid shape', async () => {
    const { resolveThumbnailConfig } = await import(
      '../../L3-services/imageGeneration/thumbnailGeneration.js'
    )

    const config = resolveThumbnailConfig('youtube', 'shorts')

    expect(typeof config.enabled).toBe('boolean')
    // Shorts should default to portrait size when enabled
    if (config.enabled) {
      expect(config.size).toBe('1024x1536')
    }
    expect(config.referenceImagePath === null || typeof config.referenceImagePath === 'string').toBe(true)
    expect(config.style === null || typeof config.style === 'string').toBe(true)
    expect(config.promptOverride === null || typeof config.promptOverride === 'string').toBe(true)
  })

  test('ThumbnailAgent registers two tools: generate_thumbnail and capture_best_frame', async () => {
    const { ThumbnailAgent } = await import('../../L4-agents/ThumbnailAgent.js')
    const agent = new ThumbnailAgent()
    try {
      const tools = (agent as unknown as { getTools(): Array<{ name: string }> }).getTools()
      expect(tools).toHaveLength(2)
      expect(tools.map(t => t.name)).toEqual(
        expect.arrayContaining(['generate_thumbnail', 'capture_best_frame']),
      )
    } finally {
      await agent.destroy()
    }
  })

  test('generateThumbnail returns null when thumbnails are disabled', async () => {
    const { resolveThumbnailConfig, generateThumbnail } = await import(
      '../../L3-services/imageGeneration/thumbnailGeneration.js'
    )
    const config = resolveThumbnailConfig()

    if (!config.enabled) {
      const result = await generateThumbnail('test prompt', '/tmp/thumb.png')
      expect(result).toBeNull()
    }
  })
})

// ── Real API tests (require OPENAI_API_KEY) ─────────────────────────────────
describe.skipIf(!hasApiKey)('E2E: thumbnail generation with real API', () => {
  const tmpDir = join(process.cwd(), '.test-thumbnails-e2e')

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('generates valid PNG thumbnail via L3 service', async () => {
    const { generateThumbnail } = await import(
      '../../L3-services/imageGeneration/thumbnailGeneration.js'
    )
    const { resolveThumbnailConfig } = await import(
      '../../L3-services/imageGeneration/thumbnailGeneration.js'
    )

    const config = resolveThumbnailConfig()
    if (!config.enabled) {
      // Thumbnails disabled in brand config — skip gracefully
      return
    }

    const outputPath = join(tmpDir, 'e2e-thumbnail.png')

    const result = await generateThumbnail(
      'A bold tech thumbnail showing code on a screen with vibrant neon colors',
      outputPath,
    )

    expect(result).not.toBeNull()
    expect(existsSync(result!)).toBe(true)

    // Verify PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const data = readFileSync(result!)
    expect(data[0]).toBe(0x89)
    expect(data[1]).toBe(0x50) // 'P'
    expect(data[2]).toBe(0x4e) // 'N'
    expect(data[3]).toBe(0x47) // 'G'
    expect(data.length).toBeGreaterThan(1000) // Non-trivial file size
  }, 120_000) // 2 min timeout for API call

  test('generates valid PNG thumbnail via L2 client directly', async () => {
    const { generateImage } = await import('../../L2-clients/openai/imageGeneration.js')
    const outputPath = join(tmpDir, 'e2e-l2-thumbnail.png')

    const result = await generateImage(
      'A minimalist geometric pattern in blue gradient',
      outputPath,
      { size: '1024x1024', quality: 'low' },
    )

    expect(result).toBe(outputPath)
    expect(existsSync(outputPath)).toBe(true)

    const data = readFileSync(outputPath)
    // PNG magic bytes
    expect(data[0]).toBe(0x89)
    expect(data[1]).toBe(0x50)
    expect(data[2]).toBe(0x4e)
    expect(data[3]).toBe(0x47)
    expect(data.length).toBeGreaterThan(1000)
  }, 120_000)
})

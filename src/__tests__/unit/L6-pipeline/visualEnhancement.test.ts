import { describe, it, expect } from 'vitest'
import { buildOverlayFilterComplex, getOverlayPosition } from '../../../L2-clients/ffmpeg/overlayCompositing.js'
import type { GeneratedOverlay, EnhancementOpportunity, OverlayRegion } from '../../../L0-pure/types/index.js'

function makeOverlay(overrides: Partial<{
  timestampStart: number
  timestampEnd: number
  region: OverlayRegion
  sizePercent: number
  imagePath: string
}>): GeneratedOverlay {
  const opportunity: EnhancementOpportunity = {
    timestampStart: overrides.timestampStart ?? 10,
    timestampEnd: overrides.timestampEnd ?? 20,
    topic: 'test-topic',
    imagePrompt: 'test prompt',
    reason: 'test reason',
    placement: {
      region: overrides.region ?? 'top-right',
      avoidAreas: [],
      sizePercent: overrides.sizePercent ?? 25,
    },
    confidence: 0.9,
  }
  return {
    opportunity,
    imagePath: overrides.imagePath ?? '/tmp/test.png',
    width: 1024,
    height: 1024,
  }
}

describe('getOverlayPosition', () => {
  it('returns correct position for top-left', () => {
    const pos = getOverlayPosition('top-left', 96)
    expect(pos.x).toBe('96')
    expect(pos.y).toBe('96')
  })

  it('returns correct position for top-right', () => {
    const pos = getOverlayPosition('top-right', 96)
    expect(pos.x).toBe('(main_w-overlay_w-96)')
    expect(pos.y).toBe('96')
  })

  it('returns correct position for bottom-left', () => {
    const pos = getOverlayPosition('bottom-left', 96)
    expect(pos.x).toBe('96')
    expect(pos.y).toBe('(main_h-overlay_h-96)')
  })

  it('returns correct position for bottom-right', () => {
    const pos = getOverlayPosition('bottom-right', 96)
    expect(pos.x).toBe('(main_w-overlay_w-96)')
    expect(pos.y).toBe('(main_h-overlay_h-96)')
  })

  it('returns correct position for center-right', () => {
    const pos = getOverlayPosition('center-right', 96)
    expect(pos.x).toBe('(main_w-overlay_w-96)')
    expect(pos.y).toBe('((main_h-overlay_h)/2)')
  })

  it('returns correct position for center-left', () => {
    const pos = getOverlayPosition('center-left', 96)
    expect(pos.x).toBe('96')
    expect(pos.y).toBe('((main_h-overlay_h)/2)')
  })
})

describe('buildOverlayFilterComplex', () => {
  it('builds correct filter for single overlay', () => {
    const overlay = makeOverlay({ timestampStart: 10, timestampEnd: 20, sizePercent: 25 })
    const filter = buildOverlayFilterComplex([overlay], 1920, 1080)

    // Scale: 25% of 1920 = 480
    expect(filter).toContain('scale=480:-1')
    // Enable window
    expect(filter).toContain("enable='between(t,10,20)'")
    // Single overlay outputs [outv] directly
    expect(filter).toContain('[outv]')
  })

  it('chains multiple overlays correctly', () => {
    const o1 = makeOverlay({ timestampStart: 10, timestampEnd: 20, region: 'top-right' })
    const o2 = makeOverlay({ timestampStart: 40, timestampEnd: 50, region: 'bottom-left' })
    const filter = buildOverlayFilterComplex([o1, o2], 1920, 1080)

    // First overlay uses [0:v] as base input
    expect(filter).toContain('[0:v]')
    // First overlay outputs [out_0] (intermediate)
    expect(filter).toContain('[out_0]')
    // Second overlay uses [out_0] as input and outputs [outv]
    expect(filter).toContain('[outv]')
    // No [out_1] — last overlay always outputs [outv]
    expect(filter).not.toContain('[out_1]')
  })

  it('calculates margin as 5% of video width', () => {
    const overlay = makeOverlay({ region: 'top-right' })
    const filter = buildOverlayFilterComplex([overlay], 1920, 1080)
    // 5% of 1920 = 96
    expect(filter).toContain('96')
  })

  it('uses correct input indices for overlay images', () => {
    const o1 = makeOverlay({ timestampStart: 5, timestampEnd: 15 })
    const o2 = makeOverlay({ timestampStart: 25, timestampEnd: 35 })
    const filter = buildOverlayFilterComplex([o1, o2], 1920, 1080)

    // First image is [1:v], second is [2:v]
    expect(filter).toContain('[1:v]scale=')
    expect(filter).toContain('[2:v]scale=')
  })

  it('uses enable between for time window', () => {
    const overlay = makeOverlay({ timestampStart: 10, timestampEnd: 10.3 })
    const filter = buildOverlayFilterComplex([overlay], 1920, 1080)

    // Even for short overlays, enable window should be correct
    expect(filter).toContain("enable='between(t,10,10.3)'")
  })

  it('calculates overlay scale from sizePercent and video width', () => {
    const overlay = makeOverlay({ sizePercent: 30 })
    const filter = buildOverlayFilterComplex([overlay], 1920, 1080)
    // 30% of 1920 = 576
    expect(filter).toContain('scale=576:-1')
  })

  it('ends with format=yuv420p conversion to prevent corrupted output', () => {
    const overlay = makeOverlay({})
    const filter = buildOverlayFilterComplex([overlay], 1920, 1080)
    // Must end with yuv420p conversion — without this, RGBA overlays promote to yuv444p
    expect(filter).toContain('[overlaid]format=yuv420p[outv]')
  })

  it('uses [overlaid] intermediate label before final yuv420p conversion', () => {
    const o1 = makeOverlay({ timestampStart: 10, timestampEnd: 20 })
    const o2 = makeOverlay({ timestampStart: 40, timestampEnd: 50 })
    const filter = buildOverlayFilterComplex([o1, o2], 1920, 1080)
    // Last overlay outputs [overlaid], then format conversion produces [outv]
    const parts = filter.split(';')
    const lastPart = parts[parts.length - 1]
    expect(lastPart).toBe('[overlaid]format=yuv420p[outv]')
  })
})

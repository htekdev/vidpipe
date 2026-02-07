import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must be before imports) ───────────────────────────────────────────

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('fs', () => ({
  promises: {
    mkdtemp: vi.fn().mockResolvedValue('/tmp/face-detect-abc'),
    readdir: vi.fn().mockResolvedValue([]),
    unlink: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('sharp', () => ({
  default: vi.fn(),
}))

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  isSkinTone,
  calculateCornerConfidence,
  detectWebcamRegion,
  findPeakDiff,
  refineBoundingBox,
} from '../tools/ffmpeg/faceDetection.js'
import type { WebcamRegion } from '../tools/ffmpeg/faceDetection.js'
import { execFile } from 'child_process'
import sharpDefault from 'sharp'

const mockedExecFile = vi.mocked(execFile)
const mockedSharp = vi.mocked(sharpDefault)

// ── isSkinTone ───────────────────────────────────────────────────────────────

describe('isSkinTone', () => {
  it('returns true for typical skin tones', () => {
    // Light skin
    expect(isSkinTone(200, 150, 130)).toBe(true)
    // Medium skin
    expect(isSkinTone(180, 120, 90)).toBe(true)
    // Darker warm skin
    expect(isSkinTone(160, 100, 70)).toBe(true)
  })

  it('returns false for pure blue', () => {
    expect(isSkinTone(0, 0, 255)).toBe(false)
  })

  it('returns false for pure green', () => {
    expect(isSkinTone(0, 255, 0)).toBe(false)
  })

  it('returns false for black', () => {
    expect(isSkinTone(0, 0, 0)).toBe(false)
  })

  it('returns false for white', () => {
    // White: R=G=B → |R-G| = 0, fails abs(r-g) > 15
    expect(isSkinTone(255, 255, 255)).toBe(false)
  })

  it('returns false when R is not dominant', () => {
    // G > R
    expect(isSkinTone(100, 200, 50)).toBe(false)
  })

  it('returns false for low R below threshold', () => {
    // R <= 95
    expect(isSkinTone(90, 50, 30)).toBe(false)
  })

  it('returns false for low G below threshold', () => {
    // G <= 40
    expect(isSkinTone(200, 30, 20)).toBe(false)
  })

  it('returns false for low B below threshold', () => {
    // B <= 20
    expect(isSkinTone(200, 100, 15)).toBe(false)
  })

  it('returns false when max-min difference is too small', () => {
    // max - min <= 15
    expect(isSkinTone(100, 96, 90)).toBe(false)
  })

  it('returns false when R-G difference is too small', () => {
    // |R - G| <= 15
    expect(isSkinTone(110, 100, 50)).toBe(false)
  })

  it('returns false when B > R', () => {
    expect(isSkinTone(100, 50, 150)).toBe(false)
  })
})

// ── calculateCornerConfidence ────────────────────────────────────────────────

describe('calculateCornerConfidence', () => {
  it('returns 0 for empty scores array', () => {
    expect(calculateCornerConfidence([])).toBe(0)
  })

  it('returns 0 when all scores are zero', () => {
    expect(calculateCornerConfidence([0, 0, 0, 0, 0])).toBe(0)
  })

  it('returns high confidence for consistently high scores', () => {
    const confidence = calculateCornerConfidence([0.5, 0.6, 0.7, 0.5, 0.6])
    // All non-zero → consistency=1, avgScore=0.58, min(5.8,1)=1 → conf=1
    expect(confidence).toBe(1)
  })

  it('returns moderate confidence for mixed scores', () => {
    const confidence = calculateCornerConfidence([0.3, 0, 0.4, 0, 0.2])
    // 3/5 non-zero → consistency=0.6, avg=0.18, min(1.8,1)=1 → conf=0.6
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThan(1)
  })

  it('returns low confidence for mostly zero scores', () => {
    const confidence = calculateCornerConfidence([0, 0, 0, 0, 0.01])
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThan(0.1)
  })

  it('caps avgScore contribution at 1', () => {
    // Large scores: avg=2.0, min(20,1)=1 → confidence = consistency * 1
    const confidence = calculateCornerConfidence([2.0, 2.0, 2.0])
    expect(confidence).toBe(1)
  })
})

// ── detectWebcamRegion ───────────────────────────────────────────────────────

describe('detectWebcamRegion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /**
   * Helper: set up execFile to respond to ffprobe/ffmpeg calls.
   * - First call (ffprobe resolution): returns "1920,1080"
   * - Second call (ffprobe duration): returns "60.0"
   * - Remaining calls (ffmpeg frame extraction): succeed
   */
  function setupExecFileMocks(opts?: {
    resolution?: string
    duration?: string
    fail?: boolean
  }) {
    const resolution = opts?.resolution ?? '1920,1080'
    const duration = opts?.duration ?? '60.0'
    const fail = opts?.fail ?? false

    let callIndex = 0
    mockedExecFile.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = typeof rest[0] === 'function' ? rest[0] : rest[1]
      const argsArr = args as string[]

      if (fail) {
        cb(new Error('ffprobe failed'), '', '')
        return undefined as any
      }

      // ffprobe calls
      if (argsArr.includes('format=duration')) {
        cb(null, duration, '')
      } else if (argsArr.includes('stream=width,height')) {
        cb(null, resolution, '')
      } else {
        // ffmpeg frame extraction
        cb(null, '', '')
      }
      return undefined as any
    })
  }

  /**
   * Helper: create sharp mock that returns pixel data for both
   * corner analysis (extract().raw().toBuffer()) and
   * edge refinement (raw().toBuffer()).
   * @param skinCorner - which corner has skin-tone pixels
   */
  function setupSharpMock(skinCorner?: WebcamRegion['position']) {
    const cornerW = 80 // 320 * 0.25
    const cornerH = 45 // 180 * 0.25
    const frameW = 320
    const frameH = 180

    mockedSharp.mockImplementation((framePath: any) => {
      // Full-frame buffer for refineBoundingBox: gray background + webcam region
      const fullBuf = Buffer.alloc(frameW * frameH * 3)
      for (let i = 0; i < frameW * frameH; i++) {
        fullBuf[i * 3] = 128
        fullBuf[i * 3 + 1] = 128
        fullBuf[i * 3 + 2] = 128
      }
      if (skinCorner) {
        // Place a bright webcam-like block in the appropriate corner
        const wcW = 50, wcH = 50
        const wcX = skinCorner.includes('right') ? frameW - wcW : 0
        const wcY = skinCorner.includes('bottom') ? frameH - wcH : 0
        for (let y = wcY; y < wcY + wcH; y++) {
          for (let x = wcX; x < wcX + wcW; x++) {
            const idx = (y * frameW + x) * 3
            fullBuf[idx] = 200
            fullBuf[idx + 1] = 150
            fullBuf[idx + 2] = 100
          }
        }
      }

      // raw() for full-frame refinement
      const rawForFull = vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue({
          data: fullBuf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      })

      // extract() for corner analysis
      const extractFn = vi.fn().mockImplementation(({ left, top }: any) => {
        let pos: string
        if (left === 0 && top === 0) pos = 'top-left'
        else if (left > 0 && top === 0) pos = 'top-right'
        else if (left === 0 && top > 0) pos = 'bottom-left'
        else pos = 'bottom-right'

        const pixelCount = cornerW * cornerH
        const buf = Buffer.alloc(pixelCount * 3)

        if (pos === skinCorner) {
          for (let i = 0; i < pixelCount; i++) {
            const v = (i % 60)
            buf[i * 3] = 170 + v
            buf[i * 3 + 1] = 100 + (v >> 1)
            buf[i * 3 + 2] = 60 + (v >> 2)
          }
        } else {
          for (let i = 0; i < pixelCount; i++) {
            buf[i * 3] = 128
            buf[i * 3 + 1] = 128
            buf[i * 3 + 2] = 128
          }
        }

        return {
          raw: vi.fn().mockReturnValue({
            toBuffer: vi.fn().mockResolvedValue({
              data: buf,
              info: { width: cornerW, height: cornerH, channels: 3 },
            }),
          }),
        }
      })

      return { extract: extractFn, raw: rawForFull } as any
    })
  }

  it('detects webcam in bottom-right corner with refined bounds', async () => {
    setupExecFileMocks()
    setupSharpMock('bottom-right')

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('bottom-right')
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.width).toBeGreaterThan(0)
    expect(result!.height).toBeGreaterThan(0)
    // With refinement, the x should be further right than the coarse 25% corner
    // Coarse would be 1920 - 480 = 1440; refined should be closer to 1920 - 300 = 1620
    expect(result!.x).toBeGreaterThan(1440)
  })

  it('detects webcam in top-left corner', async () => {
    setupExecFileMocks()
    setupSharpMock('top-left')

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('top-left')
  })

  it('returns null when no skin tones detected', async () => {
    setupExecFileMocks()
    setupSharpMock(undefined) // all corners uniform gray

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).toBeNull()
  })

  it('handles ffprobe failure gracefully', async () => {
    setupExecFileMocks({ fail: true })

    await expect(detectWebcamRegion('/video.mp4')).rejects.toThrow()
  })
})

// ── findPeakDiff ─────────────────────────────────────────────────────────────

describe('findPeakDiff', () => {
  it('finds the index of the maximum inter-adjacent difference', () => {
    // Flat region then sharp jump: 10, 10, 10, 50, 50
    const means = new Float64Array([10, 10, 10, 50, 50])
    const result = findPeakDiff(means, 0, 4, 1.0)
    expect(result.index).toBe(2) // diff between index 2 and 3 = 40
    expect(result.magnitude).toBe(40)
  })

  it('returns -1 when no difference exceeds minDiff', () => {
    const means = new Float64Array([100, 100.5, 101, 100.8])
    const result = findPeakDiff(means, 0, 3, 5.0)
    expect(result.index).toBe(-1)
  })

  it('respects search range boundaries', () => {
    // Big jump at index 1, but search starts at index 3
    const means = new Float64Array([10, 100, 100, 100, 100, 50])
    const result = findPeakDiff(means, 3, 5, 1.0)
    expect(result.index).toBe(4) // diff between 4 and 5 = 50
    expect(result.magnitude).toBe(50)
  })

  it('handles empty or single-element arrays', () => {
    expect(findPeakDiff(new Float64Array([]), 0, 0, 1.0).index).toBe(-1)
    expect(findPeakDiff(new Float64Array([42]), 0, 0, 1.0).index).toBe(-1)
  })
})

// ── refineBoundingBox ────────────────────────────────────────────────────────

describe('refineBoundingBox', () => {
  it('returns null for empty frame list', async () => {
    const result = await refineBoundingBox([], 'bottom-right')
    expect(result).toBeNull()
  })

  it('refines a bottom-right webcam region from full-frame data', async () => {
    const frameW = 320, frameH = 180, wcW = 50, wcH = 50
    const wcX = frameW - wcW, wcY = frameH - wcH

    // Create a frame: gray background with bright block in bottom-right
    const buf = Buffer.alloc(frameW * frameH * 3)
    for (let i = 0; i < frameW * frameH; i++) {
      buf[i * 3] = 128; buf[i * 3 + 1] = 128; buf[i * 3 + 2] = 128
    }
    for (let y = wcY; y < frameH; y++) {
      for (let x = wcX; x < frameW; x++) {
        const idx = (y * frameW + x) * 3
        buf[idx] = 200; buf[idx + 1] = 150; buf[idx + 2] = 100
      }
    }

    mockedSharp.mockImplementation(() => ({
      raw: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue({
          data: buf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }),
    }) as any)

    const result = await refineBoundingBox(['/frame.png'], 'bottom-right')

    expect(result).not.toBeNull()
    // Webcam starts at x=270 in 320-wide frame
    expect(result!.x).toBeGreaterThanOrEqual(wcX - 2)
    expect(result!.x).toBeLessThanOrEqual(wcX + 2)
    // Webcam starts at y=130 in 180-high frame
    expect(result!.y).toBeGreaterThanOrEqual(wcY - 2)
    expect(result!.y).toBeLessThanOrEqual(wcY + 2)
    expect(result!.width).toBeGreaterThan(0)
    expect(result!.height).toBeGreaterThan(0)
  })

  it('refines a top-left webcam region', async () => {
    const frameW = 320, frameH = 180, wcW = 60, wcH = 40

    const buf = Buffer.alloc(frameW * frameH * 3)
    for (let i = 0; i < frameW * frameH; i++) {
      buf[i * 3] = 128; buf[i * 3 + 1] = 128; buf[i * 3 + 2] = 128
    }
    for (let y = 0; y < wcH; y++) {
      for (let x = 0; x < wcW; x++) {
        const idx = (y * frameW + x) * 3
        buf[idx] = 220; buf[idx + 1] = 160; buf[idx + 2] = 90
      }
    }

    mockedSharp.mockImplementation(() => ({
      raw: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue({
          data: buf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }),
    }) as any)

    const result = await refineBoundingBox(['/frame.png'], 'top-left')

    expect(result).not.toBeNull()
    expect(result!.x).toBe(0)
    expect(result!.y).toBe(0)
    // Width should be close to wcW
    expect(result!.width).toBeGreaterThanOrEqual(wcW - 2)
    expect(result!.width).toBeLessThanOrEqual(wcW + 2)
  })

  it('returns null when frame has no clear edges', async () => {
    const frameW = 320, frameH = 180
    // Uniform frame - no edges to detect
    const buf = Buffer.alloc(frameW * frameH * 3, 128)

    mockedSharp.mockImplementation(() => ({
      raw: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue({
          data: buf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }),
    }) as any)

    const result = await refineBoundingBox(['/frame.png'], 'bottom-right')
    expect(result).toBeNull()
  })
})

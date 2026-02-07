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
   * Helper: create sharp mock that returns pixel data.
   * @param skinCorner - which corner has skin-tone pixels
   */
  function setupSharpMock(skinCorner?: WebcamRegion['position']) {
    const cornerW = 80 // 320 * 0.25
    const cornerH = 45 // 180 * 0.25

    mockedSharp.mockImplementation((framePath: any) => {
      const extractFn = vi.fn().mockImplementation(({ left, top }: any) => {
        // Determine which corner this extract call is for
        let pos: string
        if (left === 0 && top === 0) pos = 'top-left'
        else if (left > 0 && top === 0) pos = 'top-right'
        else if (left === 0 && top > 0) pos = 'bottom-left'
        else pos = 'bottom-right'

        const pixelCount = cornerW * cornerH
        const buf = Buffer.alloc(pixelCount * 3)

        if (pos === skinCorner) {
          // Fill with varied skin-tone pixels — passes isSkinTone with high variance
          for (let i = 0; i < pixelCount; i++) {
            const v = (i % 60) // variation to create variance
            buf[i * 3] = 170 + v       // R: 170-230
            buf[i * 3 + 1] = 100 + (v >> 1) // G: 100-130
            buf[i * 3 + 2] = 60 + (v >> 2)  // B: 60-75
          }
        } else {
          // Fill with uniform gray (128, 128, 128) — fails isSkinTone
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

      return { extract: extractFn } as any
    })
  }

  it('detects webcam in bottom-right corner', async () => {
    setupExecFileMocks()
    setupSharpMock('bottom-right')

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('bottom-right')
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.width).toBeGreaterThan(0)
    expect(result!.height).toBeGreaterThan(0)
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

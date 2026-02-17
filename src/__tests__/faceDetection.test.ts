import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (must be before imports) ───────────────────────────────────────────

vi.mock('../../config/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: actual.existsSync,
    },
    promises: {
      mkdtemp: vi.fn().mockResolvedValue('/tmp/face-detect-abc'),
      readdir: vi.fn().mockResolvedValue([]),
      unlink: vi.fn().mockResolvedValue(undefined),
      rmdir: vi.fn().mockResolvedValue(undefined),
    },
  }
})

vi.mock('tmp', () => ({
  default: {
    setGracefulCleanup: vi.fn(),
    dir: vi.fn((_opts: any, cb: any) => cb(null, '/tmp/face-detect-abc')),
  },
}))

vi.mock('sharp', () => ({
  default: vi.fn(),
}))

vi.mock('onnxruntime-node', () => {
  class MockTensor {
    type: string
    data: any
    dims: number[]
    constructor(type: string, data: any, dims: number[]) {
      this.type = type
      this.data = data
      this.dims = dims
    }
  }
  return {
    InferenceSession: {
      create: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue({
          scores: { data: new Float32Array([0.1, 0.9]) },
          boxes: { data: new Float32Array([0.7, 0.7, 0.9, 0.9]) },
        }),
      }),
    },
    Tensor: MockTensor,
  }
})

// ── Imports ──────────────────────────────────────────────────────────────────

import {
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
    // All non-zero → consistency=1.0, avgScore=0.58 → conf = consistency * avgScore = 1.0 * 0.58 = 0.58
    expect(confidence).toBeCloseTo(0.58, 1)
  })

  it('returns moderate confidence for mixed scores', () => {
    const confidence = calculateCornerConfidence([0.3, 0, 0.4, 0, 0.2])
    // 3/5 non-zero → consistency=0.6, avg=0.18 → conf=0.108
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThan(0.5)
  })

  it('returns low confidence for mostly zero scores', () => {
    const confidence = calculateCornerConfidence([0, 0, 0, 0, 0.01])
    expect(confidence).toBeGreaterThan(0)
    expect(confidence).toBeLessThan(0.01)
  })

  it('scales linearly with avgScore (no cap)', () => {
    // consistency=1, avgScore=2.0 → confidence=2.0 (no capping)
    const confidence = calculateCornerConfidence([2.0, 2.0, 2.0])
    expect(confidence).toBe(2)
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
   * Helper: create sharp mock that returns pixel data for ONNX preprocessing
   * (resize + removeAlpha + raw) and edge refinement (raw).
   */
  function setupSharpMock(opts?: { webcamCorner?: WebcamRegion['position'] }) {
    const frameW = 320
    const frameH = 240 // ONNX model expects 240 height

    mockedSharp.mockImplementation((_framePath: any) => {
      // Full-frame buffer for refineBoundingBox
      const fullBuf = Buffer.alloc(frameW * frameH * 3)
      for (let i = 0; i < frameW * frameH; i++) {
        fullBuf[i * 3] = 128
        fullBuf[i * 3 + 1] = 128
        fullBuf[i * 3 + 2] = 128
      }
      if (opts?.webcamCorner) {
        const wcW = 50, wcH = 50
        const wcX = opts.webcamCorner.includes('right') ? frameW - wcW : 0
        const wcY = opts.webcamCorner.includes('bottom') ? frameH - wcH : 0
        for (let y = wcY; y < wcY + wcH; y++) {
          for (let x = wcX; x < wcX + wcW; x++) {
            const idx = (y * frameW + x) * 3
            fullBuf[idx] = 200
            fullBuf[idx + 1] = 150
            fullBuf[idx + 2] = 100
          }
        }
      }

      const rawResult = {
        toBuffer: vi.fn().mockResolvedValue({
          data: fullBuf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }

      return {
        resize: vi.fn().mockReturnValue({
          removeAlpha: vi.fn().mockReturnValue({
            raw: vi.fn().mockReturnValue(rawResult),
          }),
        }),
        raw: vi.fn().mockReturnValue(rawResult),
      } as any
    })
  }

  it('detects webcam in bottom-right corner via ONNX face detection', async () => {
    setupExecFileMocks()
    setupSharpMock({ webcamCorner: 'bottom-right' })

    // Mock ONNX to return a face in bottom-right corner (normalized coords)
    const ort = await import('onnxruntime-node')
    const mockSession = await (ort.InferenceSession as any).create()
    mockSession.run.mockResolvedValue({
      scores: { data: new Float32Array([0.05, 0.95]) }, // 1 detection: [bg=0.05, face=0.95]
      boxes: { data: new Float32Array([0.75, 0.75, 0.95, 0.95]) }, // bottom-right corner
    })

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('bottom-right')
    expect(result!.confidence).toBeGreaterThan(0)
    expect(result!.width).toBeGreaterThan(0)
    expect(result!.height).toBeGreaterThan(0)
  })

  it('detects webcam in top-left corner', async () => {
    setupExecFileMocks()
    setupSharpMock({ webcamCorner: 'top-left' })

    const ort = await import('onnxruntime-node')
    const mockSession = await (ort.InferenceSession as any).create()
    mockSession.run.mockResolvedValue({
      scores: { data: new Float32Array([0.05, 0.90]) },
      boxes: { data: new Float32Array([0.05, 0.05, 0.25, 0.25]) }, // top-left corner
    })

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('top-left')
  })

  it('returns null when no faces detected', async () => {
    setupExecFileMocks()
    setupSharpMock()

    const ort = await import('onnxruntime-node')
    const mockSession = await (ort.InferenceSession as any).create()
    mockSession.run.mockResolvedValue({
      scores: { data: new Float32Array([0.95, 0.05]) }, // no face (bg > face)
      boxes: { data: new Float32Array([0.0, 0.0, 0.1, 0.1]) },
    })

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

  it('accepts custom minEdgeDiff parameter for adaptive retry', async () => {
    const frameW = 320, frameH = 180
    // Create a frame with a SUBTLE edge (diff ~2.0) that fails at 3.0 but passes at 1.0
    // Webcam region must be 5-55% of frame to pass sanity check
    const buf = Buffer.alloc(frameW * frameH * 3)
    const wcX = 220, wcY = 90 // ~31% width, ~50% height
    for (let i = 0; i < frameW * frameH; i++) {
      const x = i % frameW, y = Math.floor(i / frameW)
      const inWebcam = x >= wcX && y >= wcY
      const val = inWebcam ? 131 : 128 // ~3 intensity difference, averaged to ~2.3 (fails at 3.0, passes at 1.0)
      buf[i * 3] = val; buf[i * 3 + 1] = val; buf[i * 3 + 2] = val
    }

    mockedSharp.mockImplementation(() => ({
      raw: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue({
          data: buf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }),
    }) as any)

    // Should fail at default threshold (3.0)
    const resultHigh = await refineBoundingBox(['/frame.png'], 'bottom-right', 3.0)
    expect(resultHigh).toBeNull()

    // Should succeed at lower threshold (1.0)
    const resultLow = await refineBoundingBox(['/frame.png'], 'bottom-right', 1.0)
    expect(resultLow).not.toBeNull()
  })
})

// ── Proportional fallback ────────────────────────────────────────────────────

describe('detectWebcamRegion proportional fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses proportional fallback instead of 1.4x face expansion when refinement fails', async () => {
    // Set up mocks: ffprobe returns 1920x1080 resolution, 60s duration
    const mockedExecFileLocal = vi.mocked(execFile)
    mockedExecFileLocal.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = typeof rest[0] === 'function' ? rest[0] : rest[1]
      const argsArr = args as string[]
      if (argsArr.includes('format=duration')) cb(null, '60.0', '')
      else if (argsArr.includes('stream=width,height')) cb(null, '1920,1080', '')
      else cb(null, '', '')
      return undefined as any
    })

    // Sharp: uniform frame (no edges — forces refinement to fail at all thresholds)
    const frameW = 320, frameH = 240
    const uniformBuf = Buffer.alloc(frameW * frameH * 3, 128)
    mockedSharp.mockImplementation(() => {
      const rawResult = {
        toBuffer: vi.fn().mockResolvedValue({
          data: uniformBuf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }
      return {
        resize: vi.fn().mockReturnValue({
          removeAlpha: vi.fn().mockReturnValue({
            raw: vi.fn().mockReturnValue(rawResult),
          }),
        }),
        raw: vi.fn().mockReturnValue(rawResult),
      } as any
    })

    // ONNX returns a face in bottom-right corner
    const ort = await import('onnxruntime-node')
    const mockSession = await (ort.InferenceSession as any).create()
    mockSession.run.mockResolvedValue({
      scores: { data: new Float32Array([0.05, 0.95]) },
      boxes: { data: new Float32Array([0.75, 0.75, 0.95, 0.95]) },
    })

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('bottom-right')
    // Proportional fallback: ~33% of 1920 = ~634px wide (NOT 1.4x face = ~208px)
    expect(result!.width).toBeGreaterThan(300)
    expect(result!.width).toBeCloseTo(Math.round(1920 * 0.33), -1)
    expect(result!.height).toBeCloseTo(Math.round(1080 * 0.28), -1)
    // Should be positioned in the corner
    expect(result!.x).toBe(1920 - result!.width)
    expect(result!.y).toBe(1080 - result!.height)
  })

  it('uses proportional fallback when refined region height is too small', async () => {
    // Simulates the 814×77 bug: edge refinement finds a spurious horizontal edge
    // near the frame bottom, producing an implausibly flat region
    const mockedExecFileLocal = vi.mocked(execFile)
    mockedExecFileLocal.mockImplementation((_cmd: any, args: any, ...rest: any[]) => {
      const cb = typeof rest[0] === 'function' ? rest[0] : rest[1]
      const argsArr = args as string[]
      if (argsArr.includes('format=duration')) cb(null, '60.0', '')
      else if (argsArr.includes('stream=width,height')) cb(null, '2304,1536', '')
      else cb(null, '', '')
      return undefined as any
    })

    // Sharp: create a frame with a strong vertical edge but a spurious horizontal
    // edge near the very bottom — simulating a taskbar or thin strip
    const frameW = 320, frameH = 240
    const buf = Buffer.alloc(frameW * frameH * 3)
    for (let i = 0; i < frameW * frameH; i++) {
      const x = i % frameW, y = Math.floor(i / frameW)
      const inRight = x >= 207
      const inBottom = y >= 228
      const val = (inRight && inBottom) ? 180 : 128
      buf[i * 3] = val; buf[i * 3 + 1] = val; buf[i * 3 + 2] = val
    }
    mockedSharp.mockImplementation(() => {
      const rawResult = {
        toBuffer: vi.fn().mockResolvedValue({
          data: buf,
          info: { width: frameW, height: frameH, channels: 3 },
        }),
      }
      return {
        resize: vi.fn().mockReturnValue({
          removeAlpha: vi.fn().mockReturnValue({
            raw: vi.fn().mockReturnValue(rawResult),
          }),
        }),
        raw: vi.fn().mockReturnValue(rawResult),
      } as any
    })

    const ort = await import('onnxruntime-node')
    const mockSession = await (ort.InferenceSession as any).create()
    mockSession.run.mockResolvedValue({
      scores: { data: new Float32Array([0.05, 0.95]) },
      boxes: { data: new Float32Array([0.75, 0.75, 0.95, 0.95]) },
    })

    const result = await detectWebcamRegion('/video.mp4')

    expect(result).not.toBeNull()
    expect(result!.position).toBe('bottom-right')
    // Should fall back to proportional sizing, NOT the 77px-tall refined result
    expect(result!.height).toBeGreaterThan(200)
    expect(result!.width).toBeCloseTo(Math.round(2304 * 0.33), -1)
    expect(result!.height).toBeCloseTo(Math.round(1536 * 0.28), -1)
  })
})

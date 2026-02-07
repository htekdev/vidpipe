import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { promises as fs } from 'fs'
import { isFFmpegAvailable } from './fixture.js'
import { detectWebcamRegion, isSkinTone, calculateCornerConfidence } from '../../tools/ffmpeg/faceDetection.js'

const execFileAsync = promisify(execFile)
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

describe('faceDetection integration', { timeout: 60_000 }, () => {
  let videoPath: string
  let tempDir: string

  beforeAll(async () => {
    const available = await isFFmpegAvailable()
    if (!available) throw new Error('FFmpeg not available – skipping integration tests')

    // Create a dedicated longer video (10s) to avoid edge-case frame extraction at exact duration
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantr-face-integ-'))
    videoPath = path.join(tempDir, 'test-face.mp4')
    await execFileAsync(ffmpegPath, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=10:size=640x480:rate=25',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '64k',
      '-shortest',
      videoPath,
    ], { timeout: 30_000 })
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  // ── 1. No face detected on synthetic video ─────────────────────────────────
  it('returns null for synthetic test video with no webcam overlay', async () => {
    const result = await detectWebcamRegion(videoPath)
    expect(result).toBeNull()
  })

  // ── 2. Pure function validation with real data ─────────────────────────────
  describe('isSkinTone', () => {
    it('detects typical skin-tone RGB values', () => {
      // Light skin tone
      expect(isSkinTone(200, 150, 120)).toBe(true)
      // Medium skin tone
      expect(isSkinTone(180, 120, 80)).toBe(true)
    })

    it('rejects non-skin-tone RGB values', () => {
      // Pure blue
      expect(isSkinTone(0, 0, 255)).toBe(false)
      // Pure green
      expect(isSkinTone(0, 255, 0)).toBe(false)
      // White
      expect(isSkinTone(255, 255, 255)).toBe(false)
      // Black
      expect(isSkinTone(0, 0, 0)).toBe(false)
    })
  })

  describe('calculateCornerConfidence', () => {
    it('returns 0 for empty scores', () => {
      expect(calculateCornerConfidence([])).toBe(0)
    })

    it('returns 0 when all scores are zero', () => {
      expect(calculateCornerConfidence([0, 0, 0, 0, 0])).toBe(0)
    })

    it('returns a value between 0 and 1 for mixed scores', () => {
      const confidence = calculateCornerConfidence([0.05, 0.1, 0, 0.08, 0])
      expect(confidence).toBeGreaterThan(0)
      expect(confidence).toBeLessThanOrEqual(1)
    })

    it('returns higher confidence for consistently high scores', () => {
      const low = calculateCornerConfidence([0.01, 0, 0.02, 0, 0])
      const high = calculateCornerConfidence([0.1, 0.12, 0.09, 0.11, 0.1])
      expect(high).toBeGreaterThan(low)
    })
  })

  // ── 3. Temp cleanup ────────────────────────────────────────────────────────
  it('cleans up face-detect-* temp directories after detection', async () => {
    const tmpBase = os.tmpdir()

    // Snapshot existing face-detect dirs before running
    const before = (await fs.readdir(tmpBase)).filter(d => d.startsWith('face-detect-'))

    await detectWebcamRegion(videoPath)

    const after = (await fs.readdir(tmpBase)).filter(d => d.startsWith('face-detect-'))

    // No new face-detect directories should remain
    expect(after.length).toBeLessThanOrEqual(before.length)
  })
})

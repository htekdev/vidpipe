/**
 * L4-L6 Integration Test — agent tool functions
 *
 * Mock boundary: L2 clients (FFmpeg binary resolution)
 * Real code:     L4 agentTools + L3 videoOperations + L1 file I/O
 *
 * Tests readTranscript and getChapters with real file I/O, and
 * getVideoInfo / captureFrame gated on FFmpeg availability.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'

// ── Mock L2 FFmpeg binary resolution ────────────────────────────────

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: vi.fn(() => 'ffmpeg'),
  getFFprobePath: vi.fn(() => 'ffprobe'),
  ffprobe: vi.fn(),
  createFFmpeg: vi.fn(),
  fluent: {},
}))

// ── Import after mocks ───────────────────────────────────────────────

import { readTranscript, getChapters, getVideoInfo } from '../../../L4-agents/agentTools.js'

// ── Helpers ──────────────────────────────────────────────────────────

async function isFFprobeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-version'], (err) => resolve(!err))
  })
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L4-L6 Integration: agentTools (mocked L2 FFmpeg)', () => {
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vidpipe-agenttools-'))
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ── readTranscript ──────────────────────────────────────────────────

  describe('readTranscript', () => {
    let transcriptPath: string

    beforeAll(async () => {
      transcriptPath = join(tmpDir, 'transcript.json')
      await writeFile(transcriptPath, JSON.stringify({
        text: 'Hello world how are you',
        words: [
          { word: 'Hello', start: 0, end: 1 },
          { word: ' world', start: 1, end: 2 },
          { word: ' how', start: 5, end: 6 },
          { word: ' are', start: 6, end: 7 },
          { word: ' you', start: 7, end: 8 },
        ],
      }))
    })

    it('returns full transcript when no time range specified', async () => {
      const result = await readTranscript(transcriptPath)

      expect(result.words).toHaveLength(5)
      expect(result.text).toContain('Hello')
      expect(result.text).toContain('you')
    })

    it('filters words by start time', async () => {
      const result = await readTranscript(transcriptPath, 4)

      expect(result.words).toHaveLength(3)
      expect(result.words[0].word).toBe(' how')
    })

    it('filters words by end time', async () => {
      const result = await readTranscript(transcriptPath, undefined, 3)

      expect(result.words).toHaveLength(2)
      expect(result.words[1].word).toBe(' world')
    })

    it('filters words by both start and end time', async () => {
      const result = await readTranscript(transcriptPath, 1, 7)

      // Words in range [1, 7]: ' world' (1-2), ' how' (5-6), ' are' (6-7)
      expect(result.words).toHaveLength(3)
      expect(result.words[0].word).toBe(' world')
      expect(result.words[2].word).toBe(' are')
    })
  })

  // ── getChapters ──────────────────────────────────────────────────────

  describe('getChapters', () => {
    it('reads chapters from JSON file', async () => {
      const chaptersPath = join(tmpDir, 'chapters.json')
      await writeFile(chaptersPath, JSON.stringify([
        { timestamp: 0, title: 'Introduction' },
        { timestamp: 120, title: 'Main Content' },
        { timestamp: 300, title: 'Conclusion' },
      ]))

      const result = await getChapters(chaptersPath)

      expect(result.chapters).toHaveLength(3)
      expect(result.chapters[0]).toEqual({ time: 0, title: 'Introduction' })
      expect(result.chapters[1]).toEqual({ time: 120, title: 'Main Content' })
      expect(result.chapters[2]).toEqual({ time: 300, title: 'Conclusion' })
    })

    it('handles empty chapters array', async () => {
      const emptyPath = join(tmpDir, 'empty-chapters.json')
      await writeFile(emptyPath, JSON.stringify([]))

      const result = await getChapters(emptyPath)

      expect(result.chapters).toHaveLength(0)
    })
  })

  // ── getVideoInfo (requires real FFprobe) ──────────────────────────

  describe('getVideoInfo', async () => {
    const ffprobeOk = await isFFprobeAvailable()

    it.skipIf(!ffprobeOk)('rejects with descriptive error for missing file', async () => {
      await expect(getVideoInfo('/nonexistent/video.mp4'))
        .rejects.toThrow(/Failed to get video info/)
    })
  })
})

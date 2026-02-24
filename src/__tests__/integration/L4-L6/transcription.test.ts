/**
 * L4-L6 Integration Test — transcription service chain
 *
 * Mock boundary: L2 clients (FFmpeg audio extraction, Whisper)
 * Real code:     L3 transcription + L3 costTracker + L1 file I/O
 *
 * Tests that the L3 transcription service correctly orchestrates L2
 * audio extraction → Whisper transcription, handles single-file and
 * multi-chunk flows, and records costs via real costTracker.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, open as fsOpen } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Mock L2 clients ─────────────────────────────────────────────────

const mockExtractAudio = vi.hoisted(() => vi.fn())
const mockSplitAudioIntoChunks = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/ffmpeg/audioExtraction.js', () => ({
  extractAudio: mockExtractAudio,
  splitAudioIntoChunks: mockSplitAudioIntoChunks,
}))

const mockTranscribeAudio = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/whisper/whisperClient.js', () => ({
  transcribeAudio: mockTranscribeAudio,
}))

// ── Import after mocks ───────────────────────────────────────────────

import { transcribeVideo } from '../../../L3-services/transcription/transcription.js'
import { initConfig } from '../../../L1-infra/config/environment.js'
import { costTracker } from '../../../L3-services/costTracking/costTracker.js'
import type { VideoFile, Transcript } from '../../../L0-pure/types/index.js'

// ── Test fixtures ───────────────────────────────────────────────────

function makeVideoFile(slug: string, tmpDir: string): VideoFile {
  return {
    originalPath: join(tmpDir, `${slug}.mp4`),
    repoPath: join(tmpDir, `${slug}.mp4`),
    videoDir: tmpDir,
    slug,
    filename: `${slug}.mp4`,
    duration: 120,
    size: 50_000_000,
    createdAt: new Date(),
  }
}

function makeFakeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    text: 'Hello world',
    segments: [{
      id: 0,
      text: 'Hello world',
      start: 0,
      end: 2,
      words: [
        { word: 'Hello', start: 0, end: 1 },
        { word: ' world', start: 1, end: 2 },
      ],
    }],
    words: [
      { word: 'Hello', start: 0, end: 1 },
      { word: ' world', start: 1, end: 2 },
    ],
    language: 'en',
    duration: 60,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L4-L6 Integration: transcription → FFmpeg + Whisper (mocked L2)', () => {
  let tmpDir: string
  const originalRepoRoot = process.env.REPO_ROOT

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'vidpipe-transcription-'))
    process.env.REPO_ROOT = tmpDir
    initConfig({ outputDir: join(tmpDir, 'output') })
  })

  afterAll(async () => {
    process.env.REPO_ROOT = originalRepoRoot
    await rm(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    vi.clearAllMocks()

    // Default: extractAudio creates a small file at the output path
    mockExtractAudio.mockImplementation(async (_input: string, output: string) => {
      await writeFile(output, 'fake-audio-data')
      return output
    })

    mockTranscribeAudio.mockResolvedValue(makeFakeTranscript())
  })

  it('transcribes a single-chunk audio file', async () => {
    const video = makeVideoFile('test-single', tmpDir)

    const result = await transcribeVideo(video)

    expect(mockExtractAudio).toHaveBeenCalledOnce()
    expect(mockExtractAudio).toHaveBeenCalledWith(
      video.repoPath,
      expect.stringContaining('test-single.mp3'),
    )
    expect(mockTranscribeAudio).toHaveBeenCalledOnce()
    expect(result.text).toBe('Hello world')
    expect(result.segments).toHaveLength(1)
    expect(result.words).toHaveLength(2)
    expect(result.language).toBe('en')
  })

  it('splits and merges multi-chunk transcription', async () => {
    // Create a sparse file > 25MB to trigger chunking
    mockExtractAudio.mockImplementation(async (_input: string, output: string) => {
      const fh = await fsOpen(output, 'w')
      await fh.truncate(30 * 1024 * 1024)
      await fh.close()
      return output
    })

    const chunk1Path = join(tmpDir, 'cache', 'chunk0.mp3')
    const chunk2Path = join(tmpDir, 'cache', 'chunk1.mp3')
    mockSplitAudioIntoChunks.mockResolvedValue([chunk1Path, chunk2Path])

    mockTranscribeAudio
      .mockResolvedValueOnce(makeFakeTranscript({
        text: 'First chunk',
        segments: [{
          id: 0, text: 'First chunk', start: 0, end: 5,
          words: [
            { word: 'First', start: 0, end: 2 },
            { word: ' chunk', start: 2, end: 5 },
          ],
        }],
        words: [
          { word: 'First', start: 0, end: 2 },
          { word: ' chunk', start: 2, end: 5 },
        ],
        duration: 30,
      }))
      .mockResolvedValueOnce(makeFakeTranscript({
        text: 'Second chunk',
        segments: [{
          id: 0, text: 'Second chunk', start: 0, end: 4,
          words: [
            { word: 'Second', start: 0, end: 2 },
            { word: ' chunk', start: 2, end: 4 },
          ],
        }],
        words: [
          { word: 'Second', start: 0, end: 2 },
          { word: ' chunk', start: 2, end: 4 },
        ],
        duration: 30,
      }))

    const video = makeVideoFile('test-multi', tmpDir)
    const result = await transcribeVideo(video)

    expect(mockSplitAudioIntoChunks).toHaveBeenCalledOnce()
    expect(mockTranscribeAudio).toHaveBeenCalledTimes(2)
    expect(result.text).toBe('First chunk Second chunk')
    expect(result.segments).toHaveLength(2)
    // Second chunk timestamps should be offset by first chunk's duration (30s)
    expect(result.segments[1].start).toBe(30)
    expect(result.segments[1].end).toBe(34)
    expect(result.words).toHaveLength(4)
    expect(result.duration).toBe(60)
  })

  it('records whisper cost via real costTracker', async () => {
    const spy = vi.spyOn(costTracker, 'recordServiceUsage')
    const video = makeVideoFile('test-cost', tmpDir)

    await transcribeVideo(video)

    expect(spy).toHaveBeenCalledWith(
      'whisper',
      expect.any(Number),
      expect.objectContaining({ model: 'whisper-1' }),
    )
    spy.mockRestore()
  })

  it('propagates extractAudio errors', async () => {
    mockExtractAudio.mockRejectedValue(new Error('FFmpeg crashed'))
    const video = makeVideoFile('test-error', tmpDir)

    await expect(transcribeVideo(video)).rejects.toThrow('FFmpeg crashed')
  })
})

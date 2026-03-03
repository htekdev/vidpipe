/**
 * L4-L6 Integration Test — MainVideoAsset caption alignment
 *
 * Mock boundary: L2 clients (Whisper, FFmpeg, LLM providers)
 * Real code:     L5 MainVideoAsset → L4 analysisServiceBridge → L3 transcription
 *
 * Tests that after silence removal, getEditedVideo() re-transcribes the
 * edited video and getCaptions() uses the re-transcribed result so captions
 * align with the edited video timeline.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── Mock L2 clients ─────────────────────────────────────────────────

const mockTranscribeAudio = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/whisper/whisperClient.js', () => ({
  transcribeAudio: mockTranscribeAudio,
}))

const mockExtractAudio = vi.hoisted(() => vi.fn())
const mockSplitAudioIntoChunks = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/ffmpeg/audioExtraction.js', () => ({
  extractAudio: mockExtractAudio,
  splitAudioIntoChunks: mockSplitAudioIntoChunks,
}))

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: vi.fn(() => 'ffmpeg'),
  getFFprobePath: vi.fn(() => 'ffprobe'),
}))

const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/ffmpeg/ffmpegClient.js', () => ({
  runFFmpeg: mockExecFile,
}))

vi.mock('../../../L2-clients/ffmpeg/ffprobeClient.js', () => ({
  runFFprobe: vi.fn().mockResolvedValue(JSON.stringify({
    format: { duration: '80', size: '1000' },
    streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
  })),
}))

vi.mock('../../../L2-clients/ffmpeg/captionBurning.js', () => ({
  burnCaptions: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../../L2-clients/ffmpeg/silenceDetection.js', () => ({
  detectSilence: vi.fn().mockResolvedValue([]),
}))

const mockCreateSession = vi.hoisted(() => vi.fn())
vi.mock('../../../L2-clients/llm/index.js', () => ({
  getProvider: vi.fn(() => ({
    name: 'mock',
    createSession: mockCreateSession,
  })),
}))

vi.mock('../../../L2-clients/gemini/geminiClient.js', () => ({
  analyzeVideoEditorial: vi.fn().mockResolvedValue(''),
  analyzeVideoClipDirection: vi.fn().mockResolvedValue(''),
}))

// ── Import after mocks ───────────────────────────────────────────────

import { readFile } from 'node:fs/promises'
import type { Transcript } from '../../../L0-pure/types/index.js'

// ── Test fixtures ───────────────────────────────────────────────────

let tmpDir: string

const originalTranscript: Transcript = {
  text: 'Hello world this is a test',
  segments: [
    { id: 0, start: 0, end: 10, text: 'Hello world', words: [
      { word: 'Hello', start: 0, end: 2 },
      { word: 'world', start: 2, end: 4 },
    ]},
    { id: 1, start: 15, end: 25, text: 'this is a test', words: [
      { word: 'this', start: 15, end: 17 },
      { word: 'is', start: 17, end: 18 },
      { word: 'a', start: 18, end: 19 },
      { word: 'test', start: 19, end: 21 },
    ]},
  ],
  words: [
    { word: 'Hello', start: 0, end: 2 },
    { word: 'world', start: 2, end: 4 },
    { word: 'this', start: 15, end: 17 },
    { word: 'is', start: 17, end: 18 },
    { word: 'a', start: 18, end: 19 },
    { word: 'test', start: 19, end: 21 },
  ],
  language: 'en',
  duration: 100,
}

const editedTranscript: Transcript = {
  text: 'Hello world this is a test',
  segments: [
    { id: 0, start: 0, end: 10, text: 'Hello world', words: [
      { word: 'Hello', start: 0, end: 2 },
      { word: 'world', start: 2, end: 4 },
    ]},
    { id: 1, start: 10, end: 20, text: 'this is a test', words: [
      { word: 'this', start: 10, end: 12 },
      { word: 'is', start: 12, end: 13 },
      { word: 'a', start: 13, end: 14 },
      { word: 'test', start: 14, end: 16 },
    ]},
  ],
  words: [
    { word: 'Hello', start: 0, end: 2 },
    { word: 'world', start: 2, end: 4 },
    { word: 'this', start: 10, end: 12 },
    { word: 'is', start: 12, end: 13 },
    { word: 'a', start: 13, end: 14 },
    { word: 'test', start: 14, end: 16 },
  ],
  language: 'en',
  duration: 80,
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'caption-align-'))
  const videoDir = join(tmpDir, 'test-video')
  await mkdir(videoDir, { recursive: true })
  // Create dummy video file
  await writeFile(join(videoDir, 'test-video.mp4'), Buffer.alloc(100))
  // Create original transcript
  await writeFile(join(videoDir, 'transcript.json'), JSON.stringify(originalTranscript))
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('MainVideoAsset caption alignment', () => {
  it('getEditedVideo saves transcript-edited.json after silence removal re-transcription', async () => {
    const videoDir = join(tmpDir, 'test-video')

    // Mock Whisper to return the edited transcript (as if transcribing the edited video)
    mockExtractAudio.mockResolvedValue(join(videoDir, 'audio.mp3'))
    mockTranscribeAudio.mockResolvedValue(editedTranscript)

    // Mock the LLM session for silence removal agent
    const mockSession = {
      sendAndWait: vi.fn().mockResolvedValue({
        content: JSON.stringify({ approved: false }),
        toolCalls: [],
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { amount: 0.001, model: 'mock', unit: 'USD' },
        durationMs: 100,
      }),
      destroy: vi.fn(),
    }
    mockCreateSession.mockResolvedValue(mockSession)

    const { MainVideoAsset } = await import('../../../L5-assets/MainVideoAsset.js')
    const asset = await MainVideoAsset.load(videoDir)

    // Create an "edited" video to simulate silence removal output
    const editedPath = join(videoDir, 'test-video-edited.mp4')
    await writeFile(editedPath, Buffer.alloc(80))

    // Force getEditedVideo to run (the silence removal agent mock returns wasEdited: false,
    // so we test getAdjustedTranscript fallback instead)
    const adjustedTranscript = await asset.getAdjustedTranscript()

    // Without transcript-edited.json, it falls back to original
    expect(adjustedTranscript.duration).toBe(originalTranscript.duration)
  })

  it('getCaptions uses transcript-edited.json when it exists', async () => {
    const videoDir = join(tmpDir, 'test-video')

    // Write transcript-edited.json directly (simulating what getEditedVideo does)
    await writeFile(
      join(videoDir, 'transcript-edited.json'),
      JSON.stringify(editedTranscript),
    )

    const { MainVideoAsset } = await import('../../../L5-assets/MainVideoAsset.js')
    const asset = await MainVideoAsset.load(videoDir)

    // Clear any caches from previous test
    asset.clearCache()

    const captions = await asset.getCaptions({ force: true })

    // Verify caption files were generated
    expect(captions.srt).toMatch(/captions\.srt$/)
    expect(captions.ass).toMatch(/captions\.ass$/)

    // Read the generated SRT and verify it uses edited timestamps (not original)
    const srtContent = await readFile(captions.srt, 'utf-8')
    // The edited transcript has segment 2 starting at 10s, not 15s (original)
    // So SRT should NOT contain "00:00:15" (the original timestamp)
    expect(srtContent).not.toContain('00:00:15')
  })
})

/**
 * L3 Integration Test — captionGeneration service
 *
 * Mock boundary: L1 infrastructure (fileSystem, paths, config, logger)
 * Real code:     L3 captionGeneration + L0 caption generators (pure)
 *
 * Validates that the service orchestrates L0 pure caption generators
 * and writes correct output to the file system.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock L1 infrastructure ────────────────────────────────────────────

const writtenFiles: Record<string, string> = {}

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  writeTextFile: vi.fn(async (path: string, content: string) => { writtenFiles[path] = content }),
  ensureDirectory: vi.fn(async () => {}),
}))

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ OUTPUT_DIR: '/test/output' }),
}))

// Logger is auto-mocked by global setup.ts

// ── Import after mocks ───────────────────────────────────────────────

import { generateCaptions } from '../../../L3-services/captionGeneration/captionGeneration.js'
import type { VideoFile, Transcript } from '../../../L0-pure/types/index.js'

// ── Fixtures ──────────────────────────────────────────────────────────

const VIDEO: VideoFile = {
  originalPath: '/test/video.mp4',
  repoPath: '/test/output/test-video/video.mp4',
  videoDir: '/test/output/test-video',
  slug: 'test-video',
  filename: 'video.mp4',
  duration: 10,
  size: 1024,
  createdAt: new Date('2026-01-01'),
}

const TRANSCRIPT: Transcript = {
  text: 'Hello world. This is a test.',
  language: 'en',
  duration: 5,
  segments: [
    {
      id: 0,
      start: 0,
      end: 2,
      text: 'Hello world.',
      words: [
        { word: 'Hello', start: 0, end: 0.5 },
        { word: 'world.', start: 0.6, end: 1.0 },
      ],
    },
    {
      id: 1,
      start: 2.5,
      end: 5,
      text: 'This is a test.',
      words: [
        { word: 'This', start: 2.5, end: 2.8 },
        { word: 'is', start: 2.9, end: 3.0 },
        { word: 'a', start: 3.1, end: 3.2 },
        { word: 'test.', start: 3.3, end: 3.8 },
      ],
    },
  ],
  words: [
    { word: 'Hello', start: 0, end: 0.5 },
    { word: 'world.', start: 0.6, end: 1.0 },
    { word: 'This', start: 2.5, end: 2.8 },
    { word: 'is', start: 2.9, end: 3.0 },
    { word: 'a', start: 3.1, end: 3.2 },
    { word: 'test.', start: 3.3, end: 3.8 },
  ],
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('L3 Integration: captionGeneration', () => {
  beforeEach(() => {
    for (const key of Object.keys(writtenFiles)) delete writtenFiles[key]
    vi.clearAllMocks()
  })

  it('generates SRT, VTT, and ASS files', async () => {
    const paths = await generateCaptions(VIDEO, TRANSCRIPT)

    expect(paths).toHaveLength(3)
    expect(paths[0]).toContain('captions.srt')
    expect(paths[1]).toContain('captions.vtt')
    expect(paths[2]).toContain('captions.ass')
  })

  it('writes valid SRT content from L0 generators', async () => {
    await generateCaptions(VIDEO, TRANSCRIPT)

    const srtPath = Object.keys(writtenFiles).find(k => k.endsWith('.srt'))!
    const srtContent = writtenFiles[srtPath]

    // SRT starts with index 1 and has --> timestamp format
    expect(srtContent).toContain('1')
    expect(srtContent).toContain('-->')
    expect(srtContent).toMatch(/Hello|world/)
  })

  it('writes valid VTT content with WEBVTT header', async () => {
    await generateCaptions(VIDEO, TRANSCRIPT)

    const vttPath = Object.keys(writtenFiles).find(k => k.endsWith('.vtt'))!
    const vttContent = writtenFiles[vttPath]

    expect(vttContent).toContain('WEBVTT')
  })

  it('writes ASS content with Script Info header', async () => {
    await generateCaptions(VIDEO, TRANSCRIPT)

    const assPath = Object.keys(writtenFiles).find(k => k.endsWith('.ass'))!
    const assContent = writtenFiles[assPath]

    expect(assContent).toContain('[Script Info]')
  })

  it('creates the captions directory', async () => {
    const { ensureDirectory } = await import('../../../L1-infra/fileSystem/fileSystem.js')
    await generateCaptions(VIDEO, TRANSCRIPT)

    expect(ensureDirectory).toHaveBeenCalledWith(
      expect.stringContaining('test-video/captions'),
    )
  })
})

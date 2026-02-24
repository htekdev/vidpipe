import { describe, it, expect, vi, beforeEach } from 'vitest'

// L2 tests: only mock external packages and Node.js builtins

// ── Mock node:fs for filesystem operations ──────────────────────────────────
const mockMkdir = vi.hoisted(() => vi.fn())
const mockStat = vi.hoisted(() => vi.fn())
const mockExistsSync = vi.hoisted(() => vi.fn())

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    existsSync: mockExistsSync,
    promises: {
      ...original.promises,
      mkdir: mockMkdir,
      stat: mockStat,
    },
  }
})

// ── Mock fluent-ffmpeg (external package) ───────────────────────────────────
const mockFfprobe = vi.hoisted(() => vi.fn())
const mockFfmpegFactory = vi.hoisted(() => vi.fn())

vi.mock('fluent-ffmpeg', () => {
  const lib: any = (...args: unknown[]) => mockFfmpegFactory(...args)
  lib.ffprobe = mockFfprobe
  lib.setFfmpegPath = vi.fn()
  lib.setFfprobePath = vi.fn()
  return { default: lib }
})

import { extractAudio, splitAudioIntoChunks } from '../../../L2-clients/ffmpeg/audioExtraction.js'

// ── Helpers ─────────────────────────────────────────────────────────────────

function createChainableCmd(autoEnd = true) {
  const handlers: Record<string, Function> = {}
  const cmd: Record<string, any> = {}

  const chainMethods = [
    'noVideo', 'audioChannels', 'audioCodec', 'audioBitrate', 'audioFrequency',
    'output', 'setFfmpegPath', 'setFfprobePath', 'setStartTime', 'setDuration',
  ]
  for (const m of chainMethods) {
    cmd[m] = vi.fn(() => cmd)
  }

  cmd.on = vi.fn((event: string, handler: Function) => {
    handlers[event] = handler
    return cmd
  })

  cmd.run = vi.fn(() => {
    if (autoEnd && handlers['end']) handlers['end']()
  })

  cmd._triggerError = (err: Error) => handlers['error']?.(err)

  return cmd
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockMkdir.mockReset().mockResolvedValue(undefined)
  mockStat.mockReset()
  mockExistsSync.mockReset().mockReturnValue(false)
  mockFfmpegFactory.mockReset()
  mockFfprobe.mockReset()
})

describe('extractAudio', () => {
  it('configures mp3 codec with correct settings', async () => {
    const cmd = createChainableCmd()
    mockFfmpegFactory.mockReturnValue(cmd)

    await extractAudio('/video.mp4', '/output/audio.mp3')

    expect(cmd.noVideo).toHaveBeenCalled()
    expect(cmd.audioChannels).toHaveBeenCalledWith(1)
    expect(cmd.audioCodec).toHaveBeenCalledWith('libmp3lame')
    expect(cmd.audioBitrate).toHaveBeenCalledWith('64k')
    expect(cmd.audioFrequency).toHaveBeenCalledWith(16000)
  })

  it('configures wav codec when specified', async () => {
    const cmd = createChainableCmd()
    mockFfmpegFactory.mockReturnValue(cmd)

    await extractAudio('/video.mp4', '/output/audio.wav', { format: 'wav' })

    expect(cmd.audioCodec).toHaveBeenCalledWith('pcm_s16le')
    expect(cmd.audioFrequency).toHaveBeenCalledWith(16000)
    expect(cmd.audioBitrate).not.toHaveBeenCalled()
  })

  it('resolves with output path on success', async () => {
    const cmd = createChainableCmd()
    mockFfmpegFactory.mockReturnValue(cmd)

    const result = await extractAudio('/video.mp4', '/output/audio.mp3')

    expect(result).toBe('/output/audio.mp3')
  })

  it('rejects on ffmpeg error', async () => {
    const cmd = createChainableCmd(false)
    cmd.run.mockImplementation(() => {
      cmd._triggerError(new Error('encoding failed'))
    })
    mockFfmpegFactory.mockReturnValue(cmd)

    await expect(extractAudio('/video.mp4', '/output/audio.mp3'))
      .rejects.toThrow('Audio extraction failed: encoding failed')
  })

  it('ensures output directory exists', async () => {
    const cmd = createChainableCmd()
    mockFfmpegFactory.mockReturnValue(cmd)

    await extractAudio('/video.mp4', '/output/dir/audio.mp3')

    expect(mockMkdir).toHaveBeenCalled()
  })

  it('sets output path on the command', async () => {
    const cmd = createChainableCmd()
    mockFfmpegFactory.mockReturnValue(cmd)

    await extractAudio('/video.mp4', '/output/audio.mp3')

    expect(cmd.output).toHaveBeenCalledWith('/output/audio.mp3')
  })
})

describe('splitAudioIntoChunks', () => {
  it('returns single path for small files', async () => {
    mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 }) // 10MB

    const result = await splitAudioIntoChunks('/audio.mp3')

    expect(result).toEqual(['/audio.mp3'])
  })

  it('returns single path when file equals max size', async () => {
    mockStat.mockResolvedValue({ size: 24 * 1024 * 1024 }) // exactly 24MB

    const result = await splitAudioIntoChunks('/audio.mp3')

    expect(result).toEqual(['/audio.mp3'])
  })

  it('splits large files into correct number of chunks', async () => {
    mockStat.mockResolvedValue({ size: 50 * 1024 * 1024 }) // 50MB

    mockFfprobe.mockImplementation((_path: string, cb: Function) => {
      cb(null, { format: { duration: 600 } })
    })

    mockFfmpegFactory.mockImplementation(() => createChainableCmd())

    const result = await splitAudioIntoChunks('/audio.mp3')

    // 50MB / 24MB = ceil(2.08) = 3 chunks
    expect(result).toHaveLength(3)
    expect(result[0]).toContain('_chunk0')
    expect(result[1]).toContain('_chunk1')
    expect(result[2]).toContain('_chunk2')
  })

  it('uses custom max chunk size', async () => {
    mockStat.mockResolvedValue({ size: 50 * 1024 * 1024 }) // 50MB

    mockFfprobe.mockImplementation((_path: string, cb: Function) => {
      cb(null, { format: { duration: 600 } })
    })

    mockFfmpegFactory.mockImplementation(() => createChainableCmd())

    const result = await splitAudioIntoChunks('/audio.mp3', 10) // 10MB chunks

    // 50MB / 10MB = 5 chunks
    expect(result).toHaveLength(5)
  })

  it('preserves file extension in chunk names', async () => {
    mockStat.mockResolvedValue({ size: 50 * 1024 * 1024 })

    mockFfprobe.mockImplementation((_path: string, cb: Function) => {
      cb(null, { format: { duration: 600 } })
    })

    mockFfmpegFactory.mockImplementation(() => createChainableCmd())

    const result = await splitAudioIntoChunks('/path/audio.mp3')

    for (const path of result) {
      expect(path).toMatch(/\.mp3$/)
    }
  })
})

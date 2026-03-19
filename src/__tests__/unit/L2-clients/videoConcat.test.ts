import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockExecCommand,
  mockEnsureDirectory,
  mockWriteTextFile,
  mockFileExists,
} = vi.hoisted(() => ({
  mockExecCommand: vi.fn(),
  mockEnsureDirectory: vi.fn(),
  mockWriteTextFile: vi.fn(),
  mockFileExists: vi.fn(),
}))

vi.mock('../../../../src/L1-infra/process/process.js', () => ({
  execCommand: mockExecCommand,
}))

vi.mock('../../../../src/L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: mockEnsureDirectory,
  writeTextFile: mockWriteTextFile,
  fileExists: mockFileExists,
}))

vi.mock('../../../../src/L1-infra/paths/paths.js', () => ({
  dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '.',
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('../../../../src/L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: () => 'ffmpeg',
  createFFmpeg: vi.fn(),
}))

vi.mock('../../../../src/L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import { concatVideos, normalizeForConcat } from '../../../../src/L2-clients/ffmpeg/videoConcat.js'

describe('videoConcat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureDirectory.mockResolvedValue(undefined)
    mockWriteTextFile.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ stdout: '', stderr: '' })
  })

  describe('REQ-001: concatVideos with 0 segments throws error', () => {
    it('videoConcat.REQ-001 - throws when no segments are provided', async () => {
      await expect(concatVideos([], '/out/result.mp4')).rejects.toThrow(
        'concatVideos: no segments provided',
      )
      expect(mockExecCommand).not.toHaveBeenCalled()
    })
  })

  describe('REQ-002: concatVideos with 1 segment copies the file', () => {
    it('videoConcat.REQ-002 - single segment uses copy codec', async () => {
      await concatVideos(['/tmp/a.mp4'], '/out/result.mp4')

      expect(mockEnsureDirectory).toHaveBeenCalledWith('/out')
      expect(mockExecCommand).toHaveBeenCalledOnce()

      const [cmd, args] = mockExecCommand.mock.calls[0]
      expect(cmd).toBe('ffmpeg')
      expect(args).toEqual([
        '-y', '-i', '/tmp/a.mp4', '-c', 'copy', '/out/result.mp4',
      ])
    })

    it('videoConcat.REQ-002 - single segment returns the output path', async () => {
      const result = await concatVideos(['/tmp/a.mp4'], '/out/result.mp4')
      expect(result).toBe('/out/result.mp4')
    })
  })

  describe('REQ-003: concatVideos with fadeDuration=0 uses concat demuxer', () => {
    it('videoConcat.REQ-003 - uses -f concat and -safe 0 args', async () => {
      await concatVideos(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/result.mp4', {
        fadeDuration: 0,
      })

      expect(mockWriteTextFile).toHaveBeenCalledOnce()
      const [listPath, listContent] = mockWriteTextFile.mock.calls[0]
      expect(listPath).toBe('/out/result.mp4.concat-list.txt')
      expect(listContent).toContain("file '/tmp/a.mp4'")
      expect(listContent).toContain("file '/tmp/b.mp4'")

      expect(mockExecCommand).toHaveBeenCalledOnce()
      const [cmd, args] = mockExecCommand.mock.calls[0]
      expect(cmd).toBe('ffmpeg')
      expect(args).toContain('-f')
      expect(args).toContain('concat')
      expect(args).toContain('-safe')
      expect(args).toContain('0')
      expect(args).toContain('-c')
      expect(args).toContain('copy')
    })

    it('videoConcat.REQ-003 - default fadeDuration also uses concat demuxer', async () => {
      await concatVideos(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/result.mp4')

      const [, args] = mockExecCommand.mock.calls[0]
      expect(args).toContain('-f')
      expect(args).toContain('concat')
    })

    it('videoConcat.REQ-003 - returns output path', async () => {
      const result = await concatVideos(
        ['/tmp/a.mp4', '/tmp/b.mp4'],
        '/out/result.mp4',
        { fadeDuration: 0 },
      )
      expect(result).toBe('/out/result.mp4')
    })
  })

  describe('REQ-004: concatVideos with fadeDuration>0 uses xfade', () => {
    beforeEach(() => {
      // getVideoDuration uses ffprobe — mock execCommand to return durations
      mockExecCommand.mockImplementation(async (cmd: string, args: string[]) => {
        // ffprobe calls for duration
        if (String(cmd).includes('ffprobe') || (args && args.includes('-show_entries'))) {
          return { stdout: '10.0\n', stderr: '' }
        }
        // ffmpeg concat call
        return { stdout: '', stderr: '' }
      })
    })

    it('videoConcat.REQ-004 - uses -filter_complex with xfade', async () => {
      await concatVideos(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/result.mp4', {
        fadeDuration: 1,
      })

      // Should have duration probes + the final concat call
      const concatCall = (mockExecCommand.mock.calls as [string, string[]][]).find(
        ([, args]) => args.includes('-filter_complex'),
      )
      expect(concatCall).toBeDefined()

      const [cmd, args] = concatCall!
      expect(cmd).toBe('ffmpeg')
      expect(args).toContain('-filter_complex')

      const filterIdx = args.indexOf('-filter_complex')
      const filterValue = args[filterIdx + 1] as string
      expect(filterValue).toContain('xfade')
      expect(filterValue).toContain('transition=fade')
      expect(filterValue).toContain('duration=1')
    })

    it('videoConcat.REQ-004 - maps [vout] and [aout] streams', async () => {
      await concatVideos(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/result.mp4', {
        fadeDuration: 0.5,
      })

      const concatCall = (mockExecCommand.mock.calls as [string, string[]][]).find(
        ([, args]) => args.includes('-filter_complex'),
      )
      expect(concatCall).toBeDefined()
      const args = concatCall![1] as string[]
      expect(args).toContain('-map')
      expect(args).toContain('[vout]')
      expect(args).toContain('[aout]')
    })

    it('videoConcat.REQ-004 - includes all input files', async () => {
      await concatVideos(
        ['/tmp/a.mp4', '/tmp/b.mp4', '/tmp/c.mp4'],
        '/out/result.mp4',
        { fadeDuration: 1 },
      )

      const concatCall = (mockExecCommand.mock.calls as [string, string[]][]).find(
        ([, args]) => args.includes('-filter_complex'),
      )
      expect(concatCall).toBeDefined()
      const args = concatCall![1] as string[]
      expect(args).toContain('-i')
      // All three inputs must appear
      expect(args.filter((a: string) => a === '-i')).toHaveLength(3)
    })

    it('videoConcat.REQ-004 - does NOT write a concat list file', async () => {
      await concatVideos(['/tmp/a.mp4', '/tmp/b.mp4'], '/out/result.mp4', {
        fadeDuration: 1,
      })
      expect(mockWriteTextFile).not.toHaveBeenCalled()
    })
  })

  describe('REQ-005: normalizeForConcat matches reference video properties', () => {
    it('videoConcat.REQ-005 - probes reference video and applies scale/fps', async () => {
      // First call is getVideoProperties (ffprobe, returns JSON)
      mockExecCommand.mockImplementation(async (cmd: string, args: string[]) => {
        if (args && args.includes('-of') && args.includes('json')) {
          return {
            stdout: JSON.stringify({
              streams: [{ width: 1920, height: 1080, r_frame_rate: '30/1' }],
            }),
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      })

      const result = await normalizeForConcat(
        '/tmp/intro.mp4',
        '/tmp/content.mp4',
        '/out/intro-normalized.mp4',
      )

      expect(result).toBe('/out/intro-normalized.mp4')
      expect(mockEnsureDirectory).toHaveBeenCalledWith('/out')

      // Find the ffmpeg encode call (not the ffprobe call)
      const encodeCall = (mockExecCommand.mock.calls as [string, string[]][]).find(
        ([, args]) => args.includes('-vf'),
      )
      expect(encodeCall).toBeDefined()
      const args = encodeCall![1] as string[]

      // Verify input is the video being normalized
      const inputIdx = args.indexOf('-i')
      expect(args[inputIdx + 1]).toBe('/tmp/intro.mp4')

      // Verify scale filter references reference video dimensions
      const vfIdx = args.indexOf('-vf')
      const vfValue = args[vfIdx + 1] as string
      expect(vfValue).toContain('scale=1920:1080')
      expect(vfValue).toContain('fps=30')
    })

    it('videoConcat.REQ-005 - encodes with libx264 and aac', async () => {
      mockExecCommand.mockImplementation(async (_cmd: string, args: string[]) => {
        if (args && args.includes('-of') && args.includes('json')) {
          return {
            stdout: JSON.stringify({
              streams: [{ width: 1280, height: 720, r_frame_rate: '24/1' }],
            }),
            stderr: '',
          }
        }
        return { stdout: '', stderr: '' }
      })

      await normalizeForConcat('/tmp/outro.mp4', '/tmp/content.mp4', '/out/outro-norm.mp4')

      const encodeCall = (mockExecCommand.mock.calls as [string, string[]][]).find(
        ([, args]) => args.includes('-c:v'),
      )
      expect(encodeCall).toBeDefined()
      const args = encodeCall![1] as string[]
      expect(args).toContain('libx264')
      expect(args).toContain('-c:a')
      expect(args).toContain('aac')
      expect(args).toContain('-movflags')
      expect(args).toContain('+faststart')
    })
  })
})

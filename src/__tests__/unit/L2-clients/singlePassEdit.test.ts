import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExecFile, mockMkdtemp, mockCopyFile, mockReaddir, mockUnlink, mockRmdir } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockMkdtemp: vi.fn(),
  mockCopyFile: vi.fn(),
  mockReaddir: vi.fn(),
  mockUnlink: vi.fn(),
  mockRmdir: vi.fn(),
}));

vi.mock('../../../L1-infra/process/process.js', () => ({
  execFileRaw: mockExecFile,
}));

vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  makeTempDir: mockMkdtemp,
  copyFile: mockCopyFile,
  listDirectory: mockReaddir,
  removeFile: mockUnlink,
  removeDirectory: mockRmdir,
}));

vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: (...args: string[]) => args.join('/'),
  fontsDir: () => '/fonts',
}));

vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js', () => ({
  getFFmpegPath: () => 'ffmpeg',
}));

vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { buildFilterComplex, singlePassEdit, singlePassEditAndCaption, KeepSegment } from '../../../L2-clients/ffmpeg/singlePassEdit.js'

describe('buildFilterComplex', () => {
  describe('basic filter generation', () => {
    it('produces correct trim+setpts+concat for 2 segments', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 5.5 },
        { start: 8.2, end: 12.0 },
      ]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      // 2 segments × 2 (video + audio) + 1 concat = 5 filter parts
      expect(lines).toHaveLength(5)

      // Video trim for segment 0
      expect(lines[0]).toBe('[0:v]trim=start=0.000:end=5.500,setpts=PTS-STARTPTS[v0]')
      // Audio trim for segment 0
      expect(lines[1]).toBe('[0:a]atrim=start=0.000:end=5.500,asetpts=PTS-STARTPTS[a0]')
      // Video trim for segment 1
      expect(lines[2]).toBe('[0:v]trim=start=8.200:end=12.000,setpts=PTS-STARTPTS[v1]')
      // Audio trim for segment 1
      expect(lines[3]).toBe('[0:a]atrim=start=8.200:end=12.000,asetpts=PTS-STARTPTS[a1]')
      // Concat
      expect(lines[4]).toBe('[v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]')
    })

    it('formats timestamps to 3 decimal places', () => {
      const segments: KeepSegment[] = [{ start: 1.1, end: 2.22 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=1.100')
      expect(result).toContain('end=2.220')
    })

    it('each segment has paired video and audio trim filters', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 3 },
        { start: 5, end: 10 },
        { start: 15, end: 20 },
      ]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      for (let i = 0; i < segments.length; i++) {
        const videoLine = lines[i * 2]
        const audioLine = lines[i * 2 + 1]

        expect(videoLine).toContain(`[0:v]trim=start=${segments[i].start.toFixed(3)}:end=${segments[i].end.toFixed(3)}`)
        expect(videoLine).toContain(`setpts=PTS-STARTPTS[v${i}]`)
        expect(audioLine).toContain(`[0:a]atrim=start=${segments[i].start.toFixed(3)}:end=${segments[i].end.toFixed(3)}`)
        expect(audioLine).toContain(`asetpts=PTS-STARTPTS[a${i}]`)
      }
    })

    it('concat n= matches segment count', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
        { start: 6, end: 7 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('concat=n=4:v=1:a=1')
    })

    it('concat inputs list all segment pairs in order', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 1 },
        { start: 2, end: 3 },
        { start: 4, end: 5 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('[v0][a0][v1][a1][v2][a2]concat=n=3')
    })
  })

  describe('with captions', () => {
    it('appends ASS subtitle filter after concat', () => {
      const segments: KeepSegment[] = [
        { start: 0, end: 5 },
        { start: 8, end: 12 },
      ]
      const result = buildFilterComplex(segments, { assFilename: 'captions.ass' })
      const lines = result.split(';\n')

      // Last line should be the ASS filter
      expect(lines[lines.length - 1]).toContain('ass=captions.ass')
      expect(lines[lines.length - 1]).toContain('[outv]')
    })

    it('uses intermediate labels [cv][ca] for concat when captions enabled', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, { assFilename: 'subs.ass' })

      expect(result).toContain('concat=n=1:v=1:a=1[cv][ca]')
      expect(result).not.toContain('[outv][outa]')
    })

    it('sets fontsdir parameter correctly', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, {
        assFilename: 'captions.ass',
        fontsdir: '/tmp/fonts',
      })

      expect(result).toContain('fontsdir=/tmp/fonts')
    })

    it('defaults fontsdir to "." when not specified', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments, { assFilename: 'captions.ass' })

      expect(result).toContain('fontsdir=.')
    })

    it('without captions uses [outv][outa] labels directly', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 5 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('[outv][outa]')
      expect(result).not.toContain('[cv]')
      expect(result).not.toContain('[ca]')
      expect(result).not.toContain('ass=')
    })
  })

  describe('edge cases', () => {
    it('single segment produces valid filter', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 60 }]
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      expect(lines).toHaveLength(3) // video trim, audio trim, concat
      expect(result).toContain('concat=n=1:v=1:a=1[outv][outa]')
      expect(result).toContain('[v0][a0]')
    })

    it('handles 10+ segments correctly', () => {
      const segments: KeepSegment[] = Array.from({ length: 12 }, (_, i) => ({
        start: i * 10,
        end: i * 10 + 8,
      }))
      const result = buildFilterComplex(segments)
      const lines = result.split(';\n')

      // 12 segments × 2 + 1 concat = 25 lines
      expect(lines).toHaveLength(25)
      expect(result).toContain('concat=n=12:v=1:a=1')
      // Check double-digit indices
      expect(result).toContain('[v10]')
      expect(result).toContain('[a11]')
    })

    it('handles very short segments without negative durations', () => {
      const segments: KeepSegment[] = [
        { start: 5.001, end: 5.002 },
      ]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=5.001:end=5.002')
      // No negative values in the output
      expect(result).not.toMatch(/-\d+\.\d+/)
    })

    it('handles segments starting at 0', () => {
      const segments: KeepSegment[] = [{ start: 0, end: 1 }]
      const result = buildFilterComplex(segments)

      expect(result).toContain('start=0.000:end=1.000')
    })

    it('handles high-precision floating point timestamps', () => {
      const segments: KeepSegment[] = [{ start: 1.23456789, end: 9.87654321 }]
      const result = buildFilterComplex(segments)

      // toFixed(3) rounds correctly
      expect(result).toContain('start=1.235')
      expect(result).toContain('end=9.877')
    })
  })

  describe('input validation', () => {
    it('throws on empty segments array', () => {
      expect(() => buildFilterComplex([])).toThrow('keepSegments must not be empty')
    })
  })
})

describe('singlePassEdit', () => {
  const segments: KeepSegment[] = [
    { start: 0, end: 5 },
    { start: 10, end: 15 },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(null, '', '')
    })
  })

  it('calls execFile with correct input and output paths', async () => {
    await singlePassEdit('/input.mp4', segments, '/output.mp4')

    expect(mockExecFile).toHaveBeenCalledOnce()
    const [cmd, args] = mockExecFile.mock.calls[0]
    expect(cmd).toMatch(/ffmpeg/)
    expect(args).toContain('/input.mp4')
    expect(args[args.length - 1]).toBe('/output.mp4')
  })

  it('includes -filter_complex matching buildFilterComplex output', async () => {
    await singlePassEdit('/input.mp4', segments, '/output.mp4')

    const args: string[] = mockExecFile.mock.calls[0][1]
    const fcIdx = args.indexOf('-filter_complex')
    expect(fcIdx).toBeGreaterThan(-1)
    expect(args[fcIdx + 1]).toBe(buildFilterComplex(segments))
  })

  it('uses -preset ultrafast and -threads 4', async () => {
    await singlePassEdit('/input.mp4', segments, '/output.mp4')

    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('-preset')
    expect(args[args.indexOf('-preset') + 1]).toBe('ultrafast')
    expect(args).toContain('-threads')
    expect(args[args.indexOf('-threads') + 1]).toBe('4')
  })

  it('maps [outv] and [outa]', async () => {
    await singlePassEdit('/input.mp4', segments, '/output.mp4')

    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('[outv]')
    expect(args).toContain('[outa]')
  })

  it('returns output path on success', async () => {
    const result = await singlePassEdit('/input.mp4', segments, '/output.mp4')
    expect(result).toBe('/output.mp4')
  })

  it('rejects with error on FFmpeg failure', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('ffmpeg crash'), '', 'some stderr')
    })

    await expect(singlePassEdit('/input.mp4', segments, '/output.mp4'))
      .rejects.toThrow('Single-pass edit failed: ffmpeg crash')
  })

  it('passes maxBuffer option to execFile', async () => {
    await singlePassEdit('/input.mp4', segments, '/output.mp4')

    const opts = mockExecFile.mock.calls[0][2]
    expect(opts.maxBuffer).toBe(50 * 1024 * 1024)
  })
})

describe('singlePassEditAndCaption', () => {
  const segments: KeepSegment[] = [
    { start: 0, end: 5 },
    { start: 10, end: 15 },
  ]
  const tempDir = '/tmp/caption-abc123'

  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdtemp.mockResolvedValue(tempDir)
    mockCopyFile.mockResolvedValue(undefined)
    mockReaddir.mockResolvedValue(['Montserrat-Bold.ttf', 'readme.txt'])
    mockUnlink.mockResolvedValue(undefined)
    mockRmdir.mockResolvedValue(undefined)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      mockReaddir.mockResolvedValueOnce(['captions.ass', 'Montserrat-Bold.ttf'])
      cb(null, '', '')
    })
  })

  it('creates a temp directory via mkdtemp', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')
    expect(mockMkdtemp).toHaveBeenCalledOnce()
  })

  it('copies ASS file to temp directory', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    const copyArgs = mockCopyFile.mock.calls.map((c: any[]) => [c[0], c[1]])
    const assCopy = copyArgs.find((c: string[]) => c[0] === '/captions.ass')
    expect(assCopy).toBeDefined()
    expect(assCopy![1]).toContain('captions.ass')
  })

  it('copies .ttf font files to temp directory but skips non-font files', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    const copyDests = mockCopyFile.mock.calls.map((c: any[]) => c[1] as string)
    expect(copyDests.some((d: string) => d.includes('Montserrat-Bold.ttf'))).toBe(true)
    expect(copyDests.some((d: string) => d.includes('readme.txt'))).toBe(false)
  })

  it('builds filter_complex with ass filter and fontsdir', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    const args: string[] = mockExecFile.mock.calls[0][1]
    const fcIdx = args.indexOf('-filter_complex')
    const fc = args[fcIdx + 1]
    expect(fc).toContain('ass=captions.ass')
    expect(fc).toContain('fontsdir=.')
  })

  it('maps [ca] instead of [outa] for captioned output', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    const args: string[] = mockExecFile.mock.calls[0][1]
    expect(args).toContain('[ca]')
    expect(args).not.toContain('[outa]')
  })

  it('runs execFile with cwd set to temp directory', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    const opts = mockExecFile.mock.calls[0][2]
    expect(opts.cwd).toBe(tempDir)
  })

  it('returns output path on success', async () => {
    const result = await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')
    expect(result).toBe('/output.mp4')
  })

  it('cleans up temp directory after completion', async () => {
    await singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4')

    expect(mockRmdir).toHaveBeenCalled()
  })

  it('rejects with error on FFmpeg failure and still cleans up', async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      mockReaddir.mockResolvedValueOnce(['captions.ass'])
      cb(new Error('encode failed'), '', 'error details')
    })

    await expect(singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4'))
      .rejects.toThrow('Single-pass edit failed: encode failed')

    expect(mockRmdir).toHaveBeenCalled()
  })

  it('throws descriptive error when fonts directory is missing', async () => {
    mockReaddir.mockRejectedValueOnce(Object.assign(new Error("ENOENT: no such file or directory, scandir '/fonts'"), { code: 'ENOENT' }))

    await expect(singlePassEditAndCaption('/input.mp4', segments, '/captions.ass', '/output.mp4'))
      .rejects.toThrow('Fonts directory not found')
  })
})

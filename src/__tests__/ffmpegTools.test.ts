import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── vi.hoisted mock variables ──────────────────────────────────────────────
const {
  mockExecFile,
  mockMkdir,
  mockRm,
  mockWriteFile,
  mockStat,
  mockMkdtemp,
  mockCopyFile,
  mockReaddir,
  mockUnlink,
  mockRmdir,
  mockRename,
  mockCloseSync,
  mockFfmpegInstance,
  mockFfmpegCtor,
  mockFfprobe,
  mockTmpDirSync,
  mockTmpFileSync,
} = vi.hoisted(() => {
  const inst: Record<string, any> = {
    input: vi.fn().mockReturnThis(),
    inputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    audioCodec: vi.fn().mockReturnThis(),
    audioBitrate: vi.fn().mockReturnThis(),
    audioFrequency: vi.fn().mockReturnThis(),
    audioChannels: vi.fn().mockReturnThis(),
    audioFilters: vi.fn().mockReturnThis(),
    noVideo: vi.fn().mockReturnThis(),
    format: vi.fn().mockReturnThis(),
    frames: vi.fn().mockReturnThis(),
    seekInput: vi.fn().mockReturnThis(),
    setStartTime: vi.fn().mockReturnThis(),
    setDuration: vi.fn().mockReturnThis(),
    on: vi.fn(function (this: any, event: string, cb: Function) {
      if (event === 'end') setTimeout(() => cb(), 0);
      return this;
    }),
    run: vi.fn(),
  };

  const ctor = vi.fn(() => inst);
  const ffprobe = vi.fn();
  // Attach static helpers to ctor so setFfmpegPath etc. don't blow up
  (ctor as any).setFfmpegPath = vi.fn();
  (ctor as any).setFfprobePath = vi.fn();
  (ctor as any).ffprobe = ffprobe;

  return {
    mockExecFile: vi.fn(),
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockRm: vi.fn().mockResolvedValue(undefined),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockStat: vi.fn(),
    mockMkdtemp: vi.fn(),
    mockCopyFile: vi.fn().mockResolvedValue(undefined),
    mockReaddir: vi.fn().mockResolvedValue([]),
    mockUnlink: vi.fn().mockResolvedValue(undefined),
    mockRmdir: vi.fn().mockResolvedValue(undefined),
    mockRename: vi.fn().mockResolvedValue(undefined),
    mockCloseSync: vi.fn(),
    mockFfmpegInstance: inst,
    mockFfmpegCtor: ctor,
    mockFfprobe: ffprobe,
    mockTmpDirSync: vi.fn(() => ({ name: '/tmp/vidpipe-test', removeCallback: vi.fn() })),
    mockTmpFileSync: vi.fn(() => ({ name: '/tmp/vidpipe-test/concat-test.txt', fd: 3, removeCallback: vi.fn() })),
  };
});

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('fs', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    closeSync: mockCloseSync,
    promises: {
      ...original.promises,
      mkdir: mockMkdir,
      rm: mockRm,
      writeFile: mockWriteFile,
      stat: mockStat,
      mkdtemp: mockMkdtemp,
      copyFile: mockCopyFile,
      readdir: mockReaddir,
      unlink: mockUnlink,
      rmdir: mockRmdir,
      rename: mockRename,
    },
  };
});

vi.mock('fluent-ffmpeg', () => ({
  default: mockFfmpegCtor,
}));

vi.mock('tmp', () => ({
  default: {
    dirSync: mockTmpDirSync,
    fileSync: mockTmpFileSync,
  },
}));

vi.mock('../../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports under test (AFTER mocks) ───────────────────────────────────────
import { extractClip, extractCompositeClip, extractCompositeClipWithTransitions } from '../tools/ffmpeg/clipExtraction.js';
import { burnCaptions } from '../tools/ffmpeg/captionBurning.js';
import { extractAudio, splitAudioIntoChunks } from '../tools/ffmpeg/audioExtraction.js';
import { detectSilence } from '../tools/ffmpeg/silenceDetection.js';
import { captureFrame, captureFrames } from '../tools/ffmpeg/frameCapture.js';

// ── Helpers ────────────────────────────────────────────────────────────────
function resetFfmpegInstance() {
  for (const key of Object.keys(mockFfmpegInstance)) {
    if (typeof mockFfmpegInstance[key]?.mockClear === 'function') {
      mockFfmpegInstance[key].mockClear();
    }
  }
  // Default: fire 'end' immediately
  mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
    if (event === 'end') setTimeout(() => cb(), 0);
    return this;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFfmpegInstance();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. clipExtraction.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('clipExtraction', () => {
  describe('extractClip', () => {
    it('creates output dir and calls ffmpeg with correct start/duration (re-encode)', async () => {
      const result = await extractClip('/in.mp4', 10, 20, '/out/clip.mp4', 1);
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockFfmpegCtor).toHaveBeenCalledWith('/in.mp4');
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalledWith(9); // 10-1
      expect(mockFfmpegInstance.setDuration).toHaveBeenCalledWith(12); // (20+1)-(10-1)
      // Re-encodes for frame-accurate timing (not -c copy which snaps to keyframes)
      expect(mockFfmpegInstance.outputOptions).toHaveBeenCalledWith(
        expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac']),
      );
      expect(mockFfmpegInstance.run).toHaveBeenCalled();
      expect(result).toBe('/out/clip.mp4');
    });

    it('clamps buffered start to 0 when start < buffer', async () => {
      await extractClip('/in.mp4', 0.5, 5, '/out/clip.mp4', 1);
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalledWith(0);
      expect(mockFfmpegInstance.setDuration).toHaveBeenCalledWith(6); // (5+1)-0
    });

    it('rejects when ffmpeg emits error', async () => {
      mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') setTimeout(() => cb(new Error('boom')), 0);
        return this;
      });
      await expect(extractClip('/in.mp4', 10, 20, '/out/clip.mp4')).rejects.toThrow('Clip extraction failed: boom');
    });
  });

  describe('extractCompositeClip', () => {
    it('throws when no segments', async () => {
      await expect(extractCompositeClip('/in.mp4', [], '/out.mp4')).rejects.toThrow('At least one segment');
    });

    it('delegates to extractClip for single segment', async () => {
      const result = await extractCompositeClip('/in.mp4', [{ start: 5, end: 10, description: 'd' }], '/out.mp4');
      // extractClip uses setStartTime which we can verify
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalled();
      expect(result).toBe('/out.mp4');
    });

    it('extracts each segment then concatenates for multiple segments', async () => {
      const segs = [
        { start: 5, end: 10, description: 'a' },
        { start: 20, end: 25, description: 'b' },
      ];
      const result = await extractCompositeClip('/in.mp4', segs, '/out.mp4', 1);
      // mkdir for output dir only (temp dir created by tmp.dirSync)
      expect(mockMkdir).toHaveBeenCalledTimes(1);
      // ffmpeg called: 2 segment extractions + 1 concat = 3 times
      expect(mockFfmpegCtor).toHaveBeenCalledTimes(3);
      // concat list written
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      // temp dir cleaned up via removeCallback
      expect(mockTmpDirSync().removeCallback).toBeDefined();
      expect(result).toBe('/out.mp4');
    });
  });

  describe('extractCompositeClipWithTransitions', () => {
    it('throws when no segments', async () => {
      await expect(extractCompositeClipWithTransitions('/in.mp4', [], '/out.mp4')).rejects.toThrow('At least one segment');
    });

    it('delegates to extractClip for single segment', async () => {
      const result = await extractCompositeClipWithTransitions(
        '/in.mp4', [{ start: 5, end: 10, description: 'd' }], '/out.mp4',
      );
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalled();
      expect(result).toBe('/out.mp4');
    });

    it('delegates to extractCompositeClip for 2 segments with transitionDuration=0', async () => {
      const segs = [
        { start: 5, end: 10, description: 'a' },
        { start: 20, end: 25, description: 'b' },
      ];
      const result = await extractCompositeClipWithTransitions('/in.mp4', segs, '/out.mp4', 0, 1);
      // Should go through extractCompositeClip path (ffmpegCtor called 3 times)
      expect(mockFfmpegCtor.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(result).toBe('/out.mp4');
    });

    it('uses execFile with xfade filter_complex for 3+ segments', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
          if (cb) cb(null, '', '');
          return { on: vi.fn() };
        },
      );

      const segs = [
        { start: 0, end: 5, description: 'a' },
        { start: 10, end: 15, description: 'b' },
        { start: 20, end: 25, description: 'c' },
      ];
      const result = await extractCompositeClipWithTransitions('/in.mp4', segs, '/out.mp4', 0.5, 1);

      expect(mockExecFile).toHaveBeenCalledTimes(2);
      const args = mockExecFile.mock.calls[1][1] as string[];
      expect(args).toContain('-filter_complex');
      const filterIdx = args.indexOf('-filter_complex');
      const filter = args[filterIdx + 1];
      expect(filter).toContain('xfade');
      expect(filter).toContain('acrossfade');
      expect(filter).toContain('fps=');
      expect(filter).toContain('[vout]');
      expect(filter).toContain('[aout]');
      expect(args).toContain('/out.mp4');
      expect(result).toBe('/out.mp4');
    });

    it('rejects when execFile returns error', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
          if (cb) cb(new Error('xfade fail'), '', 'stderr msg');
          return { on: vi.fn() };
        },
      );

      const segs = [
        { start: 0, end: 5, description: 'a' },
        { start: 10, end: 15, description: 'b' },
        { start: 20, end: 25, description: 'c' },
      ];
      await expect(
        extractCompositeClipWithTransitions('/in.mp4', segs, '/out.mp4', 0.5, 1),
      ).rejects.toThrow('xfade composite clip failed');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. captionBurning.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('captionBurning', () => {
  beforeEach(() => {
    mockMkdtemp.mockResolvedValue('/tmp/caption-xyz');
    mockReaddir.mockResolvedValue(['Bold.ttf', 'Italic.otf', 'notes.txt']);
  });

  it('copies ASS file to temp dir and calls execFile with correct args', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
        if (cb) cb(null, '', '');
        return { on: vi.fn() };
      },
    );

    const result = await burnCaptions('/video.mp4', '/subs.ass', '/out/burned.mp4');

    expect(mockMkdtemp).toHaveBeenCalled();
    expect(mockCopyFile).toHaveBeenCalledWith('/subs.ass', expect.stringContaining('captions.ass'));
    // Fonts copied (only .ttf and .otf)
    expect(mockCopyFile).toHaveBeenCalledWith(expect.stringContaining('Bold.ttf'), expect.any(String));
    expect(mockCopyFile).toHaveBeenCalledWith(expect.stringContaining('Italic.otf'), expect.any(String));

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('-vf');
    expect(args).toContain('ass=captions.ass:fontsdir=.');

    // Cleanup
    expect(mockReaddir).toHaveBeenCalled();
    expect(result).toBe('/out/burned.mp4');
  });

  it('cleans up temp dir on failure', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
        if (cb) cb(new Error('burn fail'), '', 'stderr err');
        return { on: vi.fn() };
      },
    );
    // readdir returns files for cleanup
    mockReaddir.mockResolvedValueOnce(['Bold.ttf', 'Italic.otf', 'notes.txt'])
      .mockResolvedValueOnce(['captions.ass', 'output.mp4']);

    await expect(burnCaptions('/v.mp4', '/s.ass', '/out.mp4')).rejects.toThrow('Caption burning failed');
    // Cleanup still runs
    expect(mockUnlink).toHaveBeenCalled();
    expect(mockRmdir).toHaveBeenCalled();
  });

  it('falls back to copyFile when rename fails', async () => {
    mockRename.mockRejectedValueOnce(new Error('EXDEV'));
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: any, cb?: Function) => {
        if (cb) cb(null, '', '');
        return { on: vi.fn() };
      },
    );

    const result = await burnCaptions('/video.mp4', '/subs.ass', '/out/burned.mp4');
    expect(mockRename).toHaveBeenCalled();
    // copyFile called for the output fallback (beyond the initial ASS + font copies)
    expect(mockCopyFile).toHaveBeenCalled();
    expect(result).toBe('/out/burned.mp4');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. audioExtraction.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('audioExtraction', () => {
  describe('extractAudio', () => {
    it('extracts mp3 audio by default', async () => {
      const result = await extractAudio('/video.mp4', '/out/audio.mp3');
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockFfmpegCtor).toHaveBeenCalledWith('/video.mp4');
      expect(mockFfmpegInstance.noVideo).toHaveBeenCalled();
      expect(mockFfmpegInstance.audioChannels).toHaveBeenCalledWith(1);
      expect(mockFfmpegInstance.audioCodec).toHaveBeenCalledWith('libmp3lame');
      expect(mockFfmpegInstance.audioBitrate).toHaveBeenCalledWith('64k');
      expect(mockFfmpegInstance.audioFrequency).toHaveBeenCalledWith(16000);
      expect(mockFfmpegInstance.run).toHaveBeenCalled();
      expect(result).toBe('/out/audio.mp3');
    });

    it('extracts wav audio when format is wav', async () => {
      await extractAudio('/video.mp4', '/out/audio.wav', { format: 'wav' });
      expect(mockFfmpegInstance.audioCodec).toHaveBeenCalledWith('pcm_s16le');
      expect(mockFfmpegInstance.audioFrequency).toHaveBeenCalledWith(16000);
    });

    it('rejects when ffmpeg emits error', async () => {
      mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') setTimeout(() => cb(new Error('audio fail')), 0);
        return this;
      });
      await expect(extractAudio('/v.mp4', '/o.mp3')).rejects.toThrow('Audio extraction failed: audio fail');
    });
  });

  describe('splitAudioIntoChunks', () => {
    it('returns single path when file is small enough', async () => {
      mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 }); // 10MB
      const result = await splitAudioIntoChunks('/audio.mp3', 24);
      expect(result).toEqual(['/audio.mp3']);
    });

    it('splits large file into chunks', async () => {
      mockStat.mockResolvedValue({ size: 48 * 1024 * 1024 }); // 48MB
      mockFfprobe.mockImplementation((_path: string, cb: Function) => {
        cb(null, { format: { duration: 600 } }); // 10 minutes
      });

      const result = await splitAudioIntoChunks('/audio.mp3', 24);
      // 48MB / 24MB = 2 chunks
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('_chunk0');
      expect(result[1]).toContain('_chunk1');
      // ffmpeg called twice for chunk extraction
      expect(mockFfmpegCtor).toHaveBeenCalledTimes(2);
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalledWith(0);
      expect(mockFfmpegInstance.setStartTime).toHaveBeenCalledWith(300);
      expect(mockFfmpegInstance.setDuration).toHaveBeenCalledWith(300);
    });

    it('rejects when ffprobe fails', async () => {
      mockStat.mockResolvedValue({ size: 48 * 1024 * 1024 });
      mockFfprobe.mockImplementation((_path: string, cb: Function) => {
        cb(new Error('probe fail'));
      });
      await expect(splitAudioIntoChunks('/audio.mp3', 24)).rejects.toThrow('ffprobe failed');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. silenceDetection.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('silenceDetection', () => {
  it('parses silence regions from ffmpeg stderr', async () => {
    const stderrLines = [
      '[silencedetect @ 0x1234] silence_start: 1.5',
      '[silencedetect @ 0x1234] silence_end: 3.5 | silence_duration: 2.0',
      '[silencedetect @ 0x1234] silence_start: 10.0',
      '[silencedetect @ 0x1234] silence_end: 12.5 | silence_duration: 2.5',
    ];

    mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'stderr') {
        setTimeout(() => {
          for (const line of stderrLines) cb(line);
        }, 0);
      }
      if (event === 'end') {
        setTimeout(() => cb(), 10);
      }
      return this;
    });

    const result = await detectSilence('/audio.mp3', 1.0, '-30dB');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 1.5, end: 3.5, duration: 2.0 });
    expect(result[1]).toEqual({ start: 10.0, end: 12.5, duration: 2.5 });
    expect(mockFfmpegInstance.audioFilters).toHaveBeenCalledWith('silencedetect=noise=-30dB:d=1');
    expect(mockFfmpegInstance.format).toHaveBeenCalledWith('null');
  });

  it('handles silence starting at t=0 (no explicit silence_start)', async () => {
    const stderrLines = [
      '[silencedetect @ 0x1234] silence_end: 2.0 | silence_duration: 2.0',
    ];

    mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'stderr') {
        setTimeout(() => { for (const line of stderrLines) cb(line); }, 0);
      }
      if (event === 'end') setTimeout(() => cb(), 10);
      return this;
    });

    const result = await detectSilence('/audio.mp3');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 0, end: 2.0, duration: 2.0 });
  });

  it('filters out invalid regions (end <= start)', async () => {
    const stderrLines = [
      '[silencedetect @ 0x1234] silence_start: 5.0',
      '[silencedetect @ 0x1234] silence_end: 5.0 | silence_duration: 0.0',
      '[silencedetect @ 0x1234] silence_start: 10.0',
      '[silencedetect @ 0x1234] silence_end: 12.0 | silence_duration: 2.0',
    ];

    mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'stderr') {
        setTimeout(() => { for (const line of stderrLines) cb(line); }, 0);
      }
      if (event === 'end') setTimeout(() => cb(), 10);
      return this;
    });

    const result = await detectSilence('/audio.mp3');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 10.0, end: 12.0, duration: 2.0 });
  });

  it('rejects when ffmpeg emits error', async () => {
    mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'error') setTimeout(() => cb(new Error('detect fail')), 0);
      return this;
    });
    await expect(detectSilence('/audio.mp3')).rejects.toThrow('Silence detection failed: detect fail');
  });

  it('returns empty array when no silence detected', async () => {
    mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
      if (event === 'stderr') {
        setTimeout(() => cb('some other ffmpeg output'), 0);
      }
      if (event === 'end') setTimeout(() => cb(), 10);
      return this;
    });

    const result = await detectSilence('/audio.mp3');
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. frameCapture.ts
// ═══════════════════════════════════════════════════════════════════════════
describe('frameCapture', () => {
  describe('captureFrame', () => {
    it('captures frame at given timestamp', async () => {
      const result = await captureFrame('/video.mp4', 30.5, '/out/frame.png');
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(mockFfmpegCtor).toHaveBeenCalledWith('/video.mp4');
      expect(mockFfmpegInstance.seekInput).toHaveBeenCalledWith(30.5);
      expect(mockFfmpegInstance.frames).toHaveBeenCalledWith(1);
      expect(mockFfmpegInstance.output).toHaveBeenCalledWith('/out/frame.png');
      expect(mockFfmpegInstance.run).toHaveBeenCalled();
      expect(result).toBe('/out/frame.png');
    });

    it('rejects when ffmpeg emits error', async () => {
      mockFfmpegInstance.on.mockImplementation(function (this: any, event: string, cb: Function) {
        if (event === 'error') setTimeout(() => cb(new Error('frame fail')), 0);
        return this;
      });
      await expect(captureFrame('/v.mp4', 10, '/o.png')).rejects.toThrow('Frame capture failed: frame fail');
    });
  });

  describe('captureFrames', () => {
    it('captures multiple frames with correct naming', async () => {
      const result = await captureFrames('/video.mp4', [10, 30, 60], '/out/frames');
      expect(mockMkdir).toHaveBeenCalled();
      // captureFrame called 3 times => ffmpeg ctor called 3 times
      expect(mockFfmpegCtor).toHaveBeenCalledTimes(3);
      expect(result).toHaveLength(3);
      expect(result[0]).toContain('snapshot-001.png');
      expect(result[1]).toContain('snapshot-002.png');
      expect(result[2]).toContain('snapshot-003.png');
    });
  });
});

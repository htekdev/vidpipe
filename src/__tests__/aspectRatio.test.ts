import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure mock fns are available before vi.mock factories
const { mockExecFile, mockMkdir, mockCopyFile, mockDetectWebcam, mockGetVideoResolution } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockCopyFile: vi.fn(),
  mockDetectWebcam: vi.fn(),
  mockGetVideoResolution: vi.fn(),
}));

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    promises: {
      ...original.promises,
      mkdir: mockMkdir,
      copyFile: mockCopyFile,
    },
  };
});

// Mock logger
vi.mock('../config/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock face detection — return null (no webcam) so smart portrait falls back to center-crop
vi.mock('../tools/ffmpeg/faceDetection', () => ({
  detectWebcamRegion: mockDetectWebcam,
  getVideoResolution: mockGetVideoResolution,
}));

import {
  convertAspectRatio,
  convertToPortraitSmart,
  convertToSquareSmart,
  convertToFeedSmart,
  generatePlatformVariants,
  PLATFORM_RATIOS,
  DIMENSIONS,
  type AspectRatio,
  type Platform,
} from '../tools/ffmpeg/aspectRatio.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Make execFile succeed by default */
function execFileSucceeds() {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(null, '', '');
  });
}

/** Make execFile fail */
function execFileFails(message = 'ffmpeg error') {
  mockExecFile.mockImplementation((...args: any[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === 'function') cb(new Error(message), '', message);
  });
}

/** Extract the -vf filter argument from execFile calls */
function getCapturedFilter(): string | undefined {
  const call = mockExecFile.mock.calls[0];
  if (!call) return undefined;
  const args: string[] = call[1];
  const vfIdx = args.indexOf('-vf');
  return vfIdx >= 0 ? args[vfIdx + 1] : undefined;
}

beforeEach(() => {
  mockExecFile.mockReset();
  mockMkdir.mockReset().mockResolvedValue(undefined);
  mockCopyFile.mockReset().mockResolvedValue(undefined);
  mockDetectWebcam.mockReset().mockResolvedValue(null);
  mockGetVideoResolution.mockReset().mockResolvedValue({ width: 1920, height: 1080 });
  execFileSucceeds();
});

// ── Filter string generation ────────────────────────────────────────────────

describe('Crop filter generation (via convertAspectRatio)', () => {
  it('9:16 portrait center-crop produces correct crop filter', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '9:16');

    const filter = getCapturedFilter();
    expect(filter).toContain('crop=ih*9/16:ih');
    expect(filter).toContain('scale=1080:1920');
  });

  it('1:1 square crop produces correct filter', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '1:1');

    const filter = getCapturedFilter();
    expect(filter).toContain('crop=ih:ih');
    expect(filter).toContain('scale=1080:1080');
  });

  it('4:5 Instagram feed produces correct filter', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '4:5');

    const filter = getCapturedFilter();
    expect(filter).toContain('crop=ih*4/5:ih');
    expect(filter).toContain('scale=1080:1350');
  });

  it('letterbox mode produces pad filter instead of crop', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '9:16', { letterbox: true });

    const filter = getCapturedFilter();
    expect(filter).toContain('pad=1080:1920');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).not.toContain('crop=');
  });

  it('16:9 same-ratio copies file instead of re-encoding', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '16:9');

    expect(mockCopyFile).toHaveBeenCalledWith('/in.mp4', '/out.mp4');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('16:9 with letterbox still encodes (not a copy)', async () => {
    await convertAspectRatio('/in.mp4', '/out.mp4', '16:9', { letterbox: true });

    expect(mockExecFile).toHaveBeenCalled();
    const filter = getCapturedFilter();
    expect(filter).toContain('scale=1920:1080');
  });
});

// ── Platform variant generation ─────────────────────────────────────────────

describe('generatePlatformVariants', () => {
  it('returns expected variants for default platforms', async () => {
    const platforms: Platform[] = ['tiktok', 'youtube-shorts', 'instagram-reels', 'instagram-feed', 'linkedin'];
    const variants = await generatePlatformVariants('/in.mp4', '/out', 'my-short', platforms);

    // 9:16 platforms: tiktok, youtube-shorts, instagram-reels (one encode, 3 entries)
    // 4:5: instagram-feed (1 entry)
    // 1:1: linkedin (1 entry)
    expect(variants).toHaveLength(5);

    const portrait = variants.filter((v) => v.aspectRatio === '9:16');
    expect(portrait).toHaveLength(3);
    expect(portrait.map((v) => v.platform)).toEqual(
      expect.arrayContaining(['tiktok', 'youtube-shorts', 'instagram-reels']),
    );

    const feed = variants.filter((v) => v.aspectRatio === '4:5');
    expect(feed).toHaveLength(1);
    expect(feed[0].platform).toBe('instagram-feed');

    const square = variants.filter((v) => v.aspectRatio === '1:1');
    expect(square).toHaveLength(1);
    expect(square[0].platform).toBe('linkedin');
  });

  it('each variant has correct dimensions for its aspect ratio', async () => {
    const platforms: Platform[] = ['tiktok', 'instagram-feed', 'linkedin'];
    const variants = await generatePlatformVariants('/in.mp4', '/out', 'clip', platforms);

    for (const v of variants) {
      const expectedDims = DIMENSIONS[v.aspectRatio];
      expect(v.width).toBe(expectedDims.width);
      expect(v.height).toBe(expectedDims.height);
    }
  });

  it('skips 16:9 platforms (original ratio)', async () => {
    const platforms: Platform[] = ['youtube', 'tiktok'];
    const variants = await generatePlatformVariants('/in.mp4', '/out', 'clip', platforms);

    // youtube is 16:9 → skipped; only tiktok (9:16) remains
    expect(variants).toHaveLength(1);
    expect(variants[0].platform).toBe('tiktok');
  });

  it('deduplicates encodes for same aspect ratio', async () => {
    const platforms: Platform[] = ['tiktok', 'youtube-shorts'];
    await generatePlatformVariants('/in.mp4', '/out', 'clip', platforms);

    // Both are 9:16 → only one ffmpeg encode (via convertToPortraitSmart fallback)
    // convertToPortraitSmart calls convertAspectRatio once when no webcam detected
    const ffmpegCalls = mockExecFile.mock.calls.filter((c: any[]) => c[0] !== 'ffprobe');
    expect(ffmpegCalls).toHaveLength(1);
  });
});

// ── Constants ───────────────────────────────────────────────────────────────

describe('PLATFORM_RATIOS constant', () => {
  it('maps all platforms to valid aspect ratios', () => {
    const validRatios: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];
    for (const [platform, ratio] of Object.entries(PLATFORM_RATIOS)) {
      expect(validRatios).toContain(ratio);
    }
  });

  it('tiktok and youtube-shorts are 9:16', () => {
    expect(PLATFORM_RATIOS['tiktok']).toBe('9:16');
    expect(PLATFORM_RATIOS['youtube-shorts']).toBe('9:16');
  });

  it('instagram-feed is 4:5', () => {
    expect(PLATFORM_RATIOS['instagram-feed']).toBe('4:5');
  });
});

describe('DIMENSIONS constant', () => {
  it('has dimensions for all aspect ratios', () => {
    expect(DIMENSIONS['16:9']).toEqual({ width: 1920, height: 1080 });
    expect(DIMENSIONS['9:16']).toEqual({ width: 1080, height: 1920 });
    expect(DIMENSIONS['1:1']).toEqual({ width: 1080, height: 1080 });
    expect(DIMENSIONS['4:5']).toEqual({ width: 1080, height: 1350 });
  });
});

// ── Error handling ──────────────────────────────────────────────────────────

describe('Error handling', () => {
  it('convertAspectRatio rejects when ffmpeg fails', async () => {
    execFileFails('Conversion error');

    await expect(
      convertAspectRatio('/in.mp4', '/out.mp4', '9:16'),
    ).rejects.toThrow('Aspect ratio conversion failed');
  });

  it('generatePlatformVariants skips failed ratios gracefully', async () => {
    execFileFails('encode failed');

    const variants = await generatePlatformVariants('/in.mp4', '/out', 'clip', ['tiktok', 'linkedin']);
    // All fail → empty array, no throw
    expect(variants).toEqual([]);
  });
});

// ── Smart portrait: screen crop & face padding ─────────────────────────────

describe('convertToPortraitSmart – screen crop & face padding', () => {
  /** Extract the -filter_complex argument from execFile calls */
  function getCapturedFilterComplex(): string | undefined {
    const call = mockExecFile.mock.calls[0];
    if (!call) return undefined;
    const args: string[] = call[1];
    const idx = args.indexOf('-filter_complex');
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  it('screen crop excludes webcam region (bottom-right)', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToPortraitSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // Screen crop uses webcam.x minus 2% margin (38px): 1440 - 38 = 1402
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1440 - margin}:ih:0:0`);
  });

  it('screen crop excludes webcam region (bottom-left)', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 0, y: 810, width: 480, height: 270,
      position: 'bottom-left', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToPortraitSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // Screen crop starts after webcam (x + width + margin): 0 + 480 + 38 = 518
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1920 - 480 - margin}:ih:${480 + margin}:0`);
  });

  it('face crop matches target aspect ratio and fills bottom section', async () => {
    const webcamW = 480;
    const webcamH = 270;
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: webcamW, height: webcamH,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToPortraitSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // Target AR = 1080/672 = 1.607; webcam AR = 480/270 = 1.778 (wider)
    // So crop height = 270, width = round(270 * 1.607) = 434
    const targetAR = 1080 / 672;
    const expectedW = Math.round(webcamH * targetAR); // 434
    expect(fc).toContain(`crop=${expectedW}:${webcamH}`);
    // Should scale directly to 1080:672 with no padding
    expect(fc).toContain('scale=1080:672[cam]');
    expect(fc).not.toContain('force_original_aspect_ratio=increase');
  });

  it('screen crop uses detected webcam.x with 2% safety margin', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1728, y: 810, width: 192, height: 270,
      position: 'bottom-right', confidence: 0.9,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToPortraitSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // crop width = webcam.x - margin = 1728 - 38 = 1690
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1728 - margin}:ih:0:0`);
  });

  it('screen crop handles webcam at far edge gracefully', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 20, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToPortraitSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // webcam.x = 20, minus margin = 20 - 38 = -18 → clamped to 0
    expect(fc).toContain('crop=0:ih:0:0');
  });
});

// ── Smart square: screen crop & face padding ────────────────────────────────

describe('convertToSquareSmart – screen crop & face padding', () => {
  function getCapturedFilterComplex(): string | undefined {
    const call = mockExecFile.mock.calls[0];
    if (!call) return undefined;
    const args: string[] = call[1];
    const idx = args.indexOf('-filter_complex');
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  it('falls back to center-crop when no webcam detected', async () => {
    mockDetectWebcam.mockResolvedValue(null);

    await convertToSquareSmart('/in.mp4', '/out.mp4');

    const filter = getCapturedFilter();
    expect(filter).toContain('crop=ih:ih');
    expect(filter).toContain('scale=1080:1080');
  });

  it('screen crop excludes webcam region (bottom-right)', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToSquareSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1440 - margin}:ih:0:0`);
  });

  it('face crop matches target aspect ratio and fills bottom section', async () => {
    const webcamW = 480;
    const webcamH = 270;
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: webcamW, height: webcamH,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToSquareSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // Target AR = 1080/380 = 2.842; webcam AR = 480/270 = 1.778 (narrower)
    // Keep full width, center-crop height: faceH = round(480 / (1080/380)) = 169
    const targetAR = 1080 / 380;
    const expectedH = Math.round(webcamW / targetAR);
    expect(fc).toContain(`crop=${webcamW}:${expectedH}`);
    // Should scale directly to 1080:380 with no padding
    expect(fc).toContain('scale=1080:380[cam]');
  });

  it('uses split-screen layout 700+380=1080', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToSquareSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    expect(fc).toContain('scale=1080:700');
    expect(fc).toContain('scale=1080:380[cam]');
    expect(fc).toContain('vstack');
  });
});

// ── Smart feed: screen crop & face padding ──────────────────────────────────

describe('convertToFeedSmart – screen crop & face padding', () => {
  function getCapturedFilterComplex(): string | undefined {
    const call = mockExecFile.mock.calls[0];
    if (!call) return undefined;
    const args: string[] = call[1];
    const idx = args.indexOf('-filter_complex');
    return idx >= 0 ? args[idx + 1] : undefined;
  }

  it('falls back to center-crop when no webcam detected', async () => {
    mockDetectWebcam.mockResolvedValue(null);

    await convertToFeedSmart('/in.mp4', '/out.mp4');

    const filter = getCapturedFilter();
    expect(filter).toContain('crop=ih*4/5:ih');
    expect(filter).toContain('scale=1080:1350');
  });

  it('screen crop excludes webcam region (bottom-right)', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToFeedSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1440 - margin}:ih:0:0`);
  });

  it('face crop matches target aspect ratio and fills bottom section', async () => {
    const webcamW = 480;
    const webcamH = 270;
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: webcamW, height: webcamH,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToFeedSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    // Target AR = 1080/472 = 2.288; webcam AR = 480/270 = 1.778 (narrower)
    // Keep full width, center-crop height: faceH = round(480 / (1080/472)) = 210
    const targetAR = 1080 / 472;
    const expectedH = Math.round(webcamW / targetAR);
    expect(fc).toContain(`crop=${webcamW}:${expectedH}`);
    // Should scale directly to 1080:472 with no padding
    expect(fc).toContain('scale=1080:472[cam]');
  });

  it('uses split-screen layout 878+472=1350', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 1440, y: 810, width: 480, height: 270,
      position: 'bottom-right', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToFeedSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    expect(fc).toContain('scale=1080:878');
    expect(fc).toContain('scale=1080:472[cam]');
    expect(fc).toContain('vstack');
  });

  it('screen crop excludes webcam region (bottom-left)', async () => {
    mockDetectWebcam.mockResolvedValue({
      x: 0, y: 810, width: 480, height: 270,
      position: 'bottom-left', confidence: 0.8,
    });
    mockGetVideoResolution.mockResolvedValue({ width: 1920, height: 1080 });

    await convertToFeedSmart('/in.mp4', '/out.mp4');

    const fc = getCapturedFilterComplex();
    expect(fc).toBeDefined();
    const margin = Math.round(1920 * 0.02);
    expect(fc).toContain(`crop=${1920 - 480 - margin}:ih:${480 + margin}:0`);
  });
});

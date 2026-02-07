import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import {
  setupFixtures,
  cleanupFixtures,
  isFFmpegAvailable,
  fileExistsWithSize,
  getVideoDuration,
  type TestFixtures,
} from './fixture.js';
import { extractClip, extractCompositeClip, extractCompositeClipWithTransitions } from '../../tools/ffmpeg/clipExtraction.js';

const ffmpegOk = await isFFmpegAvailable();

describe.skipIf(!ffmpegOk)('Clip Extraction & Composite', () => {
  let fix: TestFixtures;

  beforeAll(async () => { fix = await setupFixtures(); }, 30000);
  afterAll(async () => { await cleanupFixtures(); });

  it('extracts a single clip with correct duration', async () => {
    const output = path.join(fix.dir, 'clip-single.mp4');
    await extractClip(fix.videoPath, 0.5, 2.5, output, 0.5);

    const { exists, size } = await fileExistsWithSize(output);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    const duration = await getVideoDuration(output);
    expect(duration).toBeCloseTo(3, 0); // 0.0–3.0 = 3s (start buffered to 0, end buffered to 3.0)
  }, 90000);

  it('concatenates multiple segments into a composite clip', async () => {
    const output = path.join(fix.dir, 'clip-composite.mp4');
    const segments = [
      { start: 0.5, end: 1.5, description: 'segment 1' },
      { start: 3.0, end: 4.0, description: 'segment 2' },
    ];
    await extractCompositeClip(fix.videoPath, segments, output, 0.5);

    const { exists, size } = await fileExistsWithSize(output);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    const duration = await getVideoDuration(output);
    // Segment 1: buffered 0.0–2.0 = 2s, Segment 2: buffered 2.5–4.5 = 2s → ~4s total
    // But task says "roughly 2-3s" with segments [0.5-1.5] and [3.0-4.0] + 0.5 buffer
    // Actual: seg1 = max(0, 0.5-0.5)=0.0 to 1.5+0.5=2.0 → 2s; seg2 = 3.0-0.5=2.5 to 4.0+0.5=4.5 → 2s; total ~4s
    expect(duration).toBeCloseTo(4, 0);
  }, 90000);

  it('composites segments with xfade transitions', async () => {
    const output = path.join(fix.dir, 'clip-xfade.mp4');
    const segments = [
      { start: 0.0, end: 1.0, description: 'seg a' },
      { start: 2.0, end: 3.0, description: 'seg b' },
      { start: 4.0, end: 5.0, description: 'seg c' },
    ];
    const transitionDuration = 0.3;
    const buffer = 0.5;
    await extractCompositeClipWithTransitions(
      fix.videoPath, segments, output, transitionDuration, buffer,
    );

    const { exists, size } = await fileExistsWithSize(output);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    // Each segment with 0.5 buffer: seg0=0.0-1.5(1.5s), seg1=1.5-3.5(2s), seg2=3.5-5.0(clamped, ~1.5s but source is 5s so 3.5-5.5→5.0 end = ~1.5s)
    // Actually: seg0 = max(0, 0-0.5)=0 to 1+0.5=1.5 → 1.5s; seg1 = 2-0.5=1.5 to 3+0.5=3.5 → 2s; seg2 = 4-0.5=3.5 to 5+0.5=5.5 → ~1.5-2s (source may clamp)
    // Total before transitions: ~5-5.5s, minus 2×0.3=0.6 → ~4.4-4.9s
    const duration = await getVideoDuration(output);
    expect(duration).toBeGreaterThan(3);
    expect(duration).toBeLessThan(7);
  }, 90000);
});

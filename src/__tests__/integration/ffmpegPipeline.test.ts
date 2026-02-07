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
import { extractAudio } from '../../tools/ffmpeg/audioExtraction.js';
import { detectSilence } from '../../tools/ffmpeg/silenceDetection.js';
import { captureFrame, captureFrames } from '../../tools/ffmpeg/frameCapture.js';
import { extractClip } from '../../tools/ffmpeg/clipExtraction.js';

const ffmpegOk = await isFFmpegAvailable();

describe.skipIf(!ffmpegOk)('FFmpeg Pipeline Integration', () => {
  let fix: TestFixtures;
  beforeAll(async () => { fix = await setupFixtures(); }, 30000);
  afterAll(async () => { await cleanupFixtures(); });

  // ── Audio Extraction ──────────────────────────────────────────────
  describe('Audio Extraction', () => {
    it('extracts MP3 audio with non-zero size', async () => {
      const out = path.join(fix.dir, 'output-audio.mp3');
      await extractAudio(fix.videoPath, out);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);
    });

    it('extracted audio duration roughly matches video duration', async () => {
      const out = path.join(fix.dir, 'output-audio-dur.mp3');
      await extractAudio(fix.videoPath, out);
      const videoDur = await getVideoDuration(fix.videoPath);
      const audioDur = await getVideoDuration(out);
      expect(audioDur).toBeCloseTo(videoDur, 0);
    });
  });

  // ── Silence Detection ─────────────────────────────────────────────
  describe('Silence Detection', () => {
    it('returns an array for continuous sine-wave audio', async () => {
      const regions = await detectSilence(fix.audioPath, 0.3, '-50dB');
      expect(Array.isArray(regions)).toBe(true);
    });

    it('detects minimal or no silence in a sine wave', async () => {
      const regions = await detectSilence(fix.audioPath, 0.3, '-50dB');
      // Continuous 440 Hz sine wave should have very little silence
      expect(regions.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Frame Capture ─────────────────────────────────────────────────
  describe('Frame Capture', () => {
    it('captures a single frame at t=1.0s', async () => {
      const out = path.join(fix.dir, 'output-frame-1s.png');
      await captureFrame(fix.videoPath, 1.0, out);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);
    });

    it('captures a frame at t=0.0s (start)', async () => {
      const out = path.join(fix.dir, 'output-frame-0s.png');
      await captureFrame(fix.videoPath, 0.0, out);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);
    });

    it('captures multiple frames at specified timestamps', async () => {
      const outDir = path.join(fix.dir, 'output-frames');
      const results = await captureFrames(fix.videoPath, [0.5, 1.5, 2.5], outDir);
      expect(results).toHaveLength(3);
      for (const filePath of results) {
        const { exists, size } = await fileExistsWithSize(filePath);
        expect(exists).toBe(true);
        expect(size).toBeGreaterThan(0);
      }
    });
  });

  // ── Clip Extraction ───────────────────────────────────────────────
  describe('Clip Extraction', () => {
    it('extracts a clip from 1.0s to 3.0s', async () => {
      const out = path.join(fix.dir, 'output-clip.mp4');
      await extractClip(fix.videoPath, 1.0, 3.0, out, 0);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);
    });

    it('clip duration is approximately 2s', async () => {
      const out = path.join(fix.dir, 'output-clip-dur.mp4');
      await extractClip(fix.videoPath, 1.0, 3.0, out, 0);
      const dur = await getVideoDuration(out);
      // Stream copy (-c copy) snaps to keyframes, so duration may exceed requested range
      expect(dur).toBeGreaterThanOrEqual(1.5);
      expect(dur).toBeLessThanOrEqual(4.0);
    });
  });
});

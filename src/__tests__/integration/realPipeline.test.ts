import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import 'dotenv/config';
import { isFFmpegAvailable, getVideoDuration, fileExistsWithSize } from './fixture.js';
import { extractAudio } from '../../tools/ffmpeg/audioExtraction.js';
import { detectSilence } from '../../tools/ffmpeg/silenceDetection.js';
import { extractClip, extractCompositeClip } from '../../tools/ffmpeg/clipExtraction.js';
import { captureFrame } from '../../tools/ffmpeg/frameCapture.js';
import { singlePassEdit, singlePassEditAndCaption } from '../../tools/ffmpeg/singlePassEdit.js';
import { generateStyledASS } from '../../tools/captions/captionGenerator.js';
import type { Transcript } from '../../types/index.js';

const execFileAsync = promisify(execFile);
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const ffmpegOk = await isFFmpegAvailable();

async function getStreamInfo(filePath: string) {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', filePath,
  ]);
  const types = stdout.trim().split('\n').map(s => s.trim());
  return { hasVideo: types.includes('video'), hasAudio: types.includes('audio') };
}

async function getAudioChannels(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=channels', '-of', 'csv=p=0', filePath,
  ]);
  return parseInt(stdout.trim(), 10);
}

describe.skipIf(!ffmpegOk)('Real Video Pipeline Tests', () => {
  let tempDir: string;
  const fixtureDir = path.join(import.meta.dirname, 'fixtures');
  const videoPath = path.join(fixtureDir, 'sample-speech.mp4');
  const transcriptPath = path.join(fixtureDir, 'sample-speech-transcript.json');
  let transcript: Transcript;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantr-realpipe-'));
    const raw = await fs.readFile(transcriptPath, 'utf-8');
    transcript = JSON.parse(raw) as Transcript;
  }, 30000);

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── Audio Extraction ──────────────────────────────────────────────
  describe('Audio Extraction', () => {
    it('extracts MP3 with non-zero size', async () => {
      const out = path.join(tempDir, 'speech-audio.mp3');
      await extractAudio(videoPath, out);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);
    }, 90000);

    it('audio duration matches video duration (±1s)', async () => {
      const out = path.join(tempDir, 'speech-audio-dur.mp3');
      await extractAudio(videoPath, out);
      const videoDur = await getVideoDuration(videoPath);
      const audioDur = await getVideoDuration(out);
      expect(audioDur).toBeGreaterThanOrEqual(videoDur - 1);
      expect(audioDur).toBeLessThanOrEqual(videoDur + 1);
    }, 90000);

    it('audio is mono (1 channel)', async () => {
      const out = path.join(tempDir, 'speech-audio-mono.mp3');
      await extractAudio(videoPath, out);
      const channels = await getAudioChannels(out);
      expect(channels).toBe(1);
    }, 90000);
  });

  // ── Silence Detection ─────────────────────────────────────────────
  describe('Silence Detection', () => {
    let audioPath: string;

    beforeAll(async () => {
      audioPath = path.join(tempDir, 'silence-detect-audio.mp3');
      await extractAudio(videoPath, audioPath);
    }, 90000);

    it('returns an array of SilenceRegion objects', async () => {
      const regions = await detectSilence(audioPath, 0.3, '-30dB');
      expect(Array.isArray(regions)).toBe(true);
    }, 90000);

    it('each region has valid start < end and duration > 0', async () => {
      const regions = await detectSilence(audioPath, 0.3, '-30dB');
      for (const r of regions) {
        expect(r.start).toBeLessThan(r.end);
        expect(r.duration).toBeGreaterThan(0);
      }
    }, 90000);

    it('regions are within the audio duration range', async () => {
      const duration = await getVideoDuration(audioPath);
      const regions = await detectSilence(audioPath, 0.3, '-30dB');
      for (const r of regions) {
        expect(r.start).toBeGreaterThanOrEqual(0);
        expect(r.end).toBeLessThanOrEqual(duration + 0.5);
      }
    }, 90000);

    it('speech audio has at least some silence between sentences', async () => {
      const regions = await detectSilence(audioPath, 0.3, '-30dB');
      expect(regions.length).toBeGreaterThanOrEqual(1);
    }, 90000);

    it('higher threshold detects more silence than lower threshold', async () => {
      const lowRegions = await detectSilence(audioPath, 0.3, '-40dB');
      const highRegions = await detectSilence(audioPath, 0.3, '-20dB');
      expect(highRegions.length).toBeGreaterThanOrEqual(lowRegions.length);
    }, 90000);
  });

  // ── Clip Extraction ───────────────────────────────────────────────
  describe('Clip Extraction', () => {
    it('extracts a 5-second clip from the middle', async () => {
      const out = path.join(tempDir, 'clip-5s.mp4');
      await extractClip(videoPath, 10, 15, out, 0);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      // Stream copy (-c copy) snaps to keyframes, so duration may exceed requested range
      const dur = await getVideoDuration(out);
      expect(dur).toBeGreaterThanOrEqual(4.5);
      expect(dur).toBeLessThanOrEqual(7.0);

      const streams = await getStreamInfo(out);
      expect(streams.hasVideo).toBe(true);
      expect(streams.hasAudio).toBe(true);
    }, 90000);
  });

  // ── Composite Clip ────────────────────────────────────────────────
  describe('Composite Clip Extraction', () => {
    it('extracts 2 non-contiguous segments and concats', async () => {
      const out = path.join(tempDir, 'composite-clip.mp4');
      const segments = [
        { start: 2, end: 6, description: 'First segment' },
        { start: 14, end: 18, description: 'Second segment' },
      ];
      await extractCompositeClip(videoPath, segments, out, 0);
      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      const dur = await getVideoDuration(out);
      const expectedDur = (6 - 2) + (18 - 14); // 8s total
      expect(dur).toBeGreaterThanOrEqual(expectedDur - 1);
      expect(dur).toBeLessThanOrEqual(expectedDur + 1);

      const streams = await getStreamInfo(out);
      expect(streams.hasVideo).toBe(true);
      expect(streams.hasAudio).toBe(true);
    }, 90000);
  });

  // ── Frame Capture ─────────────────────────────────────────────────
  describe('Frame Capture', () => {
    it('captures frames at multiple timestamps as valid PNGs', async () => {
      const timestamps = [1.0, 10.0, 25.0];
      const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

      for (let i = 0; i < timestamps.length; i++) {
        const out = path.join(tempDir, `frame-${i}.png`);
        await captureFrame(videoPath, timestamps[i], out);

        const { exists, size } = await fileExistsWithSize(out);
        expect(exists).toBe(true);
        expect(size).toBeGreaterThan(0);

        const header = Buffer.alloc(4);
        const fh = await fs.open(out, 'r');
        await fh.read(header, 0, 4, 0);
        await fh.close();
        expect(header.subarray(0, 4).equals(PNG_HEADER)).toBe(true);
      }
    }, 90000);
  });

  // ── Single-Pass Edit ──────────────────────────────────────────────
  describe('Single-Pass Edit', () => {
    it('keeps only 2 segments with correct duration', async () => {
      const out = path.join(tempDir, 'singlepass-edit.mp4');
      const segments = [
        { start: 0, end: 5 },
        { start: 15, end: 20 },
      ];
      await singlePassEdit(videoPath, segments, out);

      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      const dur = await getVideoDuration(out);
      const expectedDur = (5 - 0) + (20 - 15); // 10s
      expect(dur).toBeGreaterThanOrEqual(expectedDur - 0.5);
      expect(dur).toBeLessThanOrEqual(expectedDur + 0.5);

      const streams = await getStreamInfo(out);
      expect(streams.hasVideo).toBe(true);
      expect(streams.hasAudio).toBe(true);
    }, 90000);
  });

  // ── Single-Pass Edit with Captions ────────────────────────────────
  describe('Single-Pass Edit with Captions', () => {
    it('trims and burns captions with matching duration', async () => {
      const segments = [
        { start: 0, end: 5 },
        { start: 15, end: 20 },
      ];

      // Generate ASS captions from the real transcript
      const assContent = generateStyledASS(transcript);
      const assPath = path.join(tempDir, 'real-captions.ass');
      await fs.writeFile(assPath, assContent);

      const out = path.join(tempDir, 'singlepass-captioned.mp4');
      await singlePassEditAndCaption(videoPath, segments, assPath, out);

      const { exists, size } = await fileExistsWithSize(out);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      const dur = await getVideoDuration(out);
      const expectedDur = (5 - 0) + (20 - 15); // 10s
      expect(dur).toBeGreaterThanOrEqual(expectedDur - 0.5);
      expect(dur).toBeLessThanOrEqual(expectedDur + 0.5);

      const streams = await getStreamInfo(out);
      expect(streams.hasVideo).toBe(true);
      expect(streams.hasAudio).toBe(true);
    }, 90000);
  });
});

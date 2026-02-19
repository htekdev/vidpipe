import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupFixtures, cleanupFixtures, isFFmpegAvailable, fileExistsWithSize, getVideoDuration, type TestFixtures } from './fixture.js';
import { generateSRT, generateVTT, generateStyledASS, generateStyledASSForSegment } from '../../L0-pure/captions/captionGenerator.js';
import { burnCaptions } from '../../L2-clients/ffmpeg/captionBurning.js';
import path from 'path';
import { promises as fs } from 'fs';
import type { Transcript } from '../../L0-pure/types/index.js';

const ffmpegOk = await isFFmpegAvailable();

describe.skipIf(!ffmpegOk)('Caption Burn Integration', () => {
  let fix: TestFixtures;
  let transcript: Transcript;

  beforeAll(async () => {
    fix = await setupFixtures();
    const raw = await fs.readFile(fix.transcriptPath, 'utf-8');
    transcript = JSON.parse(raw) as Transcript;
  }, 30000);

  afterAll(async () => { await cleanupFixtures(); });

  // ── 1. Caption Generation ──────────────────────────────────────────────

  describe('Caption Generation', () => {
    it('generateSRT produces valid SRT format', () => {
      const srt = generateSRT(transcript);
      // Numbered cues starting at 1
      expect(srt).toMatch(/^1\n/);
      // SRT timestamps with comma separator
      expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
      // Has at least two cues (matches the two segments)
      expect(srt).toContain('2\n');
    });

    it('generateVTT includes WEBVTT header', () => {
      const vtt = generateVTT(transcript);
      expect(vtt).toMatch(/^WEBVTT/);
      // VTT timestamps with dot separator
      expect(vtt).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}/);
    });

    it('generateStyledASS produces valid ASS with Montserrat font', () => {
      const ass = generateStyledASS(transcript);
      expect(ass).toContain('[Script Info]');
      expect(ass).toContain('Montserrat');
      expect(ass).toMatch(/Dialogue:/);
    });

    it('generateStyledASS with medium style uses smaller font sizes', () => {
      const assDefault = generateStyledASS(transcript, 'shorts');
      const assMedium = generateStyledASS(transcript, 'medium');
      // Medium header has Fontsize 44 vs default 58
      expect(assMedium).toContain('Fontsize');
      // Extract base font size from Style line
      const defaultStyleMatch = assDefault.match(/Style: Default,Montserrat,(\d+)/);
      const mediumStyleMatch = assMedium.match(/Style: Default,Montserrat,(\d+)/);
      expect(defaultStyleMatch).not.toBeNull();
      expect(mediumStyleMatch).not.toBeNull();
      const defaultSize = parseInt(defaultStyleMatch![1], 10);
      const mediumSize = parseInt(mediumStyleMatch![1], 10);
      expect(mediumSize).toBeLessThan(defaultSize);
    });
  });

  // ── 2. Caption Burning with real FFmpeg ────────────────────────────────

  describe('Caption Burning', () => {
    it('burns captions into video producing valid output', async () => {
      const assContent = generateStyledASS(transcript);
      const assPath = path.join(fix.dir, 'real-captions.ass');
      await fs.writeFile(assPath, assContent);

      const outputPath = path.join(fix.dir, 'burned-output.mp4');
      await burnCaptions(fix.videoPath, assPath, outputPath);

      const { exists, size } = await fileExistsWithSize(outputPath);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      const inputDuration = await getVideoDuration(fix.videoPath);
      const outputDuration = await getVideoDuration(outputPath);
      expect(Math.abs(outputDuration - inputDuration)).toBeLessThan(0.5);
    }, 60000);
  });

  // ── 3. Segment-specific captions ───────────────────────────────────────

  describe('Segment-specific captions', () => {
    it('generates captions only for the specified time range', () => {
      const segmentASS = generateStyledASSForSegment(transcript, 0.5, 2.5);
      // With default buffer=1.0, bufferedStart = max(0, 0.5-1) = 0, bufferedEnd = 3.5
      // Words in [0, 3.5]: Hello(0-0.3) world(0.4-0.7) this(0.8-1.0) is(1.1-1.2) a(1.3-1.4) test(1.5-1.9) of(2.5-2.6) the(2.7-2.8) caption(2.9-3.2)
      expect(segmentASS).toContain('Dialogue:');

      // Words outside the buffered range should not appear
      // "system" starts at 3.3, ends at 3.6 — end 3.6 > bufferedEnd 3.5, so excluded
      expect(segmentASS).not.toMatch(/\bsystem\b/);
      // "multiple" and "words" are also outside
      expect(segmentASS).not.toMatch(/\bmultiple\b/);
      expect(segmentASS).not.toMatch(/\bwords\b/);
    });

    it('adjusts ASS Dialogue timestamps relative to segment start', () => {
      const segmentASS = generateStyledASSForSegment(transcript, 0.5, 2.5);
      // bufferedStart = 0, so timestamps should start near 0:00:00.00
      const dialogueLines = segmentASS.split('\n').filter(l => l.startsWith('Dialogue:'));
      expect(dialogueLines.length).toBeGreaterThan(0);

      // First dialogue should start at 0:00:00.00 (Hello word at 0.0 - bufferedStart 0)
      const firstLine = dialogueLines[0];
      expect(firstLine).toMatch(/Dialogue: 0,0:00:00\.00,/);
    });

    it('excludes all words when segment has no matching words', () => {
      // Range 10-11s with buffer=1 → bufferedStart=9, bufferedEnd=12 — no words exist there
      const emptyASS = generateStyledASSForSegment(transcript, 10, 11);
      expect(emptyASS).not.toContain('Dialogue:');
      // Should still have a valid header
      expect(emptyASS).toContain('[Script Info]');
    });
  });
});

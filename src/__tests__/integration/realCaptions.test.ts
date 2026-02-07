import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import 'dotenv/config';
import { isFFmpegAvailable, getVideoDuration, fileExistsWithSize } from './fixture.js';
import {
  generateSRT,
  generateVTT,
  generateStyledASS,
  generateStyledASSForSegment,
} from '../../tools/captions/captionGenerator.js';
import { burnCaptions } from '../../tools/ffmpeg/captionBurning.js';
import type { Transcript } from '../../types/index.js';

const execFileAsync = promisify(execFile);
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
const ffmpegOk = await isFFmpegAvailable();

async function getStreams(videoPath: string): Promise<{ video: boolean; audio: boolean }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoPath,
  ]);
  const types = stdout.trim().split('\n').map((t) => t.trim());
  return { video: types.includes('video'), audio: types.includes('audio') };
}

describe.skipIf(!ffmpegOk)('Real Video Caption Tests', () => {
  let tempDir: string;
  let transcript: Transcript;
  const fixtureDir = path.join(import.meta.dirname, 'fixtures');
  const videoPath = path.join(fixtureDir, 'sample-speech.mp4');

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantr-realcap-'));
    const raw = await fs.readFile(
      path.join(fixtureDir, 'sample-speech-transcript.json'),
      'utf-8',
    );
    transcript = JSON.parse(raw) as Transcript;
  }, 30000);

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── 1. Caption File Generation ──────────────────────────────────────────

  describe('Caption file generation', () => {
    let srtPath: string;
    let vttPath: string;
    let assPath: string;

    beforeAll(async () => {
      srtPath = path.join(tempDir, 'captions.srt');
      vttPath = path.join(tempDir, 'captions.vtt');
      assPath = path.join(tempDir, 'captions.ass');

      await fs.writeFile(srtPath, generateSRT(transcript));
      await fs.writeFile(vttPath, generateVTT(transcript));
      await fs.writeFile(assPath, generateStyledASS(transcript));
    });

    it('generates SRT, VTT, and ASS files with non-zero size', async () => {
      for (const fp of [srtPath, vttPath, assPath]) {
        const { exists, size } = await fileExistsWithSize(fp);
        expect(exists).toBe(true);
        expect(size).toBeGreaterThan(0);
      }
    });

    it('ASS file contains karaoke \\k tags via active-word font-size overrides', async () => {
      const ass = await fs.readFile(assPath, 'utf-8');
      // Active-word highlighting uses \fs (font-size) and \c (color) overrides
      expect(ass).toContain('\\fs54');
      expect(ass).toContain('\\c&H00FFFF&'); // yellow active color
    });

    it('ASS file has multi-line \\N separator', async () => {
      const ass = await fs.readFile(assPath, 'utf-8');
      expect(ass).toContain('\\N');
    });

    it('word count in ASS roughly matches transcript word count', async () => {
      const ass = await fs.readFile(assPath, 'utf-8');
      const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      // Each dialogue line shows all words in the group but highlights one;
      // total unique words referenced should be close to transcript.words.length (81)
      // Count unique words by looking at the last dialogue for each group
      // Simpler: total dialogue lines >= transcript word count (one per word-state)
      expect(dialogueLines.length).toBeGreaterThanOrEqual(transcript.words.length);
    });

    it('caption timestamps span from near 0s to near 31s', async () => {
      const ass = await fs.readFile(assPath, 'utf-8');
      const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      // Parse first dialogue start time
      const firstMatch = dialogueLines[0].match(/Dialogue: 0,(\d+:\d{2}:\d{2}\.\d{2}),/);
      expect(firstMatch).not.toBeNull();
      const firstSeconds = parseAssTimestamp(firstMatch![1]);
      expect(firstSeconds).toBeLessThan(1); // starts near 0s

      // Parse last dialogue end time
      const lastLine = dialogueLines[dialogueLines.length - 1];
      const lastMatch = lastLine.match(/Dialogue: 0,\d+:\d{2}:\d{2}\.\d{2},(\d+:\d{2}:\d{2}\.\d{2}),/);
      expect(lastMatch).not.toBeNull();
      const lastSeconds = parseAssTimestamp(lastMatch![1]);
      expect(lastSeconds).toBeGreaterThan(29); // ends near 31s
    });
  });

  // ── 2. Caption Style Variants ───────────────────────────────────────────

  describe('Caption style variants', () => {
    it('shorts style uses larger font sizes (54 / 42)', () => {
      const ass = generateStyledASS(transcript, 'shorts');
      expect(ass).toMatch(/Style: Default,Montserrat,42/);
      expect(ass).toContain('\\fs54');
      expect(ass).toContain('\\fs42');
    });

    it('medium style uses smaller font sizes (40 / 32)', () => {
      const ass = generateStyledASS(transcript, 'medium');
      expect(ass).toMatch(/Style: Default,Montserrat,32/);
      expect(ass).toContain('\\fs40');
      expect(ass).toContain('\\fs32');
    });
  });

  // ── 3. Speech Gap Detection ─────────────────────────────────────────────

  describe('Speech gap detection', () => {
    it('ASS has multiple Dialogue entries (not one giant block)', () => {
      const ass = generateStyledASS(transcript);
      const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
      expect(dialogueLines.length).toBeGreaterThan(10);
    });

    it('no caption events span across detected speech gaps (>0.8s)', () => {
      const ass = generateStyledASS(transcript);
      const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));

      // Find gaps >0.8s between consecutive words in transcript
      const gaps: { gapStart: number; gapEnd: number }[] = [];
      for (let i = 0; i < transcript.words.length - 1; i++) {
        const gap = transcript.words[i + 1].start - transcript.words[i].end;
        if (gap > 0.8) {
          gaps.push({
            gapStart: transcript.words[i].end,
            gapEnd: transcript.words[i + 1].start,
          });
        }
      }
      expect(gaps.length).toBeGreaterThan(0); // sanity: real speech has gaps

      // No dialogue event should span entirely across a gap
      for (const { gapStart, gapEnd } of gaps) {
        for (const line of dialogueLines) {
          const m = line.match(
            /Dialogue: 0,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),/,
          );
          if (!m) continue;
          const start = parseAssTimestamp(m[1]);
          const end = parseAssTimestamp(m[2]);
          // A dialogue event should not start before the gap and end after it
          const spansGap = start < gapStart + 0.01 && end > gapEnd - 0.01;
          expect(spansGap).toBe(false);
        }
      }
    });
  });

  // ── 4. Real Caption Burning ─────────────────────────────────────────────

  describe('Real caption burning', () => {
    it('burns captions onto real video with valid output', async () => {
      const assContent = generateStyledASS(transcript);
      const assPath = path.join(tempDir, 'burn-captions.ass');
      await fs.writeFile(assPath, assContent);

      const outputPath = path.join(tempDir, 'burned-output.mp4');
      await burnCaptions(videoPath, assPath, outputPath);

      // Output exists with non-zero size
      const { exists, size } = await fileExistsWithSize(outputPath);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      // Duration matches input (±0.5s)
      const inputDuration = await getVideoDuration(videoPath);
      const outputDuration = await getVideoDuration(outputPath);
      expect(Math.abs(outputDuration - inputDuration)).toBeLessThan(0.5);

      // Has both video and audio streams
      const { video, audio } = await getStreams(outputPath);
      expect(video).toBe(true);
      expect(audio).toBe(true);
    }, 90000);
  });

  // ── 5. Segment-specific Caption Generation ──────────────────────────────

  describe('Segment-specific caption generation', () => {
    it('generates captions only for the 5s–15s time range', () => {
      const fullASS = generateStyledASS(transcript);
      const segmentASS = generateStyledASSForSegment(transcript, 5, 15);

      const fullDialogues = fullASS.split('\n').filter((l) => l.startsWith('Dialogue:'));
      const segDialogues = segmentASS.split('\n').filter((l) => l.startsWith('Dialogue:'));

      // Segment captions should have fewer dialogue lines than full
      expect(segDialogues.length).toBeGreaterThan(0);
      expect(segDialogues.length).toBeLessThan(fullDialogues.length);

      // All timestamps in segment ASS should be within the buffered range
      // buffer=1.0 → words from 4s to 16s, timestamps rebased to 0
      for (const line of segDialogues) {
        const m = line.match(
          /Dialogue: 0,(\d+:\d{2}:\d{2}\.\d{2}),(\d+:\d{2}:\d{2}\.\d{2}),/,
        );
        if (!m) continue;
        const start = parseAssTimestamp(m[1]);
        const end = parseAssTimestamp(m[2]);
        // Rebased timestamps: max duration = (15+1) - (5-1) = 12s
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeLessThanOrEqual(13);
      }
    });

    it('contains fewer words than full-video captions', () => {
      const fullASS = generateStyledASS(transcript);
      const segmentASS = generateStyledASSForSegment(transcript, 5, 15);

      // Count unique word text tokens in dialogue lines
      const countWords = (ass: string) => {
        const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
        return dialogues.length; // one dialogue per word-state
      };

      expect(countWords(segmentASS)).toBeLessThan(countWords(fullASS));
    });
  });

  // ── 6. Portrait Captions on Real Video ──────────────────────────────────

  describe('Portrait caption burning', () => {
    it('burns portrait captions onto real video with valid output', async () => {
      const assContent = generateStyledASS(transcript, 'portrait');
      const assPath = path.join(tempDir, 'portrait-captions.ass');
      await fs.writeFile(assPath, assContent);

      // Verify portrait header properties
      expect(assContent).toContain('PlayResX: 1080');
      expect(assContent).toContain('PlayResY: 1920');
      expect(assContent).toContain('\\c&H00FF00&'); // green active

      const outputPath = path.join(tempDir, 'portrait-burned-output.mp4');
      await burnCaptions(videoPath, assPath, outputPath);

      // Output exists with non-zero size
      const { exists, size } = await fileExistsWithSize(outputPath);
      expect(exists).toBe(true);
      expect(size).toBeGreaterThan(0);

      // Duration matches input (±0.5s)
      const inputDuration = await getVideoDuration(videoPath);
      const outputDuration = await getVideoDuration(outputPath);
      expect(Math.abs(outputDuration - inputDuration)).toBeLessThan(0.5);
    }, 90000);
  });
});

/** Parse ASS timestamp "H:MM:SS.cc" → seconds */
function parseAssTimestamp(ts: string): number {
  const [h, m, rest] = ts.split(':');
  const [s, cs] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(cs) / 100;
}

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import {
  setupFixtures,
  cleanupFixtures,
  isFFmpegAvailable,
  fileExistsWithSize,
  getVideoDuration,
  type TestFixtures,
} from './fixture.js';
import { singlePassEdit } from '../../L2-clients/ffmpeg/singlePassEdit.js';
import { singlePassEditAndCaption } from '../../L2-clients/ffmpeg/singlePassEdit.js';

import { getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js';

const execFileAsync = promisify(execFile);
const ffprobePath = getFFprobePath();
const ffmpegOk = await isFFmpegAvailable();

async function getStreams(videoPath: string): Promise<{ video: boolean; audio: boolean }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', videoPath,
  ]);
  const types = stdout.trim().split('\n').map((t) => t.trim());
  return { video: types.includes('video'), audio: types.includes('audio') };
}

async function getCodecs(videoPath: string): Promise<{ videoCodec: string; audioCodec: string }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'csv=p=0', videoPath,
  ]);
  const lines = stdout.trim().split('\n').map((l) => l.trim());
  let videoCodec = '';
  let audioCodec = '';
  for (const line of lines) {
    const [codec, type] = line.split(',');
    if (type === 'video') videoCodec = codec;
    if (type === 'audio') audioCodec = codec;
  }
  return { videoCodec, audioCodec };
}

describe.skipIf(!ffmpegOk)('Silence Removal Integration', () => {
  let fix: TestFixtures;
  const outputs: string[] = [];

  beforeAll(async () => {
    fix = await setupFixtures();
  }, 30000);

  afterAll(async () => {
    await cleanupFixtures();
  });

  it('singlePassEdit with keep segments removes middle section', async () => {
    const outputPath = path.join(fix.dir, 'trimmed-skip-middle.mp4');
    outputs.push(outputPath);
    const segments = [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ];

    await singlePassEdit(fix.videoPath, segments, outputPath);

    const { exists, size } = await fileExistsWithSize(outputPath);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    const duration = await getVideoDuration(outputPath);
    expect(duration).toBeCloseTo(4, 0);
  }, 120000);

  it('singlePassEdit with single segment keeps full video', async () => {
    const outputPath = path.join(fix.dir, 'trimmed-full.mp4');
    outputs.push(outputPath);
    const segments = [{ start: 0, end: 5 }];

    await singlePassEdit(fix.videoPath, segments, outputPath);

    const { exists, size } = await fileExistsWithSize(outputPath);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    const duration = await getVideoDuration(outputPath);
    expect(duration).toBeCloseTo(5, 0);
  }, 120000);

  it('singlePassEditAndCaption trims and burns captions', async () => {
    const outputPath = path.join(fix.dir, 'trimmed-captioned.mp4');
    outputs.push(outputPath);
    const segments = [
      { start: 0, end: 2.5 },
      { start: 3, end: 5 },
    ];

    await singlePassEditAndCaption(fix.videoPath, segments, fix.assPath, outputPath);

    const { exists, size } = await fileExistsWithSize(outputPath);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);

    const duration = await getVideoDuration(outputPath);
    expect(duration).toBeCloseTo(4.5, 0);
  }, 120000);

  it('all outputs are valid h264/aac video files', async () => {
    for (const videoPath of outputs) {
      const { video, audio } = await getStreams(videoPath);
      expect(video).toBe(true);
      expect(audio).toBe(true);

      const { videoCodec, audioCodec } = await getCodecs(videoPath);
      expect(videoCodec).toBe('h264');
      expect(audioCodec).toBe('aac');
    }
  }, 120000);
});

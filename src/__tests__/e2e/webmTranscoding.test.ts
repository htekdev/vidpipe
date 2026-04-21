import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { isFFmpegAvailable, fileExistsWithSize, getVideoDuration } from './fixture.js';
import { getFFmpegPath } from '../../L2-clients/ffmpeg/ffmpeg.js';
import { transcodeToMp4 } from '../../L2-clients/ffmpeg/transcoding.js';

const execFileAsync = promisify(execFile);
const ffmpegPath = getFFmpegPath();
const ffmpegOk = await isFFmpegAvailable();

async function findAvailableEncoder(encoders: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], { timeout: 30_000 });
    return encoders.find((encoder) => stdout.includes(encoder)) ?? null;
  } catch {
    return null;
  }
}

const webmVideoEncoder = await findAvailableEncoder(['libvpx', 'libvpx-vp9']);
const webmAudioEncoder = await findAvailableEncoder(['libvorbis', 'libopus']);

async function generateSyntheticWebm(outputPath: string): Promise<void> {
  const videoEncoder = webmVideoEncoder;
  const audioEncoder = webmAudioEncoder;

  if (!videoEncoder || !audioEncoder) {
    throw new Error('FFmpeg does not provide the required WebM encoders for this test.');
  }

  const args = [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', videoEncoder,
    ...(videoEncoder === 'libvpx-vp9' ? ['-b:v', '0', '-crf', '33'] : ['-b:v', '500k']),
    '-c:a', audioEncoder,
    '-b:a', '64k',
    '-shortest',
    outputPath,
  ];

  await execFileAsync(ffmpegPath, args, { timeout: 30_000 });
}

describe.skipIf(!ffmpegOk || !webmVideoEncoder || !webmAudioEncoder)('WebM Transcoding E2E', () => {
  let tmpDir = '';
  let webmPath = '';

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantr-webm-'));
    webmPath = path.join(tmpDir, 'test.webm');
    await generateSyntheticWebm(webmPath);
  }, 30_000);

  afterAll(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('transcodes WebM to valid MP4', async () => {
    const mp4Path = path.join(tmpDir, 'output.mp4');
    const result = await transcodeToMp4(webmPath, mp4Path);

    expect(result).toBe(mp4Path);
    const { exists, size } = await fileExistsWithSize(mp4Path);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(0);
  }, 30_000);

  it('transcoded MP4 has correct duration', async () => {
    const mp4Path = path.join(tmpDir, 'output.mp4');
    const { exists } = await fileExistsWithSize(mp4Path);

    if (!exists) {
      await transcodeToMp4(webmPath, mp4Path);
    }

    const duration = await getVideoDuration(mp4Path);
    expect(duration).toBeGreaterThanOrEqual(2.5);
    expect(duration).toBeLessThanOrEqual(4.0);
  }, 30_000);

  it('transcoded MP4 uses yuv420p pixel format for player compatibility', async () => {
    const mp4Path = path.join(tmpDir, 'output.mp4');
    const { exists } = await fileExistsWithSize(mp4Path);

    if (!exists) {
      await transcodeToMp4(webmPath, mp4Path);
    }

    // ffmpeg -i prints stream info to stderr (exits with code 1 when no output specified)
    const { stderr } = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', mp4Path], { timeout: 10_000 })
      .catch((e: any) => ({ stdout: '', stderr: e.stderr ?? '' }));
    expect(stderr).toContain('yuv420p');
  }, 30_000);
});

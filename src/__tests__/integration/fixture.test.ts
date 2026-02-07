import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupFixtures, cleanupFixtures, isFFmpegAvailable, fileExistsWithSize, type TestFixtures } from './fixture.js';

const ffmpegOk = await isFFmpegAvailable();

describe.skipIf(!ffmpegOk)('Test Fixtures', () => {
  let fix: TestFixtures;

  beforeAll(async () => { fix = await setupFixtures(); }, 30000);
  afterAll(async () => { await cleanupFixtures(); });

  it('generates test video', async () => {
    const { exists, size } = await fileExistsWithSize(fix.videoPath);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(1000);
  });

  it('generates test audio', async () => {
    const { exists, size } = await fileExistsWithSize(fix.audioPath);
    expect(exists).toBe(true);
    expect(size).toBeGreaterThan(100);
  });

  it('generates transcript JSON', async () => {
    const { exists } = await fileExistsWithSize(fix.transcriptPath);
    expect(exists).toBe(true);
  });

  it('generates ASS captions', async () => {
    const { exists } = await fileExistsWithSize(fix.assPath);
    expect(exists).toBe(true);
  });
});

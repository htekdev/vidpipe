import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Path to the actual test fixture video
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_VIDEO_PATH = path.join(__dirname, 'fixtures', 'sample-speech.mp4');
const FIXTURE_TRANSCRIPT_PATH = path.join(__dirname, 'fixtures', 'sample-speech-transcript.json');

// Test imports
import {
  captureFrame,
  getVideoInfo,
  readTranscript,
  getChapters,
  runFfmpeg,
  generateImage,
} from '../../L4-agents/agentTools.js';
import { getFFmpegPath, getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js';

// Check if FFmpeg is available
async function isFFmpegAvailable(): Promise<boolean> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync(getFFmpegPath(), ['-version']);
    return true;
  } catch {
    return false;
  }
}

const ffmpegAvailable = await isFFmpegAvailable();

// ============================================================================
// captureFrame tests
// ============================================================================
describe.skipIf(!ffmpegAvailable)('captureFrame', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentTools-test-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('captures a frame from a video at given timestamp', async () => {
    const result = await captureFrame(FIXTURE_VIDEO_PATH, 1.0);
    expect(result.imagePath).toBeDefined();
    expect(result.imagePath).toContain('.jpg');

    // Verify file exists and has content
    const stats = await fs.stat(result.imagePath);
    expect(stats.size).toBeGreaterThan(100);

    // Cleanup
    await fs.unlink(result.imagePath).catch(() => {});
  }, 15000);

  it('captures a frame at timestamp 0', async () => {
    const result = await captureFrame(FIXTURE_VIDEO_PATH, 0);
    expect(result.imagePath).toBeDefined();

    const stats = await fs.stat(result.imagePath);
    expect(stats.size).toBeGreaterThan(100);

    await fs.unlink(result.imagePath).catch(() => {});
  }, 15000);

  it('throws error for non-existent video', async () => {
    await expect(captureFrame('/nonexistent/video.mp4', 1.0)).rejects.toThrow();
  });

  it('throws error for timestamp beyond video duration', async () => {
    // Video is ~32 seconds, timestamp 10000 should fail
    await expect(captureFrame(FIXTURE_VIDEO_PATH, 10000)).rejects.toThrow();
  }, 15000);
});

// ============================================================================
// getVideoInfo tests
// ============================================================================
describe.skipIf(!ffmpegAvailable)('getVideoInfo', () => {
  it('extracts video dimensions and duration', async () => {
    const info = await getVideoInfo(FIXTURE_VIDEO_PATH);

    expect(info.width).toBeGreaterThan(0);
    expect(info.height).toBeGreaterThan(0);
    expect(info.duration).toBeGreaterThan(0);
    expect(info.fps).toBeGreaterThan(0);

    // sample-speech.mp4 is a real video, verify reasonable values
    expect(info.width).toBeGreaterThanOrEqual(320);
    expect(info.height).toBeGreaterThanOrEqual(180);
    expect(info.duration).toBeGreaterThan(20); // Video is ~32 seconds
  }, 10000);

  it('throws error for non-existent video', async () => {
    await expect(getVideoInfo('/nonexistent/video.mp4')).rejects.toThrow('Failed to get video info');
  });

  it('returns valid fps even for variable framerate video', async () => {
    const info = await getVideoInfo(FIXTURE_VIDEO_PATH);
    expect(Number.isFinite(info.fps)).toBe(true);
    expect(info.fps).toBeGreaterThan(0);
    expect(info.fps).toBeLessThan(120); // Reasonable upper bound
  }, 10000);
});

// ============================================================================
// readTranscript tests
// ============================================================================
describe('readTranscript', () => {
  let tempDir: string;
  let transcriptPath: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentTools-transcript-'));
    transcriptPath = path.join(tempDir, 'transcript.json');

    // Create a test transcript
    const transcript = {
      text: 'Hello world this is a test',
      words: [
        { word: 'Hello ', start: 0.0, end: 0.5 },
        { word: 'world ', start: 0.5, end: 1.0 },
        { word: 'this ', start: 1.0, end: 1.5 },
        { word: 'is ', start: 1.5, end: 2.0 },
        { word: 'a ', start: 2.0, end: 2.5 },
        { word: 'test', start: 2.5, end: 3.0 },
      ],
    };
    await fs.writeFile(transcriptPath, JSON.stringify(transcript));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reads entire transcript without time filtering', async () => {
    const result = await readTranscript(transcriptPath);
    expect(result.text).toBe('Hello world this is a test');
    expect(result.words).toHaveLength(6);
  });

  it('filters words by start time', async () => {
    const result = await readTranscript(transcriptPath, 1.0);
    // Words starting at or after 1.0s
    expect(result.words.length).toBeLessThan(6);
    expect(result.words.every(w => w.start >= 1.0)).toBe(true);
  });

  it('filters words by end time', async () => {
    const result = await readTranscript(transcriptPath, undefined, 2.0);
    // Words ending at or before 2.0s
    expect(result.words.length).toBeLessThan(6);
    expect(result.words.every(w => w.end <= 2.0)).toBe(true);
  });

  it('filters words by both start and end time', async () => {
    const result = await readTranscript(transcriptPath, 1.0, 2.5);
    // Words between 1.0s and 2.5s
    expect(result.words.every(w => w.start >= 1.0 && w.end <= 2.5)).toBe(true);
  });

  it('returns empty array when no words match time range', async () => {
    const result = await readTranscript(transcriptPath, 100, 200);
    expect(result.words).toHaveLength(0);
    expect(result.text).toBe('');
  });

  it('handles transcript with no words array', async () => {
    const emptyTranscriptPath = path.join(tempDir, 'empty.json');
    await fs.writeFile(emptyTranscriptPath, JSON.stringify({ text: 'No words' }));

    const result = await readTranscript(emptyTranscriptPath);
    expect(result.words).toHaveLength(0);
  });

  it('works with real fixture transcript', async () => {
    const result = await readTranscript(FIXTURE_TRANSCRIPT_PATH);
    expect(result.words.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('throws error for non-existent file', async () => {
    await expect(readTranscript('/nonexistent/transcript.json')).rejects.toThrow();
  });
});

// ============================================================================
// getChapters tests
// ============================================================================
describe('getChapters', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentTools-chapters-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('reads chapters from JSON file', async () => {
    const chaptersPath = path.join(tempDir, 'chapters.json');
    const chapters = [
      { timestamp: 0, title: 'Introduction' },
      { timestamp: 60, title: 'Main Content' },
      { timestamp: 180, title: 'Conclusion' },
    ];
    await fs.writeFile(chaptersPath, JSON.stringify(chapters));

    const result = await getChapters(chaptersPath);
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0]).toEqual({ time: 0, title: 'Introduction' });
    expect(result.chapters[1]).toEqual({ time: 60, title: 'Main Content' });
    expect(result.chapters[2]).toEqual({ time: 180, title: 'Conclusion' });
  });

  it('handles empty chapters array', async () => {
    const chaptersPath = path.join(tempDir, 'empty-chapters.json');
    await fs.writeFile(chaptersPath, JSON.stringify([]));

    const result = await getChapters(chaptersPath);
    expect(result.chapters).toHaveLength(0);
  });

  it('throws error for non-existent file', async () => {
    await expect(getChapters('/nonexistent/chapters.json')).rejects.toThrow();
  });

  it('throws error for invalid JSON', async () => {
    const invalidPath = path.join(tempDir, 'invalid.json');
    await fs.writeFile(invalidPath, 'not valid json');

    await expect(getChapters(invalidPath)).rejects.toThrow();
  });
});

// ============================================================================
// runFfmpeg tests
// ============================================================================
describe.skipIf(!ffmpegAvailable)('runFfmpeg', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentTools-ffmpeg-'));
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('runs a simple ffmpeg command successfully', async () => {
    const outputPath = path.join(tempDir, 'output.mp4');
    const result = await runFfmpeg([
      '-i', FIXTURE_VIDEO_PATH,
      '-t', '1',
      '-c', 'copy',
      '-y',
      outputPath,
    ]);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.error).toBeUndefined();

    // Verify output file exists
    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000);

  it('returns error for invalid ffmpeg arguments', async () => {
    const result = await runFfmpeg([
      '-i', '/nonexistent/video.mp4',
      '-y',
      path.join(tempDir, 'fail.mp4'),
    ]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  }, 15000);

  it('extracts audio from video', async () => {
    const outputPath = path.join(tempDir, 'audio.mp3');
    const result = await runFfmpeg([
      '-i', FIXTURE_VIDEO_PATH,
      '-t', '1',
      '-vn',
      '-acodec', 'libmp3lame',
      '-b:a', '64k',
      '-y',
      outputPath,
    ]);

    expect(result.success).toBe(true);
    expect(result.outputPath).toBe(outputPath);

    const stats = await fs.stat(outputPath);
    expect(stats.size).toBeGreaterThan(0);
  }, 30000);

  it('handles commands with only flags (no output path)', async () => {
    // Just request version info
    const result = await runFfmpeg(['-version']);
    expect(result.success).toBe(true);
    // No output path for version-only command (all args start with -)
    expect(result.outputPath).toBeUndefined();
  }, 10000);
});

// ============================================================================
// generateImage tests (placeholder)
// ============================================================================
describe('generateImage', () => {
  it('throws not implemented error', async () => {
    await expect(
      generateImage('a sunset over mountains', 'vivid', '1024x1024'),
    ).rejects.toThrow('generateImage is not yet implemented');
  });

  it('includes prompt, style, and size in error message', async () => {
    await expect(
      generateImage('test prompt here', 'natural', '1792x1024'),
    ).rejects.toThrow(/test prompt/);
  });
});

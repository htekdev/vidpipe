import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { promisify } from 'util';
import 'dotenv/config';

const execFileAsync = promisify(execFile);

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';

export interface TestFixtures {
  dir: string;           // temp directory for all fixtures
  videoPath: string;     // 3-second test video with audio
  audioPath: string;     // extracted audio from test video
  transcriptPath: string; // mock transcript JSON
  assPath: string;       // mock ASS caption file
}

let fixtures: TestFixtures | null = null;

export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath, ['-version']);
    return true;
  } catch { return false; }
}

export async function setupFixtures(): Promise<TestFixtures> {
  if (fixtures) return fixtures;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantr-integ-'));
  const videoPath = path.join(dir, 'test.mp4');
  const audioPath = path.join(dir, 'test.mp3');
  const transcriptPath = path.join(dir, 'transcript.json');
  const assPath = path.join(dir, 'captions.ass');

  // Generate 5-second synthetic video: test pattern + sine wave audio
  await execFileAsync(ffmpegPath, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=5:size=640x480:rate=25',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '64k',
    '-shortest',
    videoPath,
  ], { timeout: 30000 });

  // Extract audio
  await execFileAsync(ffmpegPath, [
    '-y', '-i', videoPath,
    '-vn', '-acodec', 'libmp3lame', '-b:a', '64k',
    audioPath,
  ], { timeout: 15000 });

  // Create mock transcript with word-level timestamps
  const transcript = {
    text: 'Hello world this is a test of the caption system with multiple words',
    language: 'english',
    segments: [
      { id: 0, start: 0.0, end: 2.0, text: 'Hello world this is a test' },
      { id: 1, start: 2.5, end: 4.5, text: 'of the caption system with multiple words' },
    ],
    words: [
      { word: 'Hello', start: 0.0, end: 0.3 },
      { word: 'world', start: 0.4, end: 0.7 },
      { word: 'this', start: 0.8, end: 1.0 },
      { word: 'is', start: 1.1, end: 1.2 },
      { word: 'a', start: 1.3, end: 1.4 },
      { word: 'test', start: 1.5, end: 1.9 },
      { word: 'of', start: 2.5, end: 2.6 },
      { word: 'the', start: 2.7, end: 2.8 },
      { word: 'caption', start: 2.9, end: 3.2 },
      { word: 'system', start: 3.3, end: 3.6 },
      { word: 'with', start: 3.7, end: 3.9 },
      { word: 'multiple', start: 4.0, end: 4.2 },
      { word: 'words', start: 4.3, end: 4.5 },
    ],
  };
  await fs.writeFile(transcriptPath, JSON.stringify(transcript, null, 2));

  // Create a minimal ASS caption file
  const assContent = `[Script Info]
Title: Test captions
ScriptType: v4.00+
PlayResX: 640
PlayResY: 480

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,24,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Hello world this is a test
Dialogue: 0,0:00:02.50,0:00:04.50,Default,,0,0,0,,of the caption system
`;
  await fs.writeFile(assPath, assContent);

  fixtures = { dir, videoPath, audioPath, transcriptPath, assPath };
  return fixtures;
}

export async function cleanupFixtures(): Promise<void> {
  if (fixtures) {
    await fs.rm(fixtures.dir, { recursive: true, force: true }).catch(() => {});
    fixtures = null;
  }
}

/** Get video duration via ffprobe */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath,
  ]);
  return parseFloat(stdout.trim());
}

/** Check if file exists and has non-zero size */
export async function fileExistsWithSize(filePath: string): Promise<{ exists: boolean; size: number }> {
  try {
    const stat = await fs.stat(filePath);
    return { exists: true, size: stat.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

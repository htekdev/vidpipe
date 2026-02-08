import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import logger from '../../config/logger';
import { getFFmpegPath, getFFprobePath } from '../../config/ffmpegResolver.js';

const ffmpegPath = getFFmpegPath();
const ffprobePath = getFFprobePath();
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Extract a single PNG frame at the given timestamp (seconds).
 */
export async function captureFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string,
): Promise<string> {
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  logger.info(`Capturing frame at ${timestamp}s → ${outputPath}`);

  return new Promise<string>((resolve, reject) => {
    ffmpeg(videoPath)
      .seekInput(timestamp)
      .frames(1)
      .output(outputPath)
      .on('end', () => {
        logger.info(`Frame captured: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error(`Frame capture failed: ${err.message}`);
        reject(new Error(`Frame capture failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Extract multiple frames at the given timestamps.
 * Files are named snapshot-001.png, snapshot-002.png, etc.
 */
export async function captureFrames(
  videoPath: string,
  timestamps: number[],
  outputDir: string,
): Promise<string[]> {
  await fs.mkdir(outputDir, { recursive: true });

  const results: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const idx = String(i + 1).padStart(3, '0');
    const outputPath = path.join(outputDir, `snapshot-${idx}.png`);
    await captureFrame(videoPath, timestamps[i], outputPath);
    results.push(outputPath);
  }

  logger.info(`Captured ${results.length} frames in ${outputDir}`);
  return results;
}

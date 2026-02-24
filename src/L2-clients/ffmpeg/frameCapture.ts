import { createFFmpeg } from './ffmpeg.js'
import { ensureDirectory } from '../../L1-infra/fileSystem/fileSystem.js'
import { dirname, join } from '../../L1-infra/paths/paths.js'
import logger from '../../L1-infra/logger/configLogger'

/**
 * Extract a single PNG frame at the given timestamp (seconds).
 */
export async function captureFrame(
  videoPath: string,
  timestamp: number,
  outputPath: string,
): Promise<string> {
  const outputDir = dirname(outputPath);
  await ensureDirectory(outputDir);

  logger.info(`Capturing frame at ${timestamp}s → ${outputPath}`);

  return new Promise<string>((resolve, reject) => {
    createFFmpeg(videoPath)
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
  await ensureDirectory(outputDir);

  const results: string[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const idx = String(i + 1).padStart(3, '0');
    const outputPath = join(outputDir, `snapshot-${idx}.png`);
    await captureFrame(videoPath, timestamps[i], outputPath);
    results.push(outputPath);
  }

  logger.info(`Captured ${results.length} frames in ${outputDir}`);
  return results;
}

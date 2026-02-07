import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import pathMod from 'path';
import logger from '../../config/logger';
import { ShortSegment } from '../../types';

const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobePath = process.env.FFPROBE_PATH || 'ffprobe';
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/**
 * Extract a single clip segment using stream copy (-c copy) for speed.
 * @param buffer Seconds of padding added before start and after end (default 1.0)
 */
export async function extractClip(
  videoPath: string,
  start: number,
  end: number,
  outputPath: string,
  buffer: number = 1.0,
): Promise<string> {
  const outputDir = pathMod.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const bufferedStart = Math.max(0, start - buffer);
  const bufferedEnd = end + buffer;
  const duration = bufferedEnd - bufferedStart;
  logger.info(`Extracting clip [${start}s–${end}s] (buffered: ${bufferedStart.toFixed(2)}s–${bufferedEnd.toFixed(2)}s) → ${outputPath}`);

  return new Promise<string>((resolve, reject) => {
    ffmpeg(videoPath)
      .setStartTime(bufferedStart)
      .setDuration(duration)
      .outputOptions('-c copy')
      .outputOptions('-avoid_negative_ts make_zero')
      .output(outputPath)
      .on('end', () => {
        logger.info(`Clip extraction complete: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error(`Clip extraction failed: ${err.message}`);
        reject(new Error(`Clip extraction failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Extract multiple non-contiguous segments and concatenate them into one clip.
 * Each segment is padded by `buffer` seconds on both sides for smoother cuts.
 * Re-encodes and uses concat demuxer for clean joins.
 * @param buffer Seconds of padding added before start and after end of each segment (default 1.0)
 */
export async function extractCompositeClip(
  videoPath: string,
  segments: ShortSegment[],
  outputPath: string,
  buffer: number = 1.0,
): Promise<string> {
  if (!segments || segments.length === 0) {
    throw new Error('At least one segment is required');
  }

  if (segments.length === 1) {
    return extractClip(videoPath, segments[0].start, segments[0].end, outputPath, buffer);
  }

  const outputDir = pathMod.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  const tempDir = pathMod.join(outputDir, `.temp-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const tempFiles: string[] = [];

  try {
    // Extract each segment to a temp file (re-encode for reliable concat)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const tempPath = pathMod.join(tempDir, `segment-${i}.mp4`);
      tempFiles.push(tempPath);

      const bufferedStart = Math.max(0, seg.start - buffer);
      const bufferedEnd = seg.end + buffer;
      logger.info(`Extracting segment ${i + 1}/${segments.length} [${seg.start}s–${seg.end}s] (buffered: ${bufferedStart.toFixed(2)}s–${bufferedEnd.toFixed(2)}s)`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(bufferedStart)
          .setDuration(bufferedEnd - bufferedStart)
          .outputOptions(['-threads', '4', '-preset', 'ultrafast'])
          .output(tempPath)
          .on('end', () => resolve())
          .on('error', (err) => reject(new Error(`Segment ${i} extraction failed: ${err.message}`)))
          .run();
      });
    }

    // Build concat list file
    const concatListPath = pathMod.join(tempDir, 'concat-list.txt');
    const listContent = tempFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(concatListPath, listContent);

    // Concatenate segments (re-encode for clean joins across buffered segments)
    logger.info(`Concatenating ${segments.length} segments → ${outputPath}`);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-threads', '4', '-c:a', 'aac'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Concat failed: ${err.message}`)))
        .run();
    });

    logger.info(`Composite clip complete: ${outputPath}`);
    return outputPath;
  } finally {
    // Clean up temp files
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'child_process';
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

/**
 * Extract multiple non-contiguous segments and concatenate them with crossfade
 * transitions using FFmpeg xfade/acrossfade filters.
 * Falls back to extractCompositeClip if only one segment is provided.
 *
 * @param transitionDuration Crossfade duration in seconds (default 0.5)
 * @param buffer Seconds of padding added before/after each segment (default 1.0)
 */
export async function extractCompositeClipWithTransitions(
  videoPath: string,
  segments: ShortSegment[],
  outputPath: string,
  transitionDuration: number = 0.5,
  buffer: number = 1.0,
): Promise<string> {
  if (!segments || segments.length === 0) {
    throw new Error('At least one segment is required');
  }

  // Single segment — no transitions needed
  if (segments.length === 1) {
    return extractClip(videoPath, segments[0].start, segments[0].end, outputPath, buffer);
  }

  // Two segments — no transitions needed, use regular composite
  if (segments.length === 2 && transitionDuration <= 0) {
    return extractCompositeClip(videoPath, segments, outputPath, buffer);
  }

  const outputDir = pathMod.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Build filter_complex for xfade transitions between segments
  const filterParts: string[] = [];
  const segDurations: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const bufferedStart = Math.max(0, seg.start - buffer);
    const bufferedEnd = seg.end + buffer;
    const duration = bufferedEnd - bufferedStart;
    segDurations.push(duration);

    filterParts.push(
      `[0:v]trim=start=${bufferedStart.toFixed(3)}:end=${bufferedEnd.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
    );
    filterParts.push(
      `[0:a]atrim=start=${bufferedStart.toFixed(3)}:end=${bufferedEnd.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`,
    );
  }

  // Chain xfade transitions: [v0][v1]xfade → [xv0]; [xv0][v2]xfade → [xv1]; ...
  let prevVideo = 'v0';
  let prevAudio = 'a0';
  let cumulativeDuration = segDurations[0];

  for (let i = 1; i < segments.length; i++) {
    const offset = Math.max(0, cumulativeDuration - transitionDuration);
    const outVideo = i === segments.length - 1 ? 'vout' : `xv${i - 1}`;
    const outAudio = i === segments.length - 1 ? 'aout' : `xa${i - 1}`;

    filterParts.push(
      `[${prevVideo}][v${i}]xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${outVideo}]`,
    );
    filterParts.push(
      `[${prevAudio}][a${i}]acrossfade=d=${transitionDuration.toFixed(3)}[${outAudio}]`,
    );

    prevVideo = outVideo;
    prevAudio = outAudio;
    // After xfade, the combined duration shrinks by transitionDuration
    cumulativeDuration = cumulativeDuration - transitionDuration + segDurations[i];
  }

  const filterComplex = filterParts.join(';\n');

  const args = [
    '-y',
    '-i', videoPath,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-threads', '4',
    '-c:a', 'aac',
    '-b:a', '128k',
    outputPath,
  ];

  logger.info(`[ClipExtraction] Compositing ${segments.length} segments with xfade transitions → ${outputPath}`);

  return new Promise<string>((resolve, reject) => {
    execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error(`[ClipExtraction] xfade composite failed: ${stderr}`);
        reject(new Error(`xfade composite clip failed: ${error.message}`));
        return;
      }
      logger.info(`[ClipExtraction] xfade composite complete: ${outputPath}`);
      resolve(outputPath);
    });
  });
}

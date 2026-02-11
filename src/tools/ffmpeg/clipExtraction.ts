import ffmpeg from 'fluent-ffmpeg';
import { execFile } from 'child_process';
import { promises as fs, closeSync } from 'fs';
import pathMod from 'path';
import tmp from 'tmp';

import logger from '../../config/logger';
import { ShortSegment } from '../../types';
import { getFFmpegPath, getFFprobePath } from '../../config/ffmpegResolver.js';

const ffmpegPath = getFFmpegPath();
const ffprobePath = getFFprobePath();
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const DEFAULT_FPS = 25;

/**
 * Probe the source video's frame rate using ffprobe.
 * Returns a rounded integer fps, or DEFAULT_FPS if probing fails.
 * Needed because FFmpeg 7.x xfade requires constant-framerate inputs.
 */
async function getVideoFps(videoPath: string): Promise<number> {
  return new Promise<number>((resolve) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'csv=p=0', videoPath],
      { timeout: 5000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(DEFAULT_FPS);
          return;
        }
        const parts = stdout.trim().split('/');
        const fps = parts.length === 2 ? parseInt(parts[0]) / parseInt(parts[1]) : parseFloat(stdout.trim());
        resolve(isFinite(fps) && fps > 0 ? Math.round(fps) : DEFAULT_FPS);
      },
    );
  });
}

/**
 * Extract a single clip segment using re-encode for frame-accurate timing.
 *
 * ### Why re-encode instead of `-c copy`?
 * Stream copy (`-c copy`) seeks to the nearest **keyframe** before the
 * requested start time, which creates a PTS offset between the clip's actual
 * start and the timestamp the caption generator assumes.  This causes
 * captions to be out of sync with the audio — especially visible in
 * landscape-captioned shorts where there's no intermediate re-encode to
 * normalize PTS (the portrait path gets an extra re-encode via aspect-ratio
 * conversion which masks the issue).
 *
 * Re-encoding with `trim` + `setpts=PTS-STARTPTS` guarantees:
 * - The clip starts at **exactly** `bufferedStart` (not the nearest keyframe)
 * - Output PTS starts at 0 with no offset
 * - Caption timestamps align perfectly with both audio and video
 *
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
      .outputOptions(['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-threads', '4', '-c:a', 'aac', '-b:a', '128k'])
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

  const tempDirObj = tmp.dirSync({ unsafeCleanup: true, prefix: 'vidpipe-' });
  const tempDir = tempDirObj.name;

  const tempFiles: string[] = [];
  let concatListFile: tmp.FileResult | null = null;

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
    concatListFile = tmp.fileSync({ dir: tempDir, postfix: '.txt', prefix: 'concat-' });
    const concatListPath = concatListFile.name;
    const listContent = tempFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(concatListPath, listContent);
    // Close file descriptor to avoid leaks on Windows
    closeSync(concatListFile.fd);

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
    // Clean up temp files and remove callbacks
    if (concatListFile) {
      try {
        concatListFile.removeCallback();
      } catch {}
    }
    try {
      tempDirObj.removeCallback();
    } catch {}
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

  // Detect source fps so we can force CFR after trim (FFmpeg 7.x xfade requires it)
  const fps = await getVideoFps(videoPath);

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
      `[0:v]trim=start=${bufferedStart.toFixed(3)}:end=${bufferedEnd.toFixed(3)},setpts=PTS-STARTPTS,fps=${fps}[v${i}]`,
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

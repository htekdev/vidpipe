import ffmpeg from 'fluent-ffmpeg';
import { promises as fs } from 'fs';
import path from 'path';
import logger from '../../config/logger';
import { getFFmpegPath, getFFprobePath } from '../../config/ffmpegResolver.js';

const ffmpegPath = getFFmpegPath();
const ffprobePath = getFFprobePath();
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export interface ExtractAudioOptions {
  /** Output format: 'mp3' (default, smaller) or 'wav' */
  format?: 'mp3' | 'wav';
}

/**
 * Extract audio from a video file to mono MP3 at 64kbps (small enough for Whisper).
 * A 10-minute video produces ~5MB MP3 vs ~115MB WAV.
 */
export async function extractAudio(
  videoPath: string,
  outputPath: string,
  options: ExtractAudioOptions = {},
): Promise<string> {
  const { format = 'mp3' } = options;
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  logger.info(`Extracting audio (${format}): ${videoPath} → ${outputPath}`);

  return new Promise<string>((resolve, reject) => {
    const command = ffmpeg(videoPath).noVideo().audioChannels(1);

    if (format === 'mp3') {
      command.audioCodec('libmp3lame').audioBitrate('64k').audioFrequency(16000);
    } else {
      command.audioCodec('pcm_s16le').audioFrequency(16000);
    }

    command
      .output(outputPath)
      .on('end', () => {
        logger.info(`Audio extraction complete: ${outputPath}`);
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.error(`Audio extraction failed: ${err.message}`);
        reject(new Error(`Audio extraction failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Split an audio file into chunks of approximately `maxChunkSizeMB` each.
 * Uses ffmpeg to split by duration calculated from the file size.
 * Returns an array of chunk file paths.
 */
export async function splitAudioIntoChunks(
  audioPath: string,
  maxChunkSizeMB: number = 24,
): Promise<string[]> {
  const stats = await fs.stat(audioPath);
  const fileSizeMB = stats.size / (1024 * 1024);

  if (fileSizeMB <= maxChunkSizeMB) {
    return [audioPath];
  }

  const duration = await getAudioDuration(audioPath);
  const numChunks = Math.ceil(fileSizeMB / maxChunkSizeMB);
  const chunkDuration = duration / numChunks;

  const ext = path.extname(audioPath);
  const base = audioPath.slice(0, -ext.length);
  const chunkPaths: string[] = [];

  logger.info(
    `Splitting ${fileSizeMB.toFixed(1)}MB audio into ${numChunks} chunks ` +
    `(~${chunkDuration.toFixed(0)}s each)`
  );

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = `${base}_chunk${i}${ext}`;
    chunkPaths.push(chunkPath);

    await new Promise<void>((resolve, reject) => {
      const cmd = ffmpeg(audioPath)
        .setStartTime(startTime)
        .setDuration(chunkDuration)
        .audioCodec('copy')
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(new Error(`Chunk split failed: ${err.message}`)));
      cmd.run();
    });

    logger.info(`Created chunk ${i + 1}/${numChunks}: ${chunkPath}`);
  }

  return chunkPaths;
}

/** Get the duration of an audio file in seconds using ffprobe. */
function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));
      resolve(metadata.format.duration ?? 0);
    });
  });
}

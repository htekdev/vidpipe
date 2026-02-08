import { createRequire } from 'module';
import { existsSync } from 'fs';
import logger from './logger.js';

const require = createRequire(import.meta.url);

export function getFFmpegPath(): string {
  if (process.env.FFMPEG_PATH) {
    logger.debug(`FFmpeg: using FFMPEG_PATH env var: ${process.env.FFMPEG_PATH}`);
    return process.env.FFMPEG_PATH;
  }
  try {
    const staticPath = require('ffmpeg-static') as string;
    if (staticPath && existsSync(staticPath)) {
      logger.debug(`FFmpeg: using ffmpeg-static: ${staticPath}`);
      return staticPath;
    }
  } catch { /* ffmpeg-static not available */ }
  logger.debug('FFmpeg: falling back to system PATH');
  return 'ffmpeg';
}

export function getFFprobePath(): string {
  if (process.env.FFPROBE_PATH) {
    logger.debug(`FFprobe: using FFPROBE_PATH env var: ${process.env.FFPROBE_PATH}`);
    return process.env.FFPROBE_PATH;
  }
  try {
    const { path: probePath } = require('@ffprobe-installer/ffprobe') as { path: string };
    if (probePath && existsSync(probePath)) {
      logger.debug(`FFprobe: using @ffprobe-installer/ffprobe: ${probePath}`);
      return probePath;
    }
  } catch { /* @ffprobe-installer/ffprobe not available */ }
  logger.debug('FFprobe: falling back to system PATH');
  return 'ffprobe';
}

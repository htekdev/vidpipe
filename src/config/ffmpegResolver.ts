import { createRequire } from 'module';
import { existsSync } from 'fs';
import logger from './logger.js';
import { getConfig } from './environment.js';

const require = createRequire(import.meta.url);

export function getFFmpegPath(): string {
  const config = getConfig();
  if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') {
    logger.debug(`FFmpeg: using FFMPEG_PATH config: ${config.FFMPEG_PATH}`);
    return config.FFMPEG_PATH;
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
  const config = getConfig();
  if (config.FFPROBE_PATH && config.FFPROBE_PATH !== 'ffprobe') {
    logger.debug(`FFprobe: using FFPROBE_PATH config: ${config.FFPROBE_PATH}`);
    return config.FFPROBE_PATH;
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

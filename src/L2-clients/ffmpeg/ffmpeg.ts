import { fluentFfmpeg as ffmpegLib } from '../../L1-infra/ffmpeg/ffmpeg.js'
import { createModuleRequire } from '../../L1-infra/process/process.js'
import { fileExistsSync } from '../../L1-infra/fileSystem/fileSystem.js'
import logger from '../../L1-infra/logger/configLogger.js'
import { getConfig } from '../../L1-infra/config/environment.js'

const require = createModuleRequire(import.meta.url)

/** Get the resolved path to the FFmpeg binary. */
export function getFFmpegPath(): string {
  const config = getConfig();
  if (config.FFMPEG_PATH && config.FFMPEG_PATH !== 'ffmpeg') {
    logger.debug(`FFmpeg: using FFMPEG_PATH config: ${config.FFMPEG_PATH}`);
    return config.FFMPEG_PATH;
  }
  try {
    const staticPath = require('ffmpeg-static') as string;
    if (staticPath && fileExistsSync(staticPath)) {
      logger.debug(`FFmpeg: using ffmpeg-static: ${staticPath}`);
      return staticPath;
    }
  } catch { /* ffmpeg-static not available */ }
  logger.debug('FFmpeg: falling back to system PATH');
  return 'ffmpeg';
}

/** Get the resolved path to the FFprobe binary. */
export function getFFprobePath(): string {
  const config = getConfig();
  if (config.FFPROBE_PATH && config.FFPROBE_PATH !== 'ffprobe') {
    logger.debug(`FFprobe: using FFPROBE_PATH config: ${config.FFPROBE_PATH}`);
    return config.FFPROBE_PATH;
  }
  try {
    const { path: probePath } = require('@ffprobe-installer/ffprobe') as { path: string };
    if (probePath && fileExistsSync(probePath)) {
      logger.debug(`FFprobe: using @ffprobe-installer/ffprobe: ${probePath}`);
      return probePath;
    }
  } catch { /* @ffprobe-installer/ffprobe not available */ }
  logger.debug('FFprobe: falling back to system PATH');
  return 'ffprobe';
}

/** Create a pre-configured fluent-ffmpeg instance. */
export function createFFmpeg(input?: string): ffmpegLib.FfmpegCommand {
  const cmd = input ? ffmpegLib(input) : ffmpegLib()
  cmd.setFfmpegPath(getFFmpegPath())
  cmd.setFfprobePath(getFFprobePath())
  return cmd
}

/** Promisified ffprobe — get media file metadata. */
export function ffprobe(filePath: string): Promise<ffmpegLib.FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpegLib.setFfprobePath(getFFprobePath())
    ffmpegLib.ffprobe(filePath, (err, data) => {
      if (err) reject(err)
      else resolve(data)
    })
  })
}

// Re-export fluent-ffmpeg for cases where direct access is needed
export { ffmpegLib as fluent }
export type { FfmpegCommand, FfprobeData } from '../../L1-infra/ffmpeg/ffmpeg.js'

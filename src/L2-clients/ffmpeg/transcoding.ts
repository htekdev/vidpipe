import { createFFmpeg } from './ffmpeg.js'
import { ensureDirectory } from '../../L1-infra/fileSystem/fileSystem.js'
import { dirname } from '../../L1-infra/paths/paths.js'
import logger from '../../L1-infra/logger/configLogger.js'

/**
 * Transcode a video file to MP4 (H.264 + AAC).
 *
 * Used during ingestion when the source file is not already MP4 (e.g. WebM).
 * VP8/VP9 video and Opus/Vorbis audio cannot be placed in an MP4 container,
 * so a full re-encode is required.
 *
 * Codec settings match the rest of the pipeline:
 * - Video: libx264, CRF 23, ultrafast preset
 * - Audio: AAC 128kbps
 *
 * @param inputPath  - Path to the source video (any format FFmpeg can read)
 * @param outputPath - Destination path (should end in .mp4)
 * @returns The output path on success
 */
export function transcodeToMp4(inputPath: string, outputPath: string): Promise<string> {
  const outputDir = dirname(outputPath)

  return new Promise<string>((resolve, reject) => {
    ensureDirectory(outputDir).then(() => {
      logger.info(`Transcoding to MP4: ${inputPath} → ${outputPath}`)

      createFFmpeg(inputPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'ultrafast',
          '-crf', '23',
          '-threads', '4',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-movflags', '+faststart',
        ])
        .output(outputPath)
        .on('end', () => {
          logger.info(`Transcoding complete: ${outputPath}`)
          resolve(outputPath)
        })
        .on('error', (err: Error) => {
          logger.error(`Transcoding failed: ${err.message}`)
          reject(new Error(`Transcoding to MP4 failed: ${err.message}`))
        })
        .run()
    }).catch(reject)
  })
}

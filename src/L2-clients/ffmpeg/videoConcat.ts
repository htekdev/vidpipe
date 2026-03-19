import { createFFmpeg, getFFmpegPath } from './ffmpeg.js'
import { execCommand } from '../../L1-infra/process/process.js'
import { ensureDirectory, writeTextFile, fileExists } from '../../L1-infra/fileSystem/fileSystem.js'
import { dirname, join } from '../../L1-infra/paths/paths.js'
import logger from '../../L1-infra/logger/configLogger.js'

export interface ConcatOptions {
  /** Crossfade duration in seconds between segments. 0 = hard cut via concat demuxer. */
  fadeDuration?: number
}

/**
 * Concatenate multiple video files in sequence, optionally with crossfade transitions.
 *
 * - `fadeDuration === 0` (default): Uses FFmpeg concat demuxer for fast, near-lossless join.
 *   Requires all inputs to share the same codec, resolution, and framerate.
 * - `fadeDuration > 0`: Uses xfade filter for smooth crossfade transitions. Re-encodes video.
 *
 * @param segments - Ordered array of video file paths to concatenate
 * @param output   - Destination path for the concatenated video
 * @param opts     - Concat options (fadeDuration)
 * @returns The output file path on success
 */
export async function concatVideos(
  segments: string[],
  output: string,
  opts: ConcatOptions = {},
): Promise<string> {
  if (segments.length === 0) {
    throw new Error('concatVideos: no segments provided')
  }

  if (segments.length === 1) {
    // Single segment — just copy the file
    await ensureDirectory(dirname(output))
    await execCommand(getFFmpegPath(), [
      '-y', '-i', segments[0], '-c', 'copy', output,
    ], { maxBuffer: 50 * 1024 * 1024 })
    return output
  }

  const fadeDuration = opts.fadeDuration ?? 0

  if (fadeDuration > 0) {
    return concatWithXfade(segments, output, fadeDuration)
  }

  return concatWithDemuxer(segments, output)
}

/**
 * Fast concat using the FFmpeg concat demuxer. No re-encoding.
 * All inputs must share codec, resolution, and framerate.
 */
async function concatWithDemuxer(segments: string[], output: string): Promise<string> {
  await ensureDirectory(dirname(output))

  // Write concat list file
  const listContent = segments.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n')
  const listPath = output + '.concat-list.txt'
  await writeTextFile(listPath, listContent)

  logger.info(`Concat (demuxer): ${segments.length} segments → ${output}`)

  await execCommand(getFFmpegPath(), [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    '-movflags', '+faststart',
    output,
  ], { maxBuffer: 50 * 1024 * 1024 })

  return output
}

/**
 * Concat with xfade crossfade transitions. Requires re-encoding.
 * Handles 2+ segments by chaining xfade filters.
 */
async function concatWithXfade(
  segments: string[],
  output: string,
  fadeDuration: number,
): Promise<string> {
  await ensureDirectory(dirname(output))

  logger.info(`Concat (xfade ${fadeDuration}s): ${segments.length} segments → ${output}`)

  // Get durations for calculating xfade offsets
  const durations = await Promise.all(segments.map(s => getVideoDuration(s)))

  // Build xfade filter chain for N segments
  const inputs = segments.flatMap(s => ['-i', s])
  const filterParts: string[] = []
  let prevLabel = '[0:v]'
  let prevAudioLabel = '[0:a]'
  let cumulativeOffset = 0

  for (let i = 1; i < segments.length; i++) {
    const offset = cumulativeOffset + durations[i - 1] - fadeDuration
    const outLabel = i < segments.length - 1 ? `[v${i}]` : '[vout]'
    const outAudioLabel = i < segments.length - 1 ? `[a${i}]` : '[aout]'

    filterParts.push(
      `${prevLabel}[${i}:v]xfade=transition=fade:duration=${fadeDuration}:offset=${offset.toFixed(3)}${outLabel}`,
    )
    filterParts.push(
      `${prevAudioLabel}[${i}:a]acrossfade=d=${fadeDuration}${outAudioLabel}`,
    )

    prevLabel = outLabel
    prevAudioLabel = outAudioLabel
    cumulativeOffset = offset
  }

  const filterComplex = filterParts.join(';')

  await execCommand(getFFmpegPath(), [
    '-y',
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    output,
  ], { maxBuffer: 50 * 1024 * 1024 })

  return output
}

/**
 * Normalize a video to match a reference video's codec, resolution, and framerate.
 * Used to prepare intro/outro for concat demuxer compatibility.
 */
export async function normalizeForConcat(
  videoPath: string,
  referenceVideo: string,
  output: string,
): Promise<string> {
  await ensureDirectory(dirname(output))

  // Get reference video properties
  const refProps = await getVideoProperties(referenceVideo)

  logger.info(`Normalizing ${videoPath} to match ${referenceVideo} (${refProps.width}x${refProps.height} ${refProps.fps}fps)`)

  await execCommand(getFFmpegPath(), [
    '-y', '-i', videoPath,
    '-vf', `scale=${refProps.width}:${refProps.height}:force_original_aspect_ratio=decrease,pad=${refProps.width}:${refProps.height}:(ow-iw)/2:(oh-ih)/2,fps=${refProps.fps}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    output,
  ], { maxBuffer: 50 * 1024 * 1024 })

  return output
}

/** Get a video file's duration in seconds. */
async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execCommand(getFFmpegPath().replace('ffmpeg', 'ffprobe'), [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    videoPath,
  ], { timeout: 10000 })

  const duration = parseFloat(stdout.trim())
  if (!isFinite(duration) || duration <= 0) {
    throw new Error(`Failed to get duration for ${videoPath}: ${stdout.trim()}`)
  }
  return duration
}

interface VideoProperties {
  width: number
  height: number
  fps: number
}

/** Get a video file's resolution and framerate. */
async function getVideoProperties(videoPath: string): Promise<VideoProperties> {
  const probePath = getFFmpegPath().replace('ffmpeg', 'ffprobe')

  const { stdout } = await execCommand(probePath, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate',
    '-of', 'json',
    videoPath,
  ], { timeout: 10000 })

  const data = JSON.parse(stdout)
  const stream = data.streams?.[0]
  if (!stream) throw new Error(`No video stream found in ${videoPath}`)

  const fpsRaw = stream.r_frame_rate ?? '30/1'
  const fpsParts = fpsRaw.split('/')
  const fps = fpsParts.length === 2
    ? Math.round(parseInt(fpsParts[0]) / parseInt(fpsParts[1]))
    : 30

  return {
    width: stream.width,
    height: stream.height,
    fps: isFinite(fps) && fps > 0 ? fps : 30,
  }
}

/**
 * L3 service wrapper for FFmpeg path resolution.
 *
 * Wraps L2 path resolvers so that L7 (and higher layers) can access
 * FFmpeg/FFprobe binary paths without importing L2 directly.
 */
import { getFFmpegPath as _getFFmpegPath, getFFprobePath as _getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js'

export function getFFmpegPath(...args: Parameters<typeof _getFFmpegPath>): ReturnType<typeof _getFFmpegPath> {
  return _getFFmpegPath(...args)
}

export function getFFprobePath(...args: Parameters<typeof _getFFprobePath>): ReturnType<typeof _getFFprobePath> {
  return _getFFprobePath(...args)
}

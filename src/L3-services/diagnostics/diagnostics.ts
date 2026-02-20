/**
 * L3 service wrapper for FFmpeg path resolution.
 *
 * Re-exports L2 path resolvers so that L7 (and higher layers) can access
 * FFmpeg/FFprobe binary paths without importing L2 directly.
 */
export { getFFmpegPath, getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js'

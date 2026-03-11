/**
 * L4 bridge for L3 video operations (FFmpeg wrappers).
 *
 * Re-exports L3 video operation functions so L5-assets can access them
 * without directly importing from L3, maintaining strict layer hierarchy:
 * L5 → L4 → L3 → L2.
 */

export {
  ffprobe,
  getFFmpegPath,
  getFFprobePath,
  extractCompositeClip,
  compositeOverlays,
  getVideoResolution,
  detectWebcamRegion,
  burnCaptions,
  singlePassEditAndCaption,
} from '../L3-services/videoOperations/videoOperations.js'

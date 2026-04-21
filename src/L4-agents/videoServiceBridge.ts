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
  transcodeToMp4,
} from '../L3-services/videoOperations/videoOperations.js'

import { applyIntroOutro as _applyIntroOutro } from '../L3-services/introOutro/introOutroService.js'
import type { IntroOutroVideoType } from '../L0-pure/types/index.js'

/** L4 bridge: apply intro/outro to a video via L3 intro/outro service. */
export function applyIntroOutro(
  videoPath: string,
  videoType: IntroOutroVideoType,
  outputPath: string,
  platform?: string,
  aspectRatio?: string,
): Promise<string> {
  return _applyIntroOutro(videoPath, videoType, outputPath, platform, aspectRatio)
}

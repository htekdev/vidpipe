// Video information
import { ffprobe as _ffprobe, getFFmpegPath as _getFFmpegPath, getFFprobePath as _getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js'

// Audio extraction
import { extractAudio as _extractAudio, splitAudioIntoChunks as _splitAudioIntoChunks } from '../../L2-clients/ffmpeg/audioExtraction.js'

// Clip extraction
import { extractClip as _extractClip, extractCompositeClip as _extractCompositeClip, extractCompositeClipWithTransitions as _extractCompositeClipWithTransitions } from '../../L2-clients/ffmpeg/clipExtraction.js'

// Editing
import { singlePassEdit as _singlePassEdit, singlePassEditAndCaption as _singlePassEditAndCaption } from '../../L2-clients/ffmpeg/singlePassEdit.js'
export type { KeepSegment } from '../../L2-clients/ffmpeg/singlePassEdit.js'

// Captions
import { burnCaptions as _burnCaptions } from '../../L2-clients/ffmpeg/captionBurning.js'

// Detection
import { detectSilence as _detectSilence } from '../../L2-clients/ffmpeg/silenceDetection.js'
export type { SilenceRegion } from '../../L2-clients/ffmpeg/silenceDetection.js'

// Frame capture
import { captureFrame as _captureFrame } from '../../L2-clients/ffmpeg/frameCapture.js'

// Aspect ratio / platform variants
import { generatePlatformVariants as _generatePlatformVariants } from '../../L2-clients/ffmpeg/aspectRatio.js'
export type { Platform } from '../../L2-clients/ffmpeg/aspectRatio.js'

// Webcam region detection
import { detectWebcamRegion as _detectWebcamRegion, getVideoResolution as _getVideoResolution } from '../../L2-clients/ffmpeg/faceDetection.js'

// Overlay compositing
import { compositeOverlays as _compositeOverlays, buildOverlayFilterComplex as _buildOverlayFilterComplex, getOverlayPosition as _getOverlayPosition } from '../../L2-clients/ffmpeg/overlayCompositing.js'

// --- Wrapper functions ---

// Video information
export function ffprobe(...args: Parameters<typeof _ffprobe>): ReturnType<typeof _ffprobe> {
  return _ffprobe(...args)
}

export function getFFmpegPath(...args: Parameters<typeof _getFFmpegPath>): ReturnType<typeof _getFFmpegPath> {
  return _getFFmpegPath(...args)
}

export function getFFprobePath(...args: Parameters<typeof _getFFprobePath>): ReturnType<typeof _getFFprobePath> {
  return _getFFprobePath(...args)
}

// Audio extraction
export function extractAudio(...args: Parameters<typeof _extractAudio>): ReturnType<typeof _extractAudio> {
  return _extractAudio(...args)
}

export function splitAudioIntoChunks(...args: Parameters<typeof _splitAudioIntoChunks>): ReturnType<typeof _splitAudioIntoChunks> {
  return _splitAudioIntoChunks(...args)
}

// Clip extraction
export function extractClip(...args: Parameters<typeof _extractClip>): ReturnType<typeof _extractClip> {
  return _extractClip(...args)
}

export function extractCompositeClip(...args: Parameters<typeof _extractCompositeClip>): ReturnType<typeof _extractCompositeClip> {
  return _extractCompositeClip(...args)
}

export function extractCompositeClipWithTransitions(...args: Parameters<typeof _extractCompositeClipWithTransitions>): ReturnType<typeof _extractCompositeClipWithTransitions> {
  return _extractCompositeClipWithTransitions(...args)
}

// Editing
export function singlePassEdit(...args: Parameters<typeof _singlePassEdit>): ReturnType<typeof _singlePassEdit> {
  return _singlePassEdit(...args)
}

export function singlePassEditAndCaption(...args: Parameters<typeof _singlePassEditAndCaption>): ReturnType<typeof _singlePassEditAndCaption> {
  return _singlePassEditAndCaption(...args)
}

// Captions
export function burnCaptions(...args: Parameters<typeof _burnCaptions>): ReturnType<typeof _burnCaptions> {
  return _burnCaptions(...args)
}

// Detection
export function detectSilence(...args: Parameters<typeof _detectSilence>): ReturnType<typeof _detectSilence> {
  return _detectSilence(...args)
}

// Frame capture
export function captureFrame(...args: Parameters<typeof _captureFrame>): ReturnType<typeof _captureFrame> {
  return _captureFrame(...args)
}

// Aspect ratio / platform variants
export function generatePlatformVariants(...args: Parameters<typeof _generatePlatformVariants>): ReturnType<typeof _generatePlatformVariants> {
  return _generatePlatformVariants(...args)
}

// Webcam region detection
export function detectWebcamRegion(...args: Parameters<typeof _detectWebcamRegion>): ReturnType<typeof _detectWebcamRegion> {
  return _detectWebcamRegion(...args)
}

export function getVideoResolution(...args: Parameters<typeof _getVideoResolution>): ReturnType<typeof _getVideoResolution> {
  return _getVideoResolution(...args)
}

// Overlay compositing
export function compositeOverlays(...args: Parameters<typeof _compositeOverlays>): ReturnType<typeof _compositeOverlays> {
  return _compositeOverlays(...args)
}

export function buildOverlayFilterComplex(...args: Parameters<typeof _buildOverlayFilterComplex>): ReturnType<typeof _buildOverlayFilterComplex> {
  return _buildOverlayFilterComplex(...args)
}

export function getOverlayPosition(...args: Parameters<typeof _getOverlayPosition>): ReturnType<typeof _getOverlayPosition> {
  return _getOverlayPosition(...args)
}

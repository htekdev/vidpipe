// Video information
export { ffprobe, getFFmpegPath, getFFprobePath } from '../../L2-clients/ffmpeg/ffmpeg.js'

// Audio extraction
export { extractAudio, splitAudioIntoChunks } from '../../L2-clients/ffmpeg/audioExtraction.js'

// Clip extraction
export { extractClip, extractCompositeClip, extractCompositeClipWithTransitions } from '../../L2-clients/ffmpeg/clipExtraction.js'

// Editing
export { singlePassEdit, singlePassEditAndCaption } from '../../L2-clients/ffmpeg/singlePassEdit.js'
export type { KeepSegment } from '../../L2-clients/ffmpeg/singlePassEdit.js'

// Captions
export { burnCaptions } from '../../L2-clients/ffmpeg/captionBurning.js'

// Detection
export { detectSilence } from '../../L2-clients/ffmpeg/silenceDetection.js'
export type { SilenceRegion } from '../../L2-clients/ffmpeg/silenceDetection.js'

// Frame capture
export { captureFrame } from '../../L2-clients/ffmpeg/frameCapture.js'

// Aspect ratio / platform variants
export { generatePlatformVariants } from '../../L2-clients/ffmpeg/aspectRatio.js'
export type { Platform } from '../../L2-clients/ffmpeg/aspectRatio.js'

// Webcam region detection
export { detectWebcamRegion, getVideoResolution } from '../../L2-clients/ffmpeg/faceDetection.js'

// Overlay compositing
export { compositeOverlays, buildOverlayFilterComplex, getOverlayPosition } from '../../L2-clients/ffmpeg/overlayCompositing.js'

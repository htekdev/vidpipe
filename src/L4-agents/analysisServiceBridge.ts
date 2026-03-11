/**
 * L4 bridge for L3 analysis, transcription, and caption services.
 *
 * Separated from videoServiceBridge to avoid eagerly loading Gemini/Whisper
 * modules when only FFmpeg operations are needed.
 *
 * Wraps L3 service functions so L5-assets can access them
 * without directly importing from L3, maintaining strict layer hierarchy:
 * L5 → L4 → L3 → L2.
 */

import { analyzeVideoEditorial as _analyzeVideoEditorial, analyzeVideoClipDirection as _analyzeVideoClipDirection, analyzeVideoForEnhancements as _analyzeVideoForEnhancements } from '../L3-services/videoAnalysis/videoAnalysis.js'
import { transcribeVideo as _transcribeVideo } from '../L3-services/transcription/transcription.js'
import { generateCaptions as _generateCaptions } from '../L3-services/captionGeneration/captionGeneration.js'
import { generateImage as _generateImage } from '../L3-services/imageGeneration/imageGeneration.js'

// Re-export types (exempt from layer rules)
export type { ImageGenerationOptions } from '../L3-services/imageGeneration/imageGeneration.js'

// Video analysis (Gemini wrappers with cost tracking)
export function analyzeVideoEditorial(...args: Parameters<typeof _analyzeVideoEditorial>): ReturnType<typeof _analyzeVideoEditorial> {
  return _analyzeVideoEditorial(...args)
}

export function analyzeVideoClipDirection(...args: Parameters<typeof _analyzeVideoClipDirection>): ReturnType<typeof _analyzeVideoClipDirection> {
  return _analyzeVideoClipDirection(...args)
}

export function analyzeVideoForEnhancements(...args: Parameters<typeof _analyzeVideoForEnhancements>): ReturnType<typeof _analyzeVideoForEnhancements> {
  return _analyzeVideoForEnhancements(...args)
}

// Transcription (Whisper wrapper)
export function transcribeVideo(...args: Parameters<typeof _transcribeVideo>): ReturnType<typeof _transcribeVideo> {
  return _transcribeVideo(...args)
}

// Caption generation
export function generateCaptions(...args: Parameters<typeof _generateCaptions>): ReturnType<typeof _generateCaptions> {
  return _generateCaptions(...args)
}

// Image generation (DALL-E wrapper with cost tracking)
export function generateImage(...args: Parameters<typeof _generateImage>): ReturnType<typeof _generateImage> {
  return _generateImage(...args)
}

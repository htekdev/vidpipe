/**
 * L4 bridge for L3 analysis, transcription, and caption services.
 *
 * Separated from videoServiceBridge to avoid eagerly loading Gemini/Whisper
 * modules when only FFmpeg operations are needed.
 *
 * Re-exports L3 service functions so L5-assets can access them
 * without directly importing from L3, maintaining strict layer hierarchy:
 * L5 → L4 → L3 → L2.
 */

// Video analysis (Gemini wrappers with cost tracking)
export {
  analyzeVideoEditorial,
  analyzeVideoClipDirection,
  analyzeVideoForEnhancements,
} from '../L3-services/videoAnalysis/videoAnalysis.js'

// Transcription (Whisper wrapper)
export { transcribeVideo } from '../L3-services/transcription/transcription.js'

// Caption generation
export { generateCaptions } from '../L3-services/captionGeneration/captionGeneration.js'

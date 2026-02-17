/**
 * Lazy loaders for modules that have side effects at import time.
 * Use these instead of direct imports to avoid circular dependency issues.
 *
 * Many modules in the pipeline read config, resolve FFmpeg paths, or perform
 * other operations at module load time. This can cause issues when modules
 * are imported before the environment is fully initialized.
 *
 * These lazy loaders defer the actual import until the module is needed,
 * ensuring all dependencies are ready.
 */

// Face detection (imports ffmpeg which reads config at load time)
export const loadFaceDetection = async () =>
  import('../tools/ffmpeg/faceDetection.js')

// Transcription service
export const loadTranscription = async () =>
  import('../services/transcription.js')

// Caption generation
export const loadCaptionGeneration = async () =>
  import('../services/captionGeneration.js')

// Silence removal agent
export const loadSilenceRemovalAgent = async () =>
  import('../agents/SilenceRemovalAgent.js')

// Caption burning
export const loadCaptionBurning = async () =>
  import('../tools/ffmpeg/captionBurning.js')

// Shorts agent
export const loadShortsAgent = async () =>
  import('../agents/ShortsAgent.js')

// Medium video agent
export const loadMediumVideoAgent = async () =>
  import('../agents/MediumVideoAgent.js')

// Chapter agent
export const loadChapterAgent = async () =>
  import('../agents/ChapterAgent.js')

// Summary agent
export const loadSummaryAgent = async () =>
  import('../agents/SummaryAgent.js')

// Blog agent
export const loadBlogAgent = async () =>
  import('../agents/BlogAgent.js')

// Social media agent
export const loadSocialMediaAgent = async () =>
  import('../agents/SocialMediaAgent.js')

// Producer agent
export const loadProducerAgent = async () =>
  import('../agents/ProducerAgent.js')

// Gemini video analysis
export const loadGeminiClient = async () =>
  import('../tools/gemini/geminiClient.js')

// Visual enhancement stage
export const loadVisualEnhancement = async () =>
  import('../stages/visualEnhancement.js')

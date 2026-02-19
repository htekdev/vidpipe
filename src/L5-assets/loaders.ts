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
  import('../L4-agents/videoServiceBridge.js')

// Transcription service
export const loadTranscription = async () =>
  import('../L4-agents/analysisServiceBridge.js')

// Caption generation
export const loadCaptionGeneration = async () =>
  import('../L4-agents/analysisServiceBridge.js')

// Silence removal agent
export const loadSilenceRemovalAgent = async () =>
  import('../L4-agents/SilenceRemovalAgent.js')

// Caption burning
export const loadCaptionBurning = async () =>
  import('../L4-agents/videoServiceBridge.js')

// Shorts agent
export const loadShortsAgent = async () =>
  import('../L4-agents/ShortsAgent.js')

// Medium video agent
export const loadMediumVideoAgent = async () =>
  import('../L4-agents/MediumVideoAgent.js')

// Chapter agent
export const loadChapterAgent = async () =>
  import('../L4-agents/ChapterAgent.js')

// Summary agent
export const loadSummaryAgent = async () =>
  import('../L4-agents/SummaryAgent.js')

// Blog agent
export const loadBlogAgent = async () =>
  import('../L4-agents/BlogAgent.js')

// Social media agent
export const loadSocialMediaAgent = async () =>
  import('../L4-agents/SocialMediaAgent.js')

// Producer agent
export const loadProducerAgent = async () =>
  import('../L4-agents/ProducerAgent.js')

// Gemini video analysis
export const loadGeminiClient = async () =>
  import('../L4-agents/analysisServiceBridge.js')

// Visual enhancement stage
export const loadVisualEnhancement = async () =>
  import('./visualEnhancement.js')

// Pipeline infrastructure services (cost tracking, processing state, git, queue builder)
export const loadPipelineServices = async () =>
  import('../L4-agents/pipelineServiceBridge.js')

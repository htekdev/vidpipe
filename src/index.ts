/**
 * VidPipe SDK — programmatic access to the AI-powered video content pipeline.
 *
 * @example
 * ```typescript
 * import { createVidPipe } from 'vidpipe'
 *
 * const vp = createVidPipe({ openaiApiKey: 'sk-...' })
 * const result = await vp.processVideo('./recording.mp4')
 * ```
 *
 * @packageDocumentation
 */

// === SDK factory and types ===
export { createVidPipe } from './L7-app/sdk/VidPipeSDK.js'
export type {
  VidPipeSDK,
  VidPipeConfig,
  ProcessOptions,
  IdeateOptions,
  StartInterviewOptions,
  SlotOptions,
  RealignOptions,
  DiagnosticCheck,
  DiagnosticResult,
  GeneratedClip,
} from './L7-app/sdk/types.js'

// === Domain types (from L0-pure) ===
export type {
  // Transcription
  Word,
  Segment,
  Transcript,

  // Video
  VideoFile,
  VideoLayout,
  WebcamRegion,
  ScreenRegion,

  // Aspect ratio
  AspectRatio,
  VideoPlatform,

  // Short clips
  ShortSegment,
  ShortClipVariant,
  ShortClip,
  HookType,
  EmotionalTrigger,
  ShortNarrativeStructure,

  // Medium clips
  MediumSegment,
  MediumClip,
  MediumNarrativeStructure,
  MediumClipType,

  // Social media
  SocialPost,

  // Chapters & summary
  Chapter,
  VideoSnapshot,
  VideoSummary,

  // Visual enhancement
  OverlayRegion,
  OverlayPlacement,
  EnhancementOpportunity,
  GeneratedOverlay,
  VisualEnhancementResult,

  // Pipeline
  StageResult,
  PipelineResult,

  // Progress events
  ProgressEvent,
  PipelineStartEvent,
  StageStartEvent,
  StageCompleteEvent,
  StageErrorEvent,
  StageSkipEvent,
  PipelineCompleteEvent,

  // Silence removal
  SilenceRemovalResult,

  // Agent result
  AgentResult,

  // Ideation
  IdeaStatus,
  IdeaPublishRecord,
  Idea,
  CreateIdeaInput,
  IdeaFilters,
  IdeaCommentData,

  // Interview / Ideate Start
  StartMode,
  InterviewEvent,
  InterviewStartEvent,
  QuestionAskedEvent,
  AnswerReceivedEvent,
  ThinkingStartEvent,
  ThinkingEndEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  InsightDiscoveredEvent,
  InterviewCompleteEvent,
  InterviewErrorEvent,
  InterviewResult,
  InterviewInsights,
  QAPair,
  QuestionContext,
  AnswerProvider,

  // Scheduling
  ScheduleSlot,
} from './L0-pure/types/index.js'

// === Enums and constants ===
export {
  Platform,
  PipelineStage,
  PLATFORM_CHAR_LIMITS,
  SUPPORTED_VIDEO_EXTENSIONS,
  toLatePlatform,
  fromLatePlatform,
  normalizePlatformString,
} from './L0-pure/types/index.js'

// === Progress listener type ===
export type { ProgressListener } from './L1-infra/progress/progressEmitter.js'

// === Interview listener type ===
export type { InterviewListener } from './L1-infra/progress/interviewEmitter.js'

// === Caption style type ===
export type { CaptionStyle } from './L0-pure/types/index.js'

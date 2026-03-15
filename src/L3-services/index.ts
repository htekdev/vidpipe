// Idea Service
export { createIdea, listIdeas, getIdea, updateIdea, linkVideoToIdea, markRecorded } from './ideaService/ideaService.js'
export { getIdeasByIds } from './ideation/ideaService.js'

// Scheduler
export { findNextSlot, getScheduleCalendar } from './scheduler/scheduler.js'
export type { SlotOptions, SlotResult } from './scheduler/scheduler.js'
export { loadScheduleConfig, getDefaultScheduleConfig, getPlatformSchedule } from './scheduler/scheduleConfig.js'
export type {
  DayOfWeek,
  TimeSlot,
  ClipTypeSchedule,
  PlatformSchedule,
  IdeaSpacingConfig,
  DisplacementConfig,
  ScheduleConfig,
} from './scheduler/scheduleConfig.js'
export { buildRealignPlan, buildPrioritizedRealignPlan, executeRealignPlan } from './scheduler/realign.js'
export type {
  RealignPost,
  CancelPost,
  RealignPlan,
  RealignResult,
  PriorityRule,
  ClipTypeMaps,
} from './scheduler/realign.js'

// Video Operations
export {
  extractClip,
  burnCaptions,
  detectSilence,
  captureFrame,
  generatePlatformVariants,
  detectWebcamRegion,
  extractCompositeClip,
  extractCompositeClipWithTransitions,
  compositeOverlays,
} from './videoOperations/videoOperations.js'
export type { KeepSegment, SilenceRegion, Platform } from './videoOperations/videoOperations.js'

// Social Posting
export { getPlatformClient, publishToAllPlatforms, PlaceholderPlatformClient } from './socialPosting/socialPosting.js'
export type { SocialPlatformClient } from './socialPosting/socialPosting.js'

// Caption Generation
export { generateCaptions } from './captionGeneration/captionGeneration.js'

// Late API
export { createLateApiClient } from './lateApi/lateApiService.js'
export type {
  LateApiClient,
  LateAccount,
  LateProfile,
  LatePost,
  LateMediaPresignResult,
  LateMediaUploadResult,
  CreatePostParams,
} from './lateApi/lateApiService.js'

// Post Store
export { getPendingItems, getPublishedItems, updateItem, approveItem } from './postStore/postStore.js'
export type { QueueItemMetadata, QueueItem, GroupedQueueItem, BulkApprovalResult } from './postStore/postStore.js'

// Processing State
export {
  markPending,
  markProcessing,
  markCompleted,
  markFailed,
  getVideoStatus,
  isCompleted,
  getUnprocessed,
} from './processingState/processingState.js'
export type { VideoStatus, VideoState, ProcessingStateData } from './processingState/processingState.js'

// Cost Tracking
export { costTracker } from './costTracking/costTracker.js'
export type { UsageRecord, ServiceUsageRecord, CostReport } from './costTracking/costTracker.js'

// Diagnostics
export { getFFmpegPath, getFFprobePath } from './diagnostics/diagnostics.js'

// LLM Provider
export { getProvider } from './llm/providerFactory.js'
export type {
  LLMProvider,
  LLMSession,
  LLMResponse,
  SessionConfig,
  ToolWithHandler,
  TokenUsage,
  CostInfo,
  QuotaSnapshot,
  ProviderEvent,
  ProviderEventType,
  ProviderName,
  ToolDefinition,
  ToolCall,
  ToolHandler,
  ImageContent,
  ImageMimeType,
  MCPServerConfig,
  MCPLocalServerConfig,
  MCPRemoteServerConfig,
  UserInputRequest,
  UserInputResponse,
  UserInputHandler,
} from './llm/providerFactory.js'

// Transcription
export { transcribeVideo } from './transcription/transcription.js'

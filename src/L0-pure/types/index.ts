/**
 * Type definitions for vidpipe CLI pipeline.
 *
 * Domain types covering transcription, video metadata, short-clip planning,
 * social-media post generation, and end-to-end pipeline orchestration.
 *
 * ### Timestamp convention
 * All `start` and `end` fields are in **seconds from the beginning of the video**
 * (floating-point, e.g. 12.345). This matches Whisper's output format and
 * FFmpeg's `-ss` / `-to` parameters.
 */

// ============================================================================
// PLATFORM
// ============================================================================

/** Social-media platforms supported for post generation. */
export enum Platform {
  TikTok = 'tiktok',
  YouTube = 'youtube',
  Instagram = 'instagram',
  LinkedIn = 'linkedin',
  X = 'x',
}

// ============================================================================
// TRANSCRIPTION (Whisper)
// ============================================================================

/**
 * A single word with precise start/end timestamps from Whisper.
 *
 * Word-level timestamps are the foundation of the karaoke caption system —
 * each word knows exactly when it's spoken, enabling per-word highlighting.
 * Whisper produces these via its `--word_timestamps` flag.
 *
 * @property word - The spoken word (may include leading/trailing whitespace)
 * @property start - When this word begins, in seconds from video start
 * @property end - When this word ends, in seconds from video start
 */
export interface Word {
  word: string;
  start: number;
  end: number;
}

/**
 * A sentence/phrase-level segment from Whisper transcription.
 *
 * Segments are Whisper's natural grouping of words into sentences or clauses.
 * They're used for SRT/VTT subtitle generation (one cue per segment) and for
 * silence removal (segments that fall entirely within a removed region are dropped).
 *
 * @property id - Sequential segment index (0-based)
 * @property text - Full text of the segment
 * @property start - Segment start time in seconds
 * @property end - Segment end time in seconds
 * @property words - The individual words with their own timestamps
 */
export interface Segment {
  id: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

/**
 * Complete transcript result from Whisper.
 *
 * Contains both segment-level and word-level data. The top-level `words` array
 * is a flat list of all words across all segments — this is the primary input
 * for the ASS caption generator's karaoke highlighting.
 *
 * @property text - Full transcript as a single string
 * @property segments - Sentence/phrase-level segments
 * @property words - Flat array of all words with timestamps (used by ASS captions)
 * @property language - Detected language code (e.g. "en")
 * @property duration - Total video duration in seconds
 */
export interface Transcript {
  text: string;
  segments: Segment[];
  words: Word[];
  language: string;
  duration: number;
}

// ============================================================================
// VIDEO FILE
// ============================================================================

/**
 * Metadata for a video file after ingestion into the repo structure.
 *
 * @property originalPath - Where the file was picked up from (e.g. recordings/ folder)
 * @property repoPath - Canonical path within the repo's asset directory
 * @property videoDir - Directory containing all generated assets for this video
 * @property slug - URL/filesystem-safe name derived from the filename (e.g. "my-video-2024-01-15")
 * @property filename - Original filename with extension
 * @property duration - Video duration in seconds (from ffprobe)
 * @property size - File size in bytes
 * @property createdAt - File creation timestamp
 * @property layout - Detected layout metadata (webcam region, etc.)
 */
export interface VideoFile {
  originalPath: string;
  repoPath: string;
  videoDir: string;
  slug: string;
  filename: string;
  duration: number;
  size: number;
  createdAt: Date;
  layout?: VideoLayout;
  /** Path to generated thumbnail image for this video */
  thumbnailPath?: string;
}

/**
 * Detected layout metadata for a video.
 * Captures webcam and screen region positions for use in aspect ratio conversion
 * and production effects.
 */
export interface VideoLayout {
  /** Video dimensions */
  width: number;
  height: number;
  /** Detected webcam overlay region (null if no webcam detected) */
  webcam: WebcamRegion | null;
  /** Main screen content region (computed as inverse of webcam) */
  screen: ScreenRegion | null;
}

/**
 * Webcam overlay region in a screen recording.
 */
export interface WebcamRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  confidence: number;
}

/**
 * Main screen content region (area not occupied by webcam).
 */
export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// ASPECT RATIO
// ============================================================================

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type VideoPlatform =
  | 'tiktok'
  | 'youtube-shorts'
  | 'instagram-reels'
  | 'instagram-feed'
  | 'linkedin'
  | 'youtube'
  | 'twitter';

// ============================================================================
// CAPTION STYLE
// ============================================================================

/**
 * Caption rendering style.
 * - `'shorts'` — large centered pop captions for short-form clips (landscape 16:9)
 * - `'medium'` — smaller bottom-positioned captions for longer content
 * - `'portrait'` — Opus Clips style for 9:16 vertical video (green highlight,
 *   scale-pop animation, larger fonts for small-screen viewing)
 */
export type CaptionStyle = 'shorts' | 'medium' | 'portrait';

export interface ShortClipVariant {
  path: string;
  aspectRatio: AspectRatio;
  platform: VideoPlatform;
  width: number;
  height: number;
}

// ============================================================================
// SHORT CLIPS
// ============================================================================

/**
 * A single time range within a short clip.
 *
 * Short clips can be **composite** — made of multiple non-contiguous segments
 * from the original video, concatenated together. Each segment describes one
 * contiguous range.
 *
 * @property start - Start time in the original video (seconds)
 * @property end - End time in the original video (seconds)
 * @property description - Human-readable description of what happens in this segment
 */
export interface ShortSegment {
  start: number;
  end: number;
  description: string;
}

/**
 * A planned short clip (15–60s) extracted from the full video.
 *
 * May be a single contiguous segment or a **composite** of multiple segments
 * concatenated together (e.g. an intro + punchline from different parts of
 * the video). The `segments` array defines the source time ranges; `totalDuration`
 * is the sum of all segment durations.
 *
 * @property id - Unique identifier (e.g. "short-1")
 * @property title - Human-readable title for the clip
 * @property slug - Filesystem-safe slug (e.g. "typescript-tip-generics")
 * @property segments - One or more time ranges from the original video
 * @property totalDuration - Sum of all segment durations in seconds
 * @property outputPath - Path to the extracted video file
 * @property captionedPath - Path to the captioned version (if generated)
 * @property description - Short description for social media
 * @property tags - Hashtags / topic tags
 * @property variants - Platform-specific aspect-ratio variants (portrait, square, etc.)
 */
/** Hook pattern used to capture viewer attention in the first 1-3 seconds */
export type HookType = 'cold-open' | 'curiosity-gap' | 'contradiction' | 'result-first' | 'bold-claim' | 'question';

/** Primary emotional trigger that drives engagement (shares, saves, comments) */
export type EmotionalTrigger = 'awe' | 'humor' | 'surprise' | 'empathy' | 'outrage' | 'practical-value';

/** Narrative arc structure used in short clips */
export type ShortNarrativeStructure = 'result-method-proof' | 'doing-x-wrong' | 'expectation-vs-reality' | 'mini-list' | 'tension-release' | 'loop';

export interface ShortClip {
  id: string;
  title: string;
  slug: string;
  segments: ShortSegment[];
  totalDuration: number;
  outputPath: string;
  captionedPath?: string;
  description: string;
  tags: string[];
  hook?: string;
  variants?: ShortClipVariant[];
  /** Hook pattern classification — how the opening captures attention */
  hookType?: HookType;
  /** Primary emotional driver that makes this clip engaging */
  emotionalTrigger?: EmotionalTrigger;
  /** Viral potential score (1-20) based on hook strength, emotion, shareability, completion, replay */
  viralScore?: number;
  /** Narrative arc pattern used in this clip */
  narrativeStructure?: ShortNarrativeStructure;
  /** Why would someone share this with a friend? */
  shareReason?: string;
  /** Whether the content naturally loops back to the beginning */
  isLoopCandidate?: boolean;
  /** Path to generated thumbnail image for this short clip */
  thumbnailPath?: string;
  /** GitHub Issue number of the matched/created idea for this clip (per-clip idea tagging) */
  ideaIssueNumber?: number;
}

// ============================================================================
// MEDIUM CLIPS
// ============================================================================

/** A planned medium clip segment */
export interface MediumSegment {
  start: number;
  end: number;
  description: string;
}

/** Narrative arc structure used in medium clips */
export type MediumNarrativeStructure = 'open-loop-steps-payoff' | 'problem-deepdive-solution' | 'story-arc' | 'debate-comparison' | 'tutorial-micropayoffs';

/** Classification of medium clip content type */
export type MediumClipType = 'deep-dive' | 'tutorial' | 'story-arc' | 'debate' | 'problem-solution';

export interface MediumClip {
  id: string;
  title: string;
  slug: string;
  segments: MediumSegment[];
  totalDuration: number;
  outputPath: string;
  captionedPath?: string;
  description: string;
  tags: string[];
  hook: string;
  topic: string;
  /** Hook pattern classification — how the opening captures attention */
  hookType?: HookType;
  /** Primary emotional driver that makes this clip engaging */
  emotionalTrigger?: EmotionalTrigger;
  /** Viral potential score (1-20) based on hook strength, emotion, shareability, completion, replay */
  viralScore?: number;
  /** Narrative arc pattern used in this clip */
  narrativeStructure?: MediumNarrativeStructure;
  /** Content type classification */
  clipType?: MediumClipType;
  /** Why would someone save this to reference later? */
  saveReason?: string;
  /** Retention hooks planned at ~15-20 second intervals within the clip */
  microHooks?: string[];
  /** Path to generated thumbnail image for this medium clip */
  thumbnailPath?: string;
  /** GitHub Issue number of the matched/created idea for this clip (per-clip idea tagging) */
  ideaIssueNumber?: number;
}

// ============================================================================
// SOCIAL MEDIA
// ============================================================================

export interface SocialPost {
  platform: Platform;
  content: string;
  hashtags: string[];
  links: string[];
  characterCount: number;
  outputPath: string;
}

// ============================================================================
// CHAPTERS
// ============================================================================

/**
 * A chapter marker for YouTube's chapters feature.
 *
 * @property timestamp - Start time in seconds (YouTube shows these as clickable markers)
 * @property title - Short chapter title (shown in the progress bar)
 * @property description - Longer description for the README/summary
 */
export interface Chapter {
  timestamp: number;
  title: string;
  description: string;
}

// ============================================================================
// SNAPSHOTS & SUMMARY
// ============================================================================

export interface VideoSnapshot {
  timestamp: number;
  description: string;
  outputPath: string;
}

export interface VideoSummary {
  title: string;
  overview: string;
  keyTopics: string[];
  snapshots: VideoSnapshot[];
  markdownPath: string;
}

// ============================================================================
// VISUAL ENHANCEMENT
// ============================================================================

/** Placement region for an image overlay on video */
export type OverlayRegion = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center-right' | 'center-left'

/** Where on screen to place an overlay image */
export interface OverlayPlacement {
  region: OverlayRegion;
  avoidAreas: string[];
  sizePercent: number;
}

/** A moment in the video identified by Gemini as needing a visual aid */
export interface EnhancementOpportunity {
  timestampStart: number;
  timestampEnd: number;
  topic: string;
  imagePrompt: string;
  reason: string;
  placement: OverlayPlacement;
  confidence: number;
}

/** A generated image overlay ready for FFmpeg compositing */
export interface GeneratedOverlay {
  opportunity: EnhancementOpportunity;
  imagePath: string;
  width: number;
  height: number;
}

/** Result of the visual enhancement stage */
export interface VisualEnhancementResult {
  enhancedVideoPath: string;
  overlays: GeneratedOverlay[];
  analysisTokens: number;
  imageGenCost: number;
}

// ============================================================================
// PIPELINE
// ============================================================================

export enum PipelineStage {
  Ingestion = 'ingestion',
  Transcription = 'transcription',
  SilenceRemoval = 'silence-removal',
  VisualEnhancement = 'visual-enhancement',
  Chapters = 'chapters',
  Captions = 'captions',
  CaptionBurn = 'caption-burn',
  IntroOutro = 'intro-outro',
  Summary = 'summary',
  IdeaDiscovery = 'idea-discovery',
  Shorts = 'shorts',
  MediumClips = 'medium-clips',
  SocialMedia = 'social-media',
  ShortPosts = 'short-posts',
  MediumClipPosts = 'medium-clip-posts',
  Blog = 'blog',
  QueueBuild = 'queue-build',
}

// ============================================================================
// INTRO/OUTRO CONFIGURATION
// ============================================================================

/** Which type of video is being processed — determines intro/outro rules. */
export type IntroOutroVideoType = 'main' | 'shorts' | 'medium-clips'

/** Toggle for whether to include intro and/or outro for a given context. */
export interface IntroOutroToggle {
  intro: boolean
  outro: boolean
}

/** File paths for a single bookend (intro or outro), with optional per-platform and per-aspect-ratio overrides. */
export interface IntroOutroFileConfig {
  /** Default file path (relative to repo root or absolute). */
  default?: string
  /** Platform-specific file path overrides. */
  platforms?: Partial<Record<string, string>>
  /** Aspect-ratio-specific file path overrides (e.g., '9:16' → './assets/intro-portrait.mp4'). */
  aspectRatios?: Partial<Record<string, string>>
}

/** Complete intro/outro configuration stored in brand.json. */
export interface IntroOutroConfig {
  /** Master toggle — when false, intro/outro is skipped entirely. */
  enabled: boolean
  /** Crossfade duration in seconds between intro/content and content/outro. 0 = hard cut. */
  fadeDuration: number
  /** Intro video file configuration. */
  intro?: IntroOutroFileConfig
  /** Outro video file configuration. */
  outro?: IntroOutroFileConfig
  /** Default rules per video type. */
  rules?: Partial<Record<IntroOutroVideoType, IntroOutroToggle>>
  /** Per-platform overrides of the default rules. */
  platformOverrides?: Partial<Record<string, Partial<Record<IntroOutroVideoType, Partial<IntroOutroToggle>>>>>
}

// ============================================================================
// THUMBNAIL CONFIGURATION
// ============================================================================

/** Content type identifier for thumbnail rule configuration. */
export type ThumbnailContentType = 'main' | 'shorts' | 'medium-clips'

/** Image size for thumbnail generation. */
export type ThumbnailSize = '1024x1024' | '1536x1024' | '1024x1536' | 'auto'

/** Quality tier for thumbnail generation. */
export type ThumbnailQuality = 'low' | 'medium' | 'high'

/** Per-platform overrides for thumbnail generation. */
export interface ThumbnailPlatformOverride {
  /** Platform-specific reference image for style transfer. */
  referenceImage?: string
  /** Platform-specific style description. */
  style?: string
  /** Platform-specific image size. */
  size?: ThumbnailSize
  /** Platform-specific prompt override. */
  promptOverride?: string
}

/** Complete thumbnail configuration stored in brand.json. */
export interface ThumbnailConfig {
  /** Master toggle — when false, thumbnail generation is skipped entirely. */
  enabled: boolean
  /** Path to reference image for style transfer (relative to repo root). */
  referenceImage?: string
  /** Override the AI-generated prompt entirely. */
  promptOverride?: string
  /** Style description appended to generated prompts. */
  style?: string
  /** Image size for generation. */
  size?: ThumbnailSize
  /** Quality tier. */
  quality?: ThumbnailQuality
  /** Which content types get thumbnails. */
  rules?: Partial<Record<ThumbnailContentType, boolean>>
  /** Per-platform overrides. */
  platformOverrides?: Partial<Record<string, ThumbnailPlatformOverride>>
}

/** Result from thumbnail generation. */
export interface ThumbnailResult {
  /** The prompt used (either AI-generated or overridden). */
  prompt: string
  /** Path to the generated thumbnail image file. */
  outputPath: string
  /** Whether a reference image was used for style transfer. */
  referenceUsed: boolean
  /** Target platform if platform-specific. */
  platform?: string
}

/**
 * Per-stage outcome record for pipeline observability.
 *
 * @property stage - Which pipeline stage this result is for
 * @property success - Whether the stage completed without throwing
 * @property error - Error message if the stage failed
 * @property duration - Wall-clock time in milliseconds
 */
export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  error?: string;
  duration: number;
}

/**
 * Complete output of a pipeline run.
 *
 * Fields are optional because stages can fail independently — a failed
 * transcription means no summary, but the video metadata is still available.
 *
 * @property totalDuration - Total pipeline wall-clock time in milliseconds
 */
export interface PipelineResult {
  video: VideoFile;
  transcript?: Transcript;
  editedVideoPath?: string;
  captions?: string[];
  captionedVideoPath?: string;
  enhancedVideoPath?: string;
  introOutroVideoPath?: string;
  summary?: VideoSummary;
  chapters?: Chapter[];
  shorts: ShortClip[];
  mediumClips: MediumClip[];
  socialPosts: SocialPost[];
  blogPost?: string;
  stageResults: StageResult[];
  totalDuration: number;
}

// ============================================================================
// PIPELINE PROGRESS EVENTS
// ============================================================================

/**
 * Metadata for a pipeline stage — human-readable name and ordinal position.
 * Used by progress events and UI integrations to display stage info.
 */
export interface StageInfo {
  stage: PipelineStage;
  name: string;
  stageNumber: number;
}

/**
 * Canonical ordered list of all pipeline stages with human-readable names.
 * Order matches the execution order in `processVideo()`.
 */
export const PIPELINE_STAGES: readonly StageInfo[] = [
  { stage: PipelineStage.Ingestion, name: 'Ingestion', stageNumber: 1 },
  { stage: PipelineStage.Transcription, name: 'Transcription', stageNumber: 2 },
  { stage: PipelineStage.SilenceRemoval, name: 'Silence Removal', stageNumber: 3 },
  { stage: PipelineStage.VisualEnhancement, name: 'Visual Enhancement', stageNumber: 4 },
  { stage: PipelineStage.Captions, name: 'Captions', stageNumber: 5 },
  { stage: PipelineStage.CaptionBurn, name: 'Caption Burn', stageNumber: 6 },
  { stage: PipelineStage.IntroOutro, name: 'Intro/Outro', stageNumber: 7 },
  { stage: PipelineStage.Shorts, name: 'Shorts', stageNumber: 8 },
  { stage: PipelineStage.MediumClips, name: 'Medium Clips', stageNumber: 9 },
  { stage: PipelineStage.Chapters, name: 'Chapters', stageNumber: 10 },
  { stage: PipelineStage.Summary, name: 'Summary', stageNumber: 11 },
  { stage: PipelineStage.IdeaDiscovery, name: 'Idea Discovery', stageNumber: 12 },
  { stage: PipelineStage.SocialMedia, name: 'Social Media', stageNumber: 13 },
  { stage: PipelineStage.ShortPosts, name: 'Short Posts', stageNumber: 14 },
  { stage: PipelineStage.MediumClipPosts, name: 'Medium Clip Posts', stageNumber: 15 },
  { stage: PipelineStage.QueueBuild, name: 'Queue Build', stageNumber: 16 },
  { stage: PipelineStage.Blog, name: 'Blog', stageNumber: 17 },
] as const

/** Total number of pipeline stages. Derived from PIPELINE_STAGES, not hardcoded. */
export const TOTAL_STAGES: number = PIPELINE_STAGES.length

/** Lookup a stage's metadata by its PipelineStage enum value. */
export function getStageInfo(stage: PipelineStage): StageInfo {
  const info = PIPELINE_STAGES.find(s => s.stage === stage)
  if (!info) throw new Error(`Unknown pipeline stage: ${stage}`)
  return info
}

/**
 * Structured progress events emitted during pipeline execution.
 *
 * Discriminated union on the `event` field. Consumers parse JSONL from stderr
 * when `--progress` is passed to `vidpipe process`.
 */
export type ProgressEvent =
  | PipelineStartEvent
  | StageStartEvent
  | StageCompleteEvent
  | StageErrorEvent
  | StageSkipEvent
  | PipelineCompleteEvent

export interface PipelineStartEvent {
  event: 'pipeline:start';
  videoPath: string;
  totalStages: number;
  timestamp: string;
}

export interface StageStartEvent {
  event: 'stage:start';
  stage: PipelineStage;
  stageNumber: number;
  totalStages: number;
  name: string;
  timestamp: string;
}

export interface StageCompleteEvent {
  event: 'stage:complete';
  stage: PipelineStage;
  stageNumber: number;
  totalStages: number;
  name: string;
  duration: number;
  success: true;
  timestamp: string;
}

export interface StageErrorEvent {
  event: 'stage:error';
  stage: PipelineStage;
  stageNumber: number;
  totalStages: number;
  name: string;
  duration: number;
  error: string;
  timestamp: string;
}

export interface StageSkipEvent {
  event: 'stage:skip';
  stage: PipelineStage;
  stageNumber: number;
  totalStages: number;
  name: string;
  reason: string;
  timestamp: string;
}

export interface PipelineCompleteEvent {
  event: 'pipeline:complete';
  totalDuration: number;
  stagesCompleted: number;
  stagesFailed: number;
  stagesSkipped: number;
  timestamp: string;
}

// ============================================================================
// SILENCE REMOVAL
// ============================================================================

/**
 * Result of the silence removal stage.
 *
 * @property editedPath - Path to the video with silence regions cut out
 * @property removals - Time ranges that were removed (in original video time).
 *   Used by {@link adjustTranscript} to shift transcript timestamps.
 * @property keepSegments - Inverse of removals — the time ranges that were kept.
 *   Used by the single-pass caption burn to re-create the edit from the original.
 * @property wasEdited - False if no silence was found and the video is unchanged
 */
export interface SilenceRemovalResult {
  editedPath: string;
  removals: { start: number; end: number }[];
  keepSegments: { start: number; end: number }[];
  wasEdited: boolean;
}

// ============================================================================
// AGENT RESULT (Copilot SDK)
// ============================================================================

/**
 * Standard result wrapper for all Copilot SDK agent calls.
 *
 * @property success - Whether the agent completed its task
 * @property data - The parsed result (type varies by agent)
 * @property error - Error message if the agent failed
 * @property usage - Token counts for cost tracking
 */
export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

// ============================================================================
// SOCIAL PUBLISHING / QUEUE
// ============================================================================

/** Character limits per social media platform */
export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  tiktok: 2200,
  youtube: 5000,
  instagram: 2200,
  linkedin: 3000,
  twitter: 280,
}

/**
 * Maps vidpipe Platform enum values to Late API platform strings.
 * Platform.X = 'x' but Late API expects 'twitter'.
 */
export function toLatePlatform(platform: Platform): string {
  return platform === Platform.X ? 'twitter' : platform
}

/**
 * Maps a Late API platform string back to vidpipe Platform enum.
 * 
 * Validates the input against known Platform values to avoid admitting
 * unknown/unsupported platforms via an unchecked cast.
 * 
 * @throws {Error} If the platform is not supported
 */
export function fromLatePlatform(latePlatform: string): Platform {
  const normalized = normalizePlatformString(latePlatform)
  
  if (normalized === 'twitter') {
    return Platform.X
  }
  
  const platformValues = Object.values(Platform) as string[]
  if (platformValues.includes(normalized)) {
    return normalized as Platform
  }
  
  throw new Error(`Unsupported platform from Late API: ${latePlatform}`)
}

/**
 * Normalizes raw platform strings (e.g., from user input or API responses)
 * to Late API platform names. Handles X/Twitter variants and case-insensitivity.
 * 
 * @example
 * normalizePlatformString('X') // 'twitter'
 * normalizePlatformString('x (twitter)') // 'twitter'
 * normalizePlatformString('YouTube') // 'youtube'
 */
export function normalizePlatformString(raw: string): string {
  const lower = raw.toLowerCase().trim()
  if (lower === 'x' || lower === 'x (twitter)' || lower === 'x/twitter') {
    return 'twitter'
  }
  return lower
}

// ============================================================================
// IDEATION
// ============================================================================

/** Status lifecycle for content ideas */
export type IdeaStatus = 'draft' | 'ready' | 'recorded' | 'published'

/**
 * Record of a piece of content published from an idea.
 * Appended to `Idea.publishedContent` when queue items are approved/published.
 */
export interface IdeaPublishRecord {
  /** Content type that was published */
  clipType: 'video' | 'short' | 'medium-clip'
  /** Platform where content was published */
  platform: Platform
  /** Links back to QueueItemMetadata.id */
  queueItemId: string
  /** When the content was published (ISO 8601) */
  publishedAt: string
  /** Late API post ID for tracking/managing the scheduled post */
  latePostId: string
  /** Late API dashboard URL for viewing the post */
  lateUrl: string
  /** Final published URL if available */
  publishedUrl?: string
}

/**
 * A content idea generated by the IdeationAgent or created manually.
 *
 * Ideas flow through the pipeline: they are created during ideation,
 * linked to recordings during processing, and tracked through publishing.
 * The `status` field tracks the lifecycle: draft → ready → recorded → published.
 */
export interface Idea {
  /** GitHub Issue number — the primary identifier */
  issueNumber: number
  /** GitHub Issue URL (e.g., https://github.com/htekdev/content-management/issues/1) */
  issueUrl: string
  /** Repository full name (e.g., htekdev/content-management) */
  repoFullName: string
  /** Legacy slug ID for migration compatibility (e.g., "idea-copilot-debugging") */
  id: string
  /** Main topic/title of the idea (= issue title) */
  topic: string
  /** The attention-grabbing angle (≤80 chars) */
  hook: string
  /** Who this content is for */
  audience: string
  /** The one thing the viewer should remember */
  keyTakeaway: string
  /** Bullet points to cover in the recording */
  talkingPoints: string[]
  /** Target platforms for this content (derived from platform:* labels) */
  platforms: Platform[]
  /** Lifecycle status (derived from status:* label) */
  status: IdeaStatus
  /** Tags for categorization and matching (derived from freeform labels) */
  tags: string[]
  /** When the idea was created (from issue created_at) */
  createdAt: string
  /** When the idea was last updated (from issue updated_at) */
  updatedAt: string
  /** Deadline for publishing this idea's content (ISO 8601 date). Agent sets based on timeliness:
   * - Hot trend: 3-5 days out
   * - Timely event: 1-2 weeks out
   * - Evergreen: 3-6 months out */
  publishBy: string
  /** Video slug linked after recording — parsed from video-link issue comments */
  sourceVideoSlug?: string
  /** Why this is timely — context from trend research */
  trendContext?: string
  /** Tracks every piece of content published for this idea — parsed from issue comments */
  publishedContent?: IdeaPublishRecord[]
}

/** Input for creating a new idea — omits fields derived from GitHub Issue metadata */
export interface CreateIdeaInput {
  /** Main topic/title (becomes issue title) */
  topic: string
  /** The attention-grabbing angle (≤80 chars) */
  hook: string
  /** Who this content is for */
  audience: string
  /** The one thing the viewer should remember */
  keyTakeaway: string
  /** Bullet points to cover in the recording */
  talkingPoints: string[]
  /** Target platforms for this content */
  platforms: Platform[]
  /** Tags for categorization and matching */
  tags: string[]
  /** Deadline for publishing (ISO 8601 date) */
  publishBy: string
  /** Why this is timely — context from trend research */
  trendContext?: string
}

/** Filters for querying ideas from GitHub Issues */
export interface IdeaFilters {
  /** Filter by lifecycle status */
  status?: IdeaStatus
  /** Filter by target platform */
  platform?: Platform
  /** Filter by tag label */
  tag?: string
  /** Filter by priority label */
  priority?: 'hot-trend' | 'timely' | 'evergreen'
  /** Maximum number of results */
  limit?: number
}

/** Discriminated type for structured issue comments */
export type IdeaCommentData =
  | { type: 'publish-record'; record: IdeaPublishRecord }
  | { type: 'video-link'; videoSlug: string; linkedAt: string }

/** Schedule time slot for a platform */
export interface ScheduleSlot {
  platform: string
  scheduledFor: string  // ISO datetime
  postId?: string       // Late post ID if already published
  itemId?: string       // Local queue item ID
  label?: string
}

// ── Late API Queue Types ──

/** Late API queue slot definition */
export interface LateQueueSlot {
  /** Day of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat */
  dayOfWeek: number
  /** Time in HH:MM format (24-hour, in the queue's timezone) */
  time: string
}

/** Late API queue definition */
export interface LateQueue {
  _id: string
  profileId: string
  name: string
  timezone: string
  slots: LateQueueSlot[]
  active: boolean
  isDefault: boolean
  createdAt?: string
  updatedAt?: string
}

/** Maps a (platform, clipType) pair to a Late API queue */
export interface QueueMapping {
  queueId: string
  queueName: string
  platform: string
  clipType: string
}

// ============================================================================
// VIDEO FORMAT
// ============================================================================

/** File extensions accepted as pipeline input. */
export const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.webm'] as const

/** Type for a supported video extension string. */
export type SupportedVideoExtension = (typeof SUPPORTED_VIDEO_EXTENSIONS)[number]

/** Check whether a file extension (including the dot) is a supported video format. */
export function isSupportedVideoExtension(ext: string): ext is SupportedVideoExtension {
  return (SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(ext.toLowerCase())
}

// ============================================================================
// EDITORIAL DIRECTION (Gemini Video Understanding)
// ============================================================================

// Editorial direction is now stored as free-form markdown (editorial-direction.md)
// generated by Gemini video analysis. No structured types needed.

// ============================================================================
// IDEATE START / INTERVIEW
// ============================================================================

/** Available modes for the `ideate start` command */
export type StartMode = 'interview'

/** A single question-answer pair from an interview session */
export interface QAPair {
  /** The question asked by the agent */
  question: string
  /** The user's response */
  answer: string
  /** ISO 8601 timestamp of when the question was asked */
  askedAt: string
  /** ISO 8601 timestamp of when the answer was provided */
  answeredAt: string
  /** Sequential question number (1-based) */
  questionNumber: number
}

/** Context provided alongside a question */
export interface QuestionContext {
  /** Why this question is being asked */
  rationale: string
  /** Which idea field this question explores (if any) */
  targetField?: keyof CreateIdeaInput
  /** Sequential question number (1-based) */
  questionNumber: number
}

/** Insights discovered during an interview that can update idea fields */
export interface InterviewInsights {
  /** Refined talking points discovered from Q&A */
  talkingPoints?: string[]
  /** Refined key takeaway */
  keyTakeaway?: string
  /** Refined hook angle */
  hook?: string
  /** Refined audience description */
  audience?: string
  /** Additional trend context discovered */
  trendContext?: string
  /** New tags suggested */
  tags?: string[]
}

/** Result of a completed interview session */
export interface InterviewResult {
  /** The idea that was interviewed */
  ideaNumber: number
  /** Full Q&A transcript */
  transcript: QAPair[]
  /** Insights discovered by the agent */
  insights: InterviewInsights
  /** Fields that were updated on the idea */
  updatedFields: (keyof CreateIdeaInput)[]
  /** Total duration of the interview in milliseconds */
  durationMs: number
  /** Whether the interview completed naturally or was ended early */
  endedBy: 'agent' | 'user'
}

/** Discriminated union of all interview events */
export type InterviewEvent =
  | InterviewStartEvent
  | QuestionAskedEvent
  | AnswerReceivedEvent
  | ThinkingStartEvent
  | ThinkingEndEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | InsightDiscoveredEvent
  | InterviewCompleteEvent
  | InterviewErrorEvent

export interface InterviewStartEvent {
  readonly event: 'interview:start'
  readonly ideaNumber: number
  readonly mode: StartMode
  readonly ideaTopic: string
  readonly timestamp: string
}

export interface QuestionAskedEvent {
  readonly event: 'question:asked'
  readonly question: string
  readonly context: QuestionContext
  readonly timestamp: string
}

export interface AnswerReceivedEvent {
  readonly event: 'answer:received'
  readonly questionNumber: number
  readonly answer: string
  readonly timestamp: string
}

export interface ThinkingStartEvent {
  readonly event: 'thinking:start'
  readonly timestamp: string
}

export interface ThinkingEndEvent {
  readonly event: 'thinking:end'
  readonly durationMs: number
  readonly timestamp: string
}

export interface ToolCallStartEvent {
  readonly event: 'tool:start'
  readonly toolName: string
  readonly timestamp: string
}

export interface ToolCallEndEvent {
  readonly event: 'tool:end'
  readonly toolName: string
  readonly durationMs: number
  readonly timestamp: string
}

export interface InsightDiscoveredEvent {
  readonly event: 'insight:discovered'
  readonly insight: string
  readonly field: keyof CreateIdeaInput
  readonly timestamp: string
}

export interface InterviewCompleteEvent {
  readonly event: 'interview:complete'
  readonly result: InterviewResult
  readonly timestamp: string
}

export interface InterviewErrorEvent {
  readonly event: 'interview:error'
  readonly error: string
  readonly timestamp: string
}

/**
 * Generic interface for ideate-start mode runners.
 * Each mode (interview, outline, teleprompter, etc.) implements this contract.
 */
export interface StartModeRunner {
  readonly mode: StartMode
  run(idea: Idea, answerProvider: AnswerProvider): Promise<InterviewResult>
  abort(): Promise<void>
}

/**
 * Async function that provides an answer to a question.
 * Called by the agent when it needs user input.
 * The SDK consumer or CLI UI implements this to show the question and collect the response.
 */
export type AnswerProvider = (question: string, context: QuestionContext) => Promise<string>

// ============================================================================
// AGENDA
// ============================================================================

/** A single section in a recording agenda, mapped to one idea. */
export interface AgendaSection {
  /** Section position (1-based) */
  order: number
  /** Section title for the recording outline */
  title: string
  /** GitHub Issue number of the idea this section covers */
  ideaIssueNumber: number
  /** Estimated recording time in minutes */
  estimatedMinutes: number
  /** Talking points to cover in this section (from the idea + agent refinement) */
  talkingPoints: string[]
  /** Transition phrase to lead into the NEXT section (empty for last section) */
  transition: string
  /** Recording notes: key phrases, visual cues, energy direction */
  notes: string
}

/** Complete result from agenda generation. */
export interface AgendaResult {
  /** Ordered list of recording sections */
  sections: AgendaSection[]
  /** Opening hook/intro text for the recording */
  intro: string
  /** Closing CTA/outro text */
  outro: string
  /** Total estimated recording duration in minutes */
  estimatedDuration: number
  /** Fully formatted markdown agenda ready to print or save */
  markdown: string
  /** Generation duration in milliseconds */
  durationMs: number
}

/** Options for generating a recording agenda. */
export interface GenerateAgendaOptions {
  /** Override the output file path for the agenda markdown */
  outputPath?: string
}

// ============================================================================
// PIPELINE SPEC (re-exports from L0-pure/pipelineSpec)
// ============================================================================

export type {
  ClipStrategy,
  ToneStrategy,
  DurationRange,
  ClipConfig,
  PartialClipConfig,
  ProcessingConfig,
  ClipsConfig,
  ContentConfig,
  PlatformConfig,
  DistributionConfig,
  PipelineSpec,
  PartialPipelineSpec,
  SkipFlags,
  SpecValidationError,
  PresetName,
} from '../pipelineSpec/index.js'

export {
  isPresetName,
  PRESET_FULL,
  PRESET_CLEAN,
  PRESET_MINIMAL,
  PRESETS,
  getPreset,
  validateSpec,
  mergeWithDefaults,
  applySkipFlags,
  resolveFromFlags,
} from '../pipelineSpec/index.js'

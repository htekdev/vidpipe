/**
 * Type definitions for video-auto-note-taker CLI pipeline.
 *
 * Domain types covering transcription, video metadata, short-clip planning,
 * social-media post generation, and end-to-end pipeline orchestration.
 */

// ============================================================================
// PLATFORM
// ============================================================================

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

/** Word-level timestamp from Whisper */
export interface Word {
  word: string;
  start: number;
  end: number;
}

/** Segment from Whisper transcription */
export interface Segment {
  id: number;
  text: string;
  start: number;
  end: number;
  words: Word[];
}

/** Full transcript result */
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

export interface VideoFile {
  originalPath: string;
  repoPath: string;
  videoDir: string;
  slug: string;
  filename: string;
  duration: number;
  size: number;
  createdAt: Date;
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

/** Caption rendering style: 'shorts' for large centered pop captions, 'medium' for smaller bottom-positioned. */
export type CaptionStyle = 'shorts' | 'medium';

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

/** A planned short clip segment (single or composite) */
export interface ShortSegment {
  start: number;
  end: number;
  description: string;
}

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
  variants?: ShortClipVariant[];
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
// PIPELINE
// ============================================================================

export enum PipelineStage {
  Ingestion = 'ingestion',
  Transcription = 'transcription',
  SilenceRemoval = 'silence-removal',
  Chapters = 'chapters',
  Captions = 'captions',
  CaptionBurn = 'caption-burn',
  Summary = 'summary',
  Shorts = 'shorts',
  MediumClips = 'medium-clips',
  SocialMedia = 'social-media',
  ShortPosts = 'short-posts',
  MediumClipPosts = 'medium-clip-posts',
  Blog = 'blog',
  GitPush = 'git-push',
}

export interface StageResult {
  stage: PipelineStage;
  success: boolean;
  error?: string;
  duration: number;
}

export interface PipelineResult {
  video: VideoFile;
  transcript?: Transcript;
  editedVideoPath?: string;
  captions?: string[];
  captionedVideoPath?: string;
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
// SILENCE REMOVAL
// ============================================================================

export interface SilenceRemovalResult {
  editedPath: string;
  removals: { start: number; end: number }[];
  keepSegments: { start: number; end: number }[];
  wasEdited: boolean;
}

// ============================================================================
// AGENT RESULT (Copilot SDK)
// ============================================================================

export interface AgentResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

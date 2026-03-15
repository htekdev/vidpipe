import type {
  CreateIdeaInput,
  Idea,
  IdeaFilters,
  MediumClip,
  PipelineResult,
  Platform,
  ScheduleSlot,
  ShortClip,
  SocialPost,
} from '../../L0-pure/types/index.js'
import type { ScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'

/**
 * Configuration options for the VidPipe SDK factory.
 *
 * All properties are optional so the SDK can be created with zero configuration.
 */
export interface VidPipeConfig {
  // API Keys
  openaiApiKey?: string
  anthropicApiKey?: string
  exaApiKey?: string
  youtubeApiKey?: string
  perplexityApiKey?: string
  lateApiKey?: string
  lateProfileId?: string
  githubToken?: string
  geminiApiKey?: string

  // LLM Configuration
  llmProvider?: 'copilot' | 'openai' | 'claude'
  llmModel?: string

  // Paths
  outputDir?: string
  watchFolder?: string
  brandPath?: string
  repoRoot?: string

  // Feature flags
  verbose?: boolean

  // GitHub/Ideas
  ideasRepo?: string
  geminiModel?: string
}

/**
 * Options for processing a video through the VidPipe pipeline.
 */
export interface ProcessOptions {
  /** Comma-separated idea issue numbers to link to this video */
  ideas?: number[]
  /** Skip specific pipeline stages */
  skipGit?: boolean
  /** Skip the silence removal stage */
  skipSilenceRemoval?: boolean
  /** Skip short clip generation */
  skipShorts?: boolean
  /** Skip medium clip generation */
  skipMediumClips?: boolean
  /** Skip social content generation */
  skipSocial?: boolean
  /** Skip caption generation and caption burn steps */
  skipCaptions?: boolean
  /** Skip visual enhancement processing */
  skipVisualEnhancement?: boolean
  /** Skip publishing generated social content */
  skipSocialPublish?: boolean
}

/**
 * Options for AI-assisted idea generation.
 */
export interface IdeateOptions {
  /** Seed topics for idea generation */
  topics?: string[]
  /** Number of ideas to generate */
  count?: number
  /** Path to brand.json config */
  brandPath?: string
}

/**
 * Options for finding the next scheduling slot.
 */
export interface SlotOptions {
  /** Idea issue numbers for spacing rules */
  ideaIds?: number[]
  /** Urgency deadline (ISO 8601 date) */
  publishBy?: string
}

/**
 * Options for schedule realignment.
 */
export interface RealignOptions {
  /** Filter to specific platform */
  platform?: string
  /** Preview only, don't execute */
  dryRun?: boolean
}

/**
 * A single diagnostic check returned by the SDK doctor command.
 */
export interface DiagnosticCheck {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  details?: string
}

/**
 * Aggregate result returned by the SDK doctor command.
 */
export interface DiagnosticResult {
  checks: DiagnosticCheck[]
  allPassed: boolean
}

/**
 * Union of clip result types produced by VidPipe.
 */
export type GeneratedClip = ShortClip | MediumClip

/**
 * Main VidPipe SDK interface.
 */
export interface VidPipeSDK {
  /** Run the full video processing pipeline */
  processVideo(videoPath: string, options?: ProcessOptions): Promise<PipelineResult>

  /** Generate AI-powered content ideas */
  ideate(options?: IdeateOptions): Promise<Idea[]>

  /** Idea management */
  ideas: {
    list(filters?: IdeaFilters): Promise<Idea[]>
    get(issueNumber: number): Promise<Idea | null>
    create(input: CreateIdeaInput): Promise<Idea>
    update(issueNumber: number, updates: Partial<CreateIdeaInput>): Promise<Idea>
  }

  /** Schedule management */
  schedule: {
    findNextSlot(platform: string, clipType?: string, options?: SlotOptions): Promise<string | null>
    getCalendar(startDate?: Date, endDate?: Date): Promise<ScheduleSlot[]>
    realign(options?: RealignOptions): Promise<{ moved: number; skipped: number }>
    loadConfig(): Promise<ScheduleConfig>
  }

  /** Video operations */
  video: {
    extractClip(videoPath: string, start: number, end: number, output: string): Promise<string>
    burnCaptions(videoPath: string, captionsFile: string, output: string): Promise<string>
    detectSilence(videoPath: string, options?: { threshold?: string; minDuration?: number }): Promise<Array<{ start: number; end: number }>>
    generateVariants(videoPath: string, platforms: Platform[], outputDir: string): Promise<Array<{ platform: Platform; path: string }>>
    captureFrame(videoPath: string, timestamp: number, output: string): Promise<string>
  }

  /** Social media operations */
  social: {
    generatePosts(context: { title: string; description: string; tags: string[] }, platforms: Platform[]): Promise<SocialPost[]>
  }

  /** Run diagnostic checks */
  doctor(): Promise<DiagnosticResult>

  /** Configuration access */
  config: {
    get(key: string): string | boolean | undefined
    getAll(): Record<string, unknown>
    set(key: string, value: string | boolean): void
    save(): Promise<void>
    path(): string
  }
}

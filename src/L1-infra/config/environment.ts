import { join } from '../paths/paths.js'
import { fileExistsSync } from '../fileSystem/fileSystem.js'
import { loadEnvFile } from '../env/env.js'
import { resolveConfig } from './configResolver.js'

// Load .env file from repo root
const envPath = join(process.cwd(), '.env')
if (fileExistsSync(envPath)) {
  loadEnvFile(envPath)
}

export interface AppEnvironment {
  OPENAI_API_KEY: string
  WATCH_FOLDER: string
  REPO_ROOT: string
  FFMPEG_PATH: string
  FFPROBE_PATH: string
  EXA_API_KEY: string
  EXA_MCP_URL: string
  YOUTUBE_API_KEY: string
  PERPLEXITY_API_KEY: string
  LLM_PROVIDER: string
  LLM_MODEL: string
  ANTHROPIC_API_KEY: string
  OUTPUT_DIR: string
  BRAND_PATH: string
  VERBOSE: boolean
  SKIP_SILENCE_REMOVAL: boolean
  SKIP_SHORTS: boolean
  SKIP_MEDIUM_CLIPS: boolean
  SKIP_SOCIAL: boolean
  SKIP_CAPTIONS: boolean
  SKIP_VISUAL_ENHANCEMENT: boolean
  SKIP_INTRO_OUTRO: boolean
  LATE_API_KEY: string
  LATE_PROFILE_ID: string
  SKIP_SOCIAL_PUBLISH: boolean
  GEMINI_API_KEY: string
  GEMINI_MODEL: string
  /** GitHub repository for idea tracking (format: owner/repo) */
  IDEAS_REPO: string
  /** GitHub Personal Access Token with repo + project scopes */
  GITHUB_TOKEN: string
  /** Per-agent model overrides from MODEL_* env vars (e.g. MODEL_SHORTS_AGENT=gpt-4o) */
  MODEL_OVERRIDES: Readonly<Record<string, string>>
  /** Azure Storage account name for cloud persistence */
  AZURE_STORAGE_ACCOUNT_NAME: string
  /** Azure Storage account key for authentication */
  AZURE_STORAGE_ACCOUNT_KEY: string
  /** Azure Blob container name (default: vidpipe) */
  AZURE_CONTAINER_NAME: string
}

export interface CLIOptions {
  watchDir?: string
  outputDir?: string
  openaiKey?: string
  exaKey?: string
  youtubeKey?: string
  perplexityKey?: string
  brand?: string
  verbose?: boolean
  silenceRemoval?: boolean
  shorts?: boolean
  mediumClips?: boolean
  social?: boolean
  captions?: boolean
  visualEnhancement?: boolean
  introOutro?: boolean
  socialPublish?: boolean
  lateApiKey?: string
  lateProfileId?: string
  ideasRepo?: string
  githubToken?: string
  anthropicKey?: string
  geminiKey?: string
  llmProvider?: string
  llmModel?: string
  geminiModel?: string
  repoRoot?: string
  ffmpegPath?: string
  ffprobePath?: string
  azureStorageAccountName?: string
  azureStorageAccountKey?: string
  azureContainerName?: string
}

let config: AppEnvironment | null = null

export function validateRequiredKeys(): void {
  if (!config?.OPENAI_API_KEY) {
    throw new Error('Missing required: OPENAI_API_KEY (set via --openai-key, env var, or vidpipe configure)')
  }
}

/** Merge CLI options → env vars → global config → defaults. Call before getConfig(). */
export function initConfig(cli: CLIOptions = {}): AppEnvironment {
  config = resolveConfig(cli)
  return config
}

export function getConfig(): AppEnvironment {
  if (config) {
    return config
  }

  // Fallback: init with no CLI options (resolve from env + global config)
  return initConfig()
}

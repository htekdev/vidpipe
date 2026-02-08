import path from 'path'
import fs from 'fs'
import dotenv from 'dotenv'

// Load .env file from repo root
const envPath = path.join(process.cwd(), '.env')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
}

export interface AppEnvironment {
  OPENAI_API_KEY: string
  WATCH_FOLDER: string
  REPO_ROOT: string
  FFMPEG_PATH: string
  FFPROBE_PATH: string
  EXA_API_KEY: string
  OUTPUT_DIR: string
  BRAND_PATH: string
  VERBOSE: boolean
  SKIP_GIT: boolean
  SKIP_SILENCE_REMOVAL: boolean
  SKIP_SHORTS: boolean
  SKIP_MEDIUM_CLIPS: boolean
  SKIP_SOCIAL: boolean
  SKIP_CAPTIONS: boolean
}

export interface CLIOptions {
  watchDir?: string
  outputDir?: string
  openaiKey?: string
  exaKey?: string
  brand?: string
  verbose?: boolean
  git?: boolean
  silenceRemoval?: boolean
  shorts?: boolean
  mediumClips?: boolean
  social?: boolean
  captions?: boolean
}

let config: AppEnvironment | null = null

export function validateRequiredKeys(): void {
  if (!config?.OPENAI_API_KEY && !process.env.OPENAI_API_KEY) {
    throw new Error('Missing required: OPENAI_API_KEY (set via --openai-key or env var)')
  }
}

/** Merge CLI options → env vars → defaults. Call before getConfig(). */
export function initConfig(cli: CLIOptions = {}): AppEnvironment {
  const repoRoot = process.env.REPO_ROOT || process.cwd()

  config = {
    OPENAI_API_KEY: cli.openaiKey || process.env.OPENAI_API_KEY || '',
    WATCH_FOLDER: cli.watchDir || process.env.WATCH_FOLDER || path.join(repoRoot, 'watch'),
    REPO_ROOT: repoRoot,
    FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',   // legacy; prefer ffmpegResolver
    FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe', // legacy; prefer ffmpegResolver
    EXA_API_KEY: cli.exaKey || process.env.EXA_API_KEY || '',
    OUTPUT_DIR: cli.outputDir || process.env.OUTPUT_DIR || path.join(repoRoot, 'recordings'),
    BRAND_PATH: cli.brand || process.env.BRAND_PATH || path.join(repoRoot, 'brand.json'),
    VERBOSE: cli.verbose ?? false,
    SKIP_GIT: cli.git === false,
    SKIP_SILENCE_REMOVAL: cli.silenceRemoval === false,
    SKIP_SHORTS: cli.shorts === false,
    SKIP_MEDIUM_CLIPS: cli.mediumClips === false,
    SKIP_SOCIAL: cli.social === false,
    SKIP_CAPTIONS: cli.captions === false,
  }

  return config
}

export function getConfig(): AppEnvironment {
  if (config) {
    return config
  }

  // Fallback: init with no CLI options (pure env-var mode)
  return initConfig()
}

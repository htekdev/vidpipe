import { join } from 'node:path'

import { loadGlobalConfig } from './globalConfig.js'
import type { AppEnvironment, CLIOptions } from './environment.js'

/**
 * Resolve a config value from a prioritized list of sources.
 *
 * The first arg is the CLI option — treated as explicit even when empty string
 * (the user passed it deliberately). Remaining args are env/config fallbacks
 * where empty strings are skipped (they indicate "not configured").
 */
function resolveString(cliValue: string | undefined, ...fallbacks: Array<string | undefined>): string {
  if (cliValue !== undefined) return cliValue

  for (const source of fallbacks) {
    if (source !== undefined && source !== '') {
      return source
    }
  }

  return ''
}

function resolveBoolean(
  cliValue: boolean | undefined,
  envValue: string | undefined,
  defaultValue: boolean,
): boolean {
  if (cliValue !== undefined) {
    return cliValue
  }

  if (envValue !== undefined) {
    return envValue === 'true' || envValue === '1'
  }

  return defaultValue
}

export function resolveConfig(cliOptions: Partial<CLIOptions> = {}): AppEnvironment {
  const globalConfig = loadGlobalConfig()
  const repoRoot = resolveString(
    cliOptions.repoRoot,
    process.env.REPO_ROOT,
    process.cwd(),
  )

  return {
    OPENAI_API_KEY: resolveString(
      cliOptions.openaiKey,
      process.env.OPENAI_API_KEY,
      globalConfig.credentials.openaiApiKey,
    ),
    WATCH_FOLDER: resolveString(
      cliOptions.watchDir,
      process.env.WATCH_FOLDER,
      globalConfig.defaults.watchFolder,
      join(repoRoot, 'watch'),
    ),
    REPO_ROOT: repoRoot,
    FFMPEG_PATH: resolveString(
      cliOptions.ffmpegPath,
      process.env.FFMPEG_PATH,
      'ffmpeg',
    ),
    FFPROBE_PATH: resolveString(
      cliOptions.ffprobePath,
      process.env.FFPROBE_PATH,
      'ffprobe',
    ),
    EXA_API_KEY: resolveString(
      cliOptions.exaKey,
      process.env.EXA_API_KEY,
      globalConfig.credentials.exaApiKey,
    ),
    EXA_MCP_URL: resolveString(undefined, process.env.EXA_MCP_URL, 'https://mcp.exa.ai/mcp'),
    YOUTUBE_API_KEY: resolveString(
      cliOptions.youtubeKey,
      process.env.YOUTUBE_API_KEY,
      globalConfig.credentials.youtubeApiKey,
    ),
    PERPLEXITY_API_KEY: resolveString(
      cliOptions.perplexityKey,
      process.env.PERPLEXITY_API_KEY,
      globalConfig.credentials.perplexityApiKey,
    ),
    LLM_PROVIDER: resolveString(
      cliOptions.llmProvider,
      process.env.LLM_PROVIDER,
      globalConfig.defaults.llmProvider,
      'copilot',
    ),
    LLM_MODEL: resolveString(
      cliOptions.llmModel,
      process.env.LLM_MODEL,
      globalConfig.defaults.llmModel,
    ),
    ANTHROPIC_API_KEY: resolveString(
      cliOptions.anthropicKey,
      process.env.ANTHROPIC_API_KEY,
      globalConfig.credentials.anthropicApiKey,
    ),
    OUTPUT_DIR: resolveString(
      cliOptions.outputDir,
      process.env.OUTPUT_DIR,
      globalConfig.defaults.outputDir,
      join(repoRoot, 'recordings'),
    ),
    BRAND_PATH: resolveString(
      cliOptions.brand,
      process.env.BRAND_PATH,
      globalConfig.defaults.brandPath,
      join(repoRoot, 'brand.json'),
    ),
    VERBOSE: cliOptions.verbose ?? false,
    SKIP_SILENCE_REMOVAL: resolveBoolean(
      cliOptions.silenceRemoval === undefined ? undefined : !cliOptions.silenceRemoval,
      process.env.SKIP_SILENCE_REMOVAL,
      false,
    ),
    SKIP_SHORTS: resolveBoolean(
      cliOptions.shorts === undefined ? undefined : !cliOptions.shorts,
      process.env.SKIP_SHORTS,
      false,
    ),
    SKIP_MEDIUM_CLIPS: resolveBoolean(
      cliOptions.mediumClips === undefined ? undefined : !cliOptions.mediumClips,
      process.env.SKIP_MEDIUM_CLIPS,
      false,
    ),
    SKIP_SOCIAL: resolveBoolean(
      cliOptions.social === undefined ? undefined : !cliOptions.social,
      process.env.SKIP_SOCIAL,
      false,
    ),
    SKIP_CAPTIONS: resolveBoolean(
      cliOptions.captions === undefined ? undefined : !cliOptions.captions,
      process.env.SKIP_CAPTIONS,
      false,
    ),
    SKIP_VISUAL_ENHANCEMENT: resolveBoolean(
      cliOptions.visualEnhancement === undefined ? undefined : !cliOptions.visualEnhancement,
      process.env.SKIP_VISUAL_ENHANCEMENT,
      false,
    ),
    LATE_API_KEY: resolveString(
      cliOptions.lateApiKey,
      process.env.LATE_API_KEY,
      globalConfig.credentials.lateApiKey,
    ),
    LATE_PROFILE_ID: resolveString(
      cliOptions.lateProfileId,
      process.env.LATE_PROFILE_ID,
      globalConfig.defaults.lateProfileId,
    ),
    SKIP_SOCIAL_PUBLISH: resolveBoolean(
      cliOptions.socialPublish === undefined ? undefined : !cliOptions.socialPublish,
      process.env.SKIP_SOCIAL_PUBLISH,
      false,
    ),
    GEMINI_API_KEY: resolveString(
      cliOptions.geminiKey,
      process.env.GEMINI_API_KEY,
      globalConfig.credentials.geminiApiKey,
    ),
    GEMINI_MODEL: resolveString(
      cliOptions.geminiModel,
      process.env.GEMINI_MODEL,
      globalConfig.defaults.geminiModel,
      'gemini-2.5-pro',
    ),
    IDEAS_REPO: resolveString(
      cliOptions.ideasRepo,
      process.env.IDEAS_REPO,
      globalConfig.defaults.ideasRepo,
      'htekdev/content-management',
    ),
    GITHUB_TOKEN: resolveString(
      cliOptions.githubToken,
      process.env.GITHUB_TOKEN,
      globalConfig.credentials.githubToken,
    ),
    MODEL_OVERRIDES: resolveModelOverrides(),
  }
}

/** Scan process.env for MODEL_* vars and return as a lookup map. */
function resolveModelOverrides(): Readonly<Record<string, string>> {
  const overrides: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('MODEL_') && value) {
      overrides[key] = value
    }
  }
  return overrides
}

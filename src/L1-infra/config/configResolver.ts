import { join } from 'node:path'

import { loadGlobalConfig } from './globalConfig.js'
import type { AppEnvironment, CLIOptions } from './environment.js'

function resolveString(...sources: Array<string | undefined>): string {
  for (const source of sources) {
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
  const repoRoot = process.env.REPO_ROOT || process.cwd()

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
    FFMPEG_PATH: resolveString(process.env.FFMPEG_PATH, 'ffmpeg'),
    FFPROBE_PATH: resolveString(process.env.FFPROBE_PATH, 'ffprobe'),
    EXA_API_KEY: resolveString(
      cliOptions.exaKey,
      process.env.EXA_API_KEY,
      globalConfig.credentials.exaApiKey,
    ),
    EXA_MCP_URL: resolveString(process.env.EXA_MCP_URL, 'https://mcp.exa.ai/mcp'),
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
      process.env.LLM_PROVIDER,
      globalConfig.defaults.llmProvider,
      'copilot',
    ),
    LLM_MODEL: resolveString(process.env.LLM_MODEL, globalConfig.defaults.llmModel),
    ANTHROPIC_API_KEY: resolveString(
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
    SKIP_GIT: resolveBoolean(cliOptions.git === undefined ? undefined : !cliOptions.git, process.env.SKIP_GIT, false),
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
      process.env.GEMINI_API_KEY,
      globalConfig.credentials.geminiApiKey,
    ),
    GEMINI_MODEL: resolveString(
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
  }
}

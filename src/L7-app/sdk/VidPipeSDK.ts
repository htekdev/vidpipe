import {
  PLATFORM_CHAR_LIMITS,
  Platform,
} from '../../L0-pure/types/index.js'
import type { SocialPost } from '../../L0-pure/types/index.js'
import { getConfig, initConfig } from '../../L1-infra/config/environment.js'
import type { AppEnvironment, CLIOptions } from '../../L1-infra/config/environment.js'
import {
  getConfigPath,
  loadGlobalConfig,
  saveGlobalConfig,
  setGlobalConfigValue,
} from '../../L1-infra/config/globalConfig.js'
import type {
  GlobalCredentials,
  GlobalDefaults,
} from '../../L1-infra/config/globalConfig.js'
import {
  ensureDirectory,
  fileExistsSync,
  writeTextFile,
} from '../../L1-infra/fileSystem/fileSystem.js'
import { join } from '../../L1-infra/paths/paths.js'
import { spawnCommand } from '../../L1-infra/process/process.js'
import { getFFmpegPath, getFFprobePath } from '../../L3-services/diagnostics/diagnostics.js'
import {
  createIdea,
  getIdea,
  listIdeas,
  updateIdea,
} from '../../L3-services/ideaService/ideaService.js'
import { getIdeasByIds } from '../../L3-services/ideation/ideaService.js'
import { createLateApiClient } from '../../L3-services/lateApi/lateApiService.js'
import { buildRealignPlan, executeRealignPlan } from '../../L3-services/scheduler/realign.js'
import { loadScheduleConfig } from '../../L3-services/scheduler/scheduleConfig.js'
import { findNextSlot, getScheduleCalendar } from '../../L3-services/scheduler/scheduler.js'
import {
  burnCaptions,
  captureFrame,
  detectSilence,
  extractClip,
  generatePlatformVariants,
} from '../../L3-services/videoOperations/videoOperations.js'
import type { Platform as VariantPlatform } from '../../L3-services/videoOperations/videoOperations.js'
import { generateIdeas } from '../../L6-pipeline/ideation.js'
import { processVideoSafe } from '../../L6-pipeline/pipeline.js'
import type {
  DiagnosticCheck,
  DiagnosticResult,
  IdeateOptions,
  ProcessOptions,
  RealignOptions,
  SlotOptions,
  VidPipeConfig,
  VidPipeSDK,
} from './types.js'

type CredentialKey = keyof GlobalCredentials
type DefaultKey = keyof GlobalDefaults
type KnownProvider = keyof typeof providerDefaults

type ConfigKeyTarget =
  | { readonly section: 'credentials'; readonly key: CredentialKey }
  | { readonly section: 'defaults'; readonly key: DefaultKey }

const credentialKeys = [
  'openaiApiKey',
  'anthropicApiKey',
  'exaApiKey',
  'youtubeApiKey',
  'perplexityApiKey',
  'lateApiKey',
  'githubToken',
  'geminiApiKey',
] as const satisfies readonly CredentialKey[]

const defaultKeys = [
  'llmProvider',
  'llmModel',
  'outputDir',
  'watchFolder',
  'brandPath',
  'ideasRepo',
  'lateProfileId',
  'geminiModel',
] as const satisfies readonly DefaultKey[]

const configKeyMap = {
  'openai-key': { section: 'credentials', key: 'openaiApiKey' },
  'anthropic-key': { section: 'credentials', key: 'anthropicApiKey' },
  'exa-key': { section: 'credentials', key: 'exaApiKey' },
  'youtube-key': { section: 'credentials', key: 'youtubeApiKey' },
  'perplexity-key': { section: 'credentials', key: 'perplexityApiKey' },
  'late-key': { section: 'credentials', key: 'lateApiKey' },
  'github-token': { section: 'credentials', key: 'githubToken' },
  'gemini-key': { section: 'credentials', key: 'geminiApiKey' },
  'llm-provider': { section: 'defaults', key: 'llmProvider' },
  'llm-model': { section: 'defaults', key: 'llmModel' },
  'output-dir': { section: 'defaults', key: 'outputDir' },
  'watch-folder': { section: 'defaults', key: 'watchFolder' },
  'brand-path': { section: 'defaults', key: 'brandPath' },
  'ideas-repo': { section: 'defaults', key: 'ideasRepo' },
  'late-profile-id': { section: 'defaults', key: 'lateProfileId' },
  'gemini-model': { section: 'defaults', key: 'geminiModel' },
} as const satisfies Record<string, ConfigKeyTarget>

const providerDefaults = {
  copilot: 'Claude Opus 4.6',
  openai: 'gpt-4o',
  claude: 'claude-opus-4.6',
} as const

const runtimeConfigKeyMap = {
  'credentials.openaiApiKey': 'OPENAI_API_KEY',
  'credentials.anthropicApiKey': 'ANTHROPIC_API_KEY',
  'credentials.exaApiKey': 'EXA_API_KEY',
  'credentials.youtubeApiKey': 'YOUTUBE_API_KEY',
  'credentials.perplexityApiKey': 'PERPLEXITY_API_KEY',
  'credentials.lateApiKey': 'LATE_API_KEY',
  'credentials.githubToken': 'GITHUB_TOKEN',
  'credentials.geminiApiKey': 'GEMINI_API_KEY',
  'defaults.llmProvider': 'LLM_PROVIDER',
  'defaults.llmModel': 'LLM_MODEL',
  'defaults.outputDir': 'OUTPUT_DIR',
  'defaults.watchFolder': 'WATCH_FOLDER',
  'defaults.brandPath': 'BRAND_PATH',
  'defaults.ideasRepo': 'IDEAS_REPO',
  'defaults.lateProfileId': 'LATE_PROFILE_ID',
  'defaults.geminiModel': 'GEMINI_MODEL',
} as const satisfies Record<string, keyof AppEnvironment>

const platformVariantMap: Readonly<Record<string, VariantPlatform>> = {
  instagram: 'instagram-reels',
  'instagram-feed': 'instagram-feed',
  'instagram-reels': 'instagram-reels',
  linkedin: 'linkedin',
  tiktok: 'tiktok',
  twitter: 'twitter',
  x: 'twitter',
  youtube: 'youtube',
  'youtube-shorts': 'youtube-shorts',
}

function applySdkEnvironment(sdkConfig?: VidPipeConfig): void {
  if (!sdkConfig) {
    return
  }

  if (sdkConfig.anthropicApiKey) process.env.ANTHROPIC_API_KEY = sdkConfig.anthropicApiKey
  if (sdkConfig.geminiApiKey) process.env.GEMINI_API_KEY = sdkConfig.geminiApiKey
  if (sdkConfig.llmProvider) process.env.LLM_PROVIDER = sdkConfig.llmProvider
  if (sdkConfig.llmModel) process.env.LLM_MODEL = sdkConfig.llmModel
  if (sdkConfig.geminiModel) process.env.GEMINI_MODEL = sdkConfig.geminiModel
  if (sdkConfig.repoRoot) process.env.REPO_ROOT = sdkConfig.repoRoot
}

function mapSdkConfigToCliOptions(sdkConfig?: VidPipeConfig): CLIOptions {
  return {
    openaiKey: sdkConfig?.openaiApiKey,
    exaKey: sdkConfig?.exaApiKey,
    youtubeKey: sdkConfig?.youtubeApiKey,
    perplexityKey: sdkConfig?.perplexityApiKey,
    outputDir: sdkConfig?.outputDir,
    watchDir: sdkConfig?.watchFolder,
    brand: sdkConfig?.brandPath,
    verbose: sdkConfig?.verbose,
    lateApiKey: sdkConfig?.lateApiKey,
    lateProfileId: sdkConfig?.lateProfileId,
    ideasRepo: sdkConfig?.ideasRepo,
    githubToken: sdkConfig?.githubToken,
  }
}

function mapProcessOptionsToCliOverrides(options?: ProcessOptions): Partial<CLIOptions> {
  const overrides: Partial<CLIOptions> = {}

  if (options?.skipGit !== undefined) overrides.git = !options.skipGit
  if (options?.skipSilenceRemoval !== undefined) overrides.silenceRemoval = !options.skipSilenceRemoval
  if (options?.skipShorts !== undefined) overrides.shorts = !options.skipShorts
  if (options?.skipMediumClips !== undefined) overrides.mediumClips = !options.skipMediumClips
  if (options?.skipSocial !== undefined) overrides.social = !options.skipSocial
  if (options?.skipCaptions !== undefined) overrides.captions = !options.skipCaptions
  if (options?.skipVisualEnhancement !== undefined) overrides.visualEnhancement = !options.skipVisualEnhancement
  if (options?.skipSocialPublish !== undefined) overrides.socialPublish = !options.skipSocialPublish

  return overrides
}

function hasCliOverrides(overrides: Partial<CLIOptions>): boolean {
  return Object.values(overrides).some((value) => value !== undefined)
}

function isKnownCredentialKey(key: string): key is CredentialKey {
  return credentialKeys.includes(key as CredentialKey)
}

function isKnownDefaultKey(key: string): key is DefaultKey {
  return defaultKeys.includes(key as DefaultKey)
}

function isKnownProvider(value: string): value is KnownProvider {
  return value === 'copilot' || value === 'openai' || value === 'claude'
}

function resolveConfigTarget(rawKey: string): ConfigKeyTarget | undefined {
  const normalized = rawKey.trim()
  const mapped = (configKeyMap as Readonly<Record<string, ConfigKeyTarget>>)[normalized]
  if (mapped) {
    return mapped
  }

  if (isKnownCredentialKey(normalized)) {
    return { section: 'credentials', key: normalized }
  }

  if (isKnownDefaultKey(normalized)) {
    return { section: 'defaults', key: normalized }
  }

  const [section, ...keyParts] = normalized.split('.')
  const key = keyParts.join('.')
  if (section === 'credentials' && isKnownCredentialKey(key)) {
    return { section, key }
  }
  if (section === 'defaults' && isKnownDefaultKey(key)) {
    return { section, key }
  }

  return undefined
}

function applyPersistedConfigToRuntime(
  target: ConfigKeyTarget,
  value: string,
  currentCliOptions: CLIOptions,
): void {
  switch (`${target.section}.${target.key}`) {
    case 'credentials.openaiApiKey':
      currentCliOptions.openaiKey = value
      break
    case 'credentials.exaApiKey':
      currentCliOptions.exaKey = value
      break
    case 'credentials.youtubeApiKey':
      currentCliOptions.youtubeKey = value
      break
    case 'credentials.perplexityApiKey':
      currentCliOptions.perplexityKey = value
      break
    case 'credentials.lateApiKey':
      currentCliOptions.lateApiKey = value
      break
    case 'credentials.githubToken':
      currentCliOptions.githubToken = value
      break
    case 'credentials.anthropicApiKey':
      process.env.ANTHROPIC_API_KEY = value
      break
    case 'credentials.geminiApiKey':
      process.env.GEMINI_API_KEY = value
      break
    case 'defaults.outputDir':
      currentCliOptions.outputDir = value
      break
    case 'defaults.watchFolder':
      currentCliOptions.watchDir = value
      break
    case 'defaults.brandPath':
      currentCliOptions.brand = value
      break
    case 'defaults.ideasRepo':
      currentCliOptions.ideasRepo = value
      break
    case 'defaults.lateProfileId':
      currentCliOptions.lateProfileId = value
      break
    case 'defaults.llmProvider':
      process.env.LLM_PROVIDER = value
      break
    case 'defaults.llmModel':
      process.env.LLM_MODEL = value
      break
    case 'defaults.geminiModel':
      process.env.GEMINI_MODEL = value
      break
    default:
      break
  }
}

function applyRuntimeOnlyOverride(
  rawKey: string,
  value: string | boolean,
  currentCliOptions: CLIOptions,
): boolean {
  const normalized = rawKey.trim()

  switch (normalized) {
    case 'verbose':
    case 'VERBOSE':
      currentCliOptions.verbose = Boolean(value)
      return true
    case 'skipGit':
    case 'SKIP_GIT':
      currentCliOptions.git = !Boolean(value)
      return true
    case 'skipSilenceRemoval':
    case 'SKIP_SILENCE_REMOVAL':
      currentCliOptions.silenceRemoval = !Boolean(value)
      return true
    case 'skipShorts':
    case 'SKIP_SHORTS':
      currentCliOptions.shorts = !Boolean(value)
      return true
    case 'skipMediumClips':
    case 'SKIP_MEDIUM_CLIPS':
      currentCliOptions.mediumClips = !Boolean(value)
      return true
    case 'skipSocial':
    case 'SKIP_SOCIAL':
      currentCliOptions.social = !Boolean(value)
      return true
    case 'skipCaptions':
    case 'SKIP_CAPTIONS':
      currentCliOptions.captions = !Boolean(value)
      return true
    case 'skipVisualEnhancement':
    case 'SKIP_VISUAL_ENHANCEMENT':
      currentCliOptions.visualEnhancement = !Boolean(value)
      return true
    case 'skipSocialPublish':
    case 'SKIP_SOCIAL_PUBLISH':
      currentCliOptions.socialPublish = !Boolean(value)
      return true
    case 'repoRoot':
    case 'REPO_ROOT':
      process.env.REPO_ROOT = String(value)
      return true
    case 'ffmpegPath':
    case 'FFMPEG_PATH':
      process.env.FFMPEG_PATH = String(value)
      return true
    case 'ffprobePath':
    case 'FFPROBE_PATH':
      process.env.FFPROBE_PATH = String(value)
      return true
    default:
      return false
  }
}

function normalizeProviderName(raw: string | undefined): string {
  return (raw || 'copilot').trim().toLowerCase()
}

function parseVersionFromOutput(output: string): string {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/)
  return match ? match[1] : 'unknown'
}

function trimToLimit(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }

  if (limit <= 1) {
    return text.slice(0, limit)
  }

  return `${text.slice(0, limit - 1).trimEnd()}…`
}

function normalizeHashtag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
}

function uniqueHashtags(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const hashtags: string[] = []

  for (const tag of tags) {
    const normalized = normalizeHashtag(tag)
    if (!normalized) {
      continue
    }

    const canonical = normalized.toLowerCase()
    if (seen.has(canonical)) {
      continue
    }

    seen.add(canonical)
    hashtags.push(`#${normalized}`)
  }

  return hashtags
}

function getPlatformCharacterLimit(platform: Platform): number {
  return platform === Platform.X
    ? PLATFORM_CHAR_LIMITS.twitter
    : PLATFORM_CHAR_LIMITS[platform] ?? 280
}

function buildSocialContent(
  platform: Platform,
  context: { title: string; description: string; tags: string[] },
): string {
  const title = context.title.trim()
  const description = context.description.trim()

  switch (platform) {
    case Platform.X:
      return trimToLimit(`${title}: ${description}`.trim(), getPlatformCharacterLimit(platform))
    case Platform.LinkedIn:
      return trimToLimit(
        `${title}\n\n${description}\n\nWhat would you add or try next?`.trim(),
        getPlatformCharacterLimit(platform),
      )
    case Platform.Instagram:
      return trimToLimit(
        `${title}\n\n${description}\n\nSave this for your next editing session.`.trim(),
        getPlatformCharacterLimit(platform),
      )
    case Platform.TikTok:
      return trimToLimit(
        `${title}\n\n${description}\n\nFollow for more creator workflow tips.`.trim(),
        getPlatformCharacterLimit(platform),
      )
    case Platform.YouTube:
      return trimToLimit(`${title}\n\n${description}`.trim(), getPlatformCharacterLimit(platform))
    default:
      return trimToLimit(`${title}\n\n${description}`.trim(), getPlatformCharacterLimit(platform))
  }
}

function mapVariantPlatforms(platforms: readonly string[]): VariantPlatform[] {
  return platforms.map((platform) => {
    const normalized = platform.trim().toLowerCase()
    const mapped = platformVariantMap[normalized]
    if (!mapped) {
      throw new Error(`Unsupported variant platform: ${platform}`)
    }
    return mapped
  })
}

function getVariantSlug(videoPath: string): string {
  // Handle both Windows and POSIX separators regardless of platform
  const basename = videoPath.split(/[\\/]/).pop() ?? videoPath
  return basename.replace(/\.[^.]+$/, '')
}

function buildDiagnosticStatus(
  required: boolean,
  passed: boolean,
): DiagnosticCheck['status'] {
  if (passed) {
    return 'pass'
  }

  return required ? 'fail' : 'warn'
}

function getConfigRecord(config: AppEnvironment): Record<string, string | boolean | undefined> {
  return config as unknown as Record<string, string | boolean | undefined>
}

function getRuntimeConfigKey(target: ConfigKeyTarget): keyof AppEnvironment {
  return runtimeConfigKeyMap[`${target.section}.${target.key}` as keyof typeof runtimeConfigKeyMap]
}

function getResolvedConfigValue(key: string): string | boolean | undefined {
  const normalizedKey = key.trim()
  const configRecord = getConfigRecord(getConfig())
  const target = resolveConfigTarget(normalizedKey)

  if (target) {
    return configRecord[getRuntimeConfigKey(target)]
  }

  const directValue = configRecord[normalizedKey]
  if (typeof directValue === 'string' || typeof directValue === 'boolean') {
    return directValue
  }

  const uppercaseValue = configRecord[normalizedKey.toUpperCase()]
  if (typeof uppercaseValue === 'string' || typeof uppercaseValue === 'boolean') {
    return uppercaseValue
  }

  return undefined
}

// No L3/L6 wrapper exists for free-form social post generation from title/description/tags,
// so the SDK provides a deterministic formatter and writes the generated posts to disk.
async function buildSocialPosts(
  context: { title: string; description: string; tags: string[] },
  platforms: readonly Platform[],
): Promise<SocialPost[]> {
  const uniquePlatforms = Array.from(new Set(platforms))
  const hashtags = uniqueHashtags(context.tags)
  const outputDir = join(getConfig().OUTPUT_DIR, 'sdk-social')
  const slug = normalizeHashtag(context.title.toLowerCase()) || 'post'

  await ensureDirectory(outputDir)

  return await Promise.all(uniquePlatforms.map(async (platform) => {
    const content = buildSocialContent(platform, context)
    const outputPath = join(outputDir, `${slug}-${platform}.md`)
    const fileContent = [
      `# ${platform}`,
      '',
      content,
      '',
      hashtags.length > 0 ? hashtags.join(' ') : '',
    ].filter((line) => line.length > 0).join('\n')

    await writeTextFile(outputPath, fileContent)

    return {
      platform,
      content,
      hashtags,
      links: [],
      characterCount: content.length,
      outputPath,
    }
  }))
}

export function createVidPipe(sdkConfig?: VidPipeConfig): VidPipeSDK {
  applySdkEnvironment(sdkConfig)

  let currentCliOptions = mapSdkConfigToCliOptions(sdkConfig)
  initConfig(currentCliOptions)

  function refreshConfig(): AppEnvironment {
    return initConfig(currentCliOptions)
  }

  async function withTemporaryCliOverrides<T>(
    overrides: Partial<CLIOptions>,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!hasCliOverrides(overrides)) {
      return await fn()
    }

    const previousCliOptions = { ...currentCliOptions }
    initConfig({ ...currentCliOptions, ...overrides })

    try {
      return await fn()
    } finally {
      initConfig(previousCliOptions)
    }
  }

  async function doctor(): Promise<DiagnosticResult> {
    const config = getConfig()
    const checks: DiagnosticCheck[] = []

    const nodeMajor = Number.parseInt(process.version.slice(1), 10)
    checks.push({
      name: 'node',
      status: buildDiagnosticStatus(true, Number.isInteger(nodeMajor) && nodeMajor >= 20),
      message: Number.isInteger(nodeMajor) && nodeMajor >= 20
        ? `Node.js ${process.version} detected`
        : `Node.js ${process.version} detected — version 20 or newer is required`,
    })

    const ffmpegPath = getFFmpegPath()
    try {
      const result = spawnCommand(ffmpegPath, ['-version'], { timeout: 10_000 })
      const passed = result.status === 0 && typeof result.stdout === 'string' && result.stdout.length > 0
      checks.push({
        name: 'ffmpeg',
        status: buildDiagnosticStatus(true, passed),
        message: passed
          ? `FFmpeg ${parseVersionFromOutput(result.stdout)} available at ${ffmpegPath}`
          : `FFmpeg not available at ${ffmpegPath}`,
      })
    } catch (error: unknown) {
      checks.push({
        name: 'ffmpeg',
        status: 'fail',
        message: 'FFmpeg is not available',
        details: error instanceof Error ? error.message : String(error),
      })
    }

    const ffprobePath = getFFprobePath()
    try {
      const result = spawnCommand(ffprobePath, ['-version'], { timeout: 10_000 })
      const passed = result.status === 0 && typeof result.stdout === 'string' && result.stdout.length > 0
      checks.push({
        name: 'ffprobe',
        status: buildDiagnosticStatus(true, passed),
        message: passed
          ? `FFprobe ${parseVersionFromOutput(result.stdout)} available at ${ffprobePath}`
          : `FFprobe not available at ${ffprobePath}`,
      })
    } catch (error: unknown) {
      checks.push({
        name: 'ffprobe',
        status: 'fail',
        message: 'FFprobe is not available',
        details: error instanceof Error ? error.message : String(error),
      })
    }

    checks.push({
      name: 'openai',
      status: buildDiagnosticStatus(true, Boolean(config.OPENAI_API_KEY)),
      message: config.OPENAI_API_KEY
        ? 'OPENAI_API_KEY is configured'
        : 'OPENAI_API_KEY is not configured',
    })

    checks.push({
      name: 'exa',
      status: buildDiagnosticStatus(false, Boolean(config.EXA_API_KEY)),
      message: config.EXA_API_KEY
        ? 'EXA_API_KEY is configured'
        : 'EXA_API_KEY is not configured (optional)',
    })

    try {
      const gitResult = spawnCommand('git', ['--version'], { timeout: 10_000 })
      const passed = gitResult.status === 0 && typeof gitResult.stdout === 'string' && gitResult.stdout.length > 0
      checks.push({
        name: 'git',
        status: buildDiagnosticStatus(false, passed),
        message: passed
          ? `Git ${parseVersionFromOutput(gitResult.stdout)} detected`
          : 'Git is not available (optional for git-push stage)',
      })
    } catch (error: unknown) {
      checks.push({
        name: 'git',
        status: 'warn',
        message: 'Git is not available (optional for git-push stage)',
        details: error instanceof Error ? error.message : String(error),
      })
    }

    const watchFolder = config.WATCH_FOLDER || join(process.cwd(), 'watch')
    checks.push({
      name: 'watch-folder',
      status: buildDiagnosticStatus(false, fileExistsSync(watchFolder)),
      message: fileExistsSync(watchFolder)
        ? `Watch folder exists at ${watchFolder}`
        : `Watch folder is missing at ${watchFolder}`,
    })

    const providerName = normalizeProviderName(config.LLM_PROVIDER)
    checks.push({
      name: 'llm-provider',
      status: buildDiagnosticStatus(true, isKnownProvider(providerName)),
      message: isKnownProvider(providerName)
        ? `LLM provider is ${providerName}`
        : `Unknown LLM provider: ${providerName}`,
    })

    if (isKnownProvider(providerName)) {
      const providerCheckPassed = providerName === 'copilot'
        || (providerName === 'openai' && Boolean(config.OPENAI_API_KEY))
        || (providerName === 'claude' && Boolean(config.ANTHROPIC_API_KEY))

      checks.push({
        name: 'llm-provider-credentials',
        status: buildDiagnosticStatus(true, providerCheckPassed),
        message: providerName === 'copilot'
          ? 'Copilot provider uses GitHub authentication'
          : providerName === 'openai'
            ? (config.OPENAI_API_KEY ? 'OpenAI provider credentials are configured' : 'OpenAI provider requires OPENAI_API_KEY')
            : (config.ANTHROPIC_API_KEY ? 'Claude provider credentials are configured' : 'Claude provider requires ANTHROPIC_API_KEY'),
      })

      checks.push({
        name: 'llm-model',
        status: 'pass',
        message: config.LLM_MODEL
          ? `Model override is ${config.LLM_MODEL}`
          : `Using default model ${providerDefaults[providerName]}`,
      })
    }

    if (!config.LATE_API_KEY) {
      checks.push({
        name: 'late-api',
        status: 'warn',
        message: 'LATE_API_KEY is not configured (optional)',
      })
    } else {
      try {
        const client = createLateApiClient(config.LATE_API_KEY)
        const connection = await client.validateConnection()
        if (!connection.valid) {
          checks.push({
            name: 'late-api',
            status: 'warn',
            message: `Late API connection failed${connection.error ? `: ${connection.error}` : ''}`,
          })
        } else {
          const accounts = await client.listAccounts()
          checks.push({
            name: 'late-api',
            status: 'pass',
            message: `Late API connected${connection.profileName ? ` to ${connection.profileName}` : ''}`,
            details: accounts.length > 0
              ? `Connected accounts: ${accounts.map((account) => account.platform).join(', ')}`
              : 'No social accounts connected',
          })
        }
      } catch (error: unknown) {
        checks.push({
          name: 'late-api',
          status: 'warn',
          message: 'Late API could not be reached',
          details: error instanceof Error ? error.message : String(error),
        })
      }
    }

    try {
      const schedule = await loadScheduleConfig()
      checks.push({
        name: 'schedule-config',
        status: 'pass',
        message: `Schedule config loaded with ${Object.keys(schedule.platforms).length} platform(s)`,
      })
    } catch (error: unknown) {
      checks.push({
        name: 'schedule-config',
        status: 'warn',
        message: 'Schedule config could not be loaded',
        details: error instanceof Error ? error.message : String(error),
      })
    }

    return {
      checks,
      allPassed: checks.every((check) => check.status !== 'fail'),
    }
  }

  return {
    async processVideo(videoPath: string, options?: ProcessOptions) {
      const cliOverrides = mapProcessOptionsToCliOverrides(options)
      const ideaIds = options?.ideas?.map((ideaId) => String(ideaId))
      const ideas = ideaIds && ideaIds.length > 0
        ? await getIdeasByIds(ideaIds)
        : undefined

      return await withTemporaryCliOverrides(cliOverrides, async () => {
        const result = await processVideoSafe(videoPath, ideas)
        if (!result) {
          throw new Error(`VidPipe pipeline failed for "${videoPath}" with an uncaught error`)
        }
        return result
      })
    },

    async ideate(options?: IdeateOptions) {
      return await generateIdeas({
        seedTopics: options?.topics,
        count: options?.count,
        brandPath: options?.brandPath,
      })
    },

    ideas: {
      async list(filters) {
        return await listIdeas(filters)
      },
      async get(issueNumber) {
        return await getIdea(issueNumber)
      },
      async create(input) {
        return await createIdea(input)
      },
      async update(issueNumber, updates) {
        return await updateIdea(issueNumber, updates)
      },
    },

    schedule: {
      async findNextSlot(platform, clipType, options?: SlotOptions) {
        return await findNextSlot(platform, clipType, {
          ideaIds: options?.ideaIds?.map((ideaId) => String(ideaId)),
          publishBy: options?.publishBy,
        })
      },
      async getCalendar(startDate?: Date, endDate?: Date) {
        return await getScheduleCalendar(startDate, endDate)
      },
      async realign(options?: RealignOptions) {
        const plan = await buildRealignPlan({ platform: options?.platform })
        if (options?.dryRun) {
          return {
            moved: plan.posts.length + plan.toCancel.length,
            skipped: plan.skipped,
          }
        }

        const result = await executeRealignPlan(plan)
        return {
          moved: result.updated + result.cancelled,
          skipped: plan.skipped + result.failed,
        }
      },
      async loadConfig() {
        return await loadScheduleConfig()
      },
    },

    video: {
      async extractClip(videoPath, start, end, output) {
        return await extractClip(videoPath, start, end, output)
      },
      async burnCaptions(videoPath, captionsFile, output) {
        return await burnCaptions(videoPath, captionsFile, output)
      },
      async detectSilence(videoPath, options) {
        const regions = await detectSilence(
          videoPath,
          options?.minDuration,
          options?.threshold,
        )
        return regions.map((region) => ({ start: region.start, end: region.end }))
      },
      async generateVariants(videoPath, platforms, outputDir) {
        const variants = await generatePlatformVariants(
          videoPath,
          outputDir,
          getVariantSlug(videoPath),
          mapVariantPlatforms(platforms),
        )
        return variants.map((v) => ({ platform: v.platform as unknown as Platform, path: v.path }))
      },
      async captureFrame(videoPath, timestamp, output) {
        return await captureFrame(videoPath, timestamp, output)
      },
    },

    social: {
      async generatePosts(context, platforms) {
        return await buildSocialPosts(context, platforms)
      },
    },

    async doctor() {
      return await doctor()
    },

    config: {
      get(key: string) {
        return getResolvedConfigValue(key)
      },
      getAll() {
        return getConfig()
      },
      getGlobal() {
        return loadGlobalConfig()
      },
      set(key: string, value: string | boolean) {
        const target = resolveConfigTarget(key)
        if (target) {
          const normalizedValue = String(value)
          setGlobalConfigValue(target.section, target.key, normalizedValue)
          applyPersistedConfigToRuntime(target, normalizedValue, currentCliOptions)
          refreshConfig()
          return
        }

        if (applyRuntimeOnlyOverride(key, value, currentCliOptions)) {
          refreshConfig()
          return
        }

        throw new Error(`Unknown config key: ${key}`)
      },
      async save() {
        saveGlobalConfig(loadGlobalConfig())
        refreshConfig()
      },
      path() {
        return getConfigPath()
      },
    },
  }
}

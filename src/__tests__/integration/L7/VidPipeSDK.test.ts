import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Platform } from '../../../L0-pure/types/index.js'
import type { CreateIdeaInput, Idea } from '../../../L0-pure/types/index.js'
import { createVidPipe } from '../../../L7-app/sdk/VidPipeSDK.js'

const {
  mockInitConfig,
  mockGetConfig,
  mockGetConfigDir,
  mockGetConfigPath,
  mockLoadGlobalConfig,
  mockSaveGlobalConfig,
  mockGetGlobalConfigValue,
  mockSetGlobalConfigValue,
  mockResetGlobalConfig,
  mockMaskSecret,
  mockListIdeas,
  mockGetIdea,
  mockCreateIdea,
  mockUpdateIdea,
  mockGetIdeasByIds,
  mockFindNextSlot,
  mockGetScheduleCalendar,
  mockLoadScheduleConfig,
  mockBuildRealignPlan,
  mockExecuteRealignPlan,
  mockExtractClip,
  mockBurnCaptions,
  mockDetectSilence,
  mockCaptureFrame,
  mockGeneratePlatformVariants,
  mockGetFFmpegPath,
  mockGetFFprobePath,
} = vi.hoisted(() => ({
  mockInitConfig: vi.fn(),
  mockGetConfig: vi.fn(),
  mockGetConfigDir: vi.fn(),
  mockGetConfigPath: vi.fn(),
  mockLoadGlobalConfig: vi.fn(),
  mockSaveGlobalConfig: vi.fn(),
  mockGetGlobalConfigValue: vi.fn(),
  mockSetGlobalConfigValue: vi.fn(),
  mockResetGlobalConfig: vi.fn(),
  mockMaskSecret: vi.fn(),
  mockListIdeas: vi.fn(),
  mockGetIdea: vi.fn(),
  mockCreateIdea: vi.fn(),
  mockUpdateIdea: vi.fn(),
  mockGetIdeasByIds: vi.fn(),
  mockFindNextSlot: vi.fn(),
  mockGetScheduleCalendar: vi.fn(),
  mockLoadScheduleConfig: vi.fn(),
  mockBuildRealignPlan: vi.fn(),
  mockExecuteRealignPlan: vi.fn(),
  mockExtractClip: vi.fn(),
  mockBurnCaptions: vi.fn(),
  mockDetectSilence: vi.fn(),
  mockCaptureFrame: vi.fn(),
  mockGeneratePlatformVariants: vi.fn(),
  mockGetFFmpegPath: vi.fn(),
  mockGetFFprobePath: vi.fn(),
}))

vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: mockGetConfig,
}))

vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  getConfigDir: mockGetConfigDir,
  getConfigPath: mockGetConfigPath,
  loadGlobalConfig: mockLoadGlobalConfig,
  saveGlobalConfig: mockSaveGlobalConfig,
  getGlobalConfigValue: mockGetGlobalConfigValue,
  setGlobalConfigValue: mockSetGlobalConfigValue,
  resetGlobalConfig: mockResetGlobalConfig,
  maskSecret: mockMaskSecret,
}))

vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  listIdeas: mockListIdeas,
  getIdea: mockGetIdea,
  createIdea: mockCreateIdea,
  updateIdea: mockUpdateIdea,
}))

vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: mockGetIdeasByIds,
}))

vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: mockFindNextSlot,
  getScheduleCalendar: mockGetScheduleCalendar,
}))

vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: mockLoadScheduleConfig,
}))

vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: mockBuildRealignPlan,
  executeRealignPlan: mockExecuteRealignPlan,
}))

vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  extractClip: mockExtractClip,
  burnCaptions: mockBurnCaptions,
  detectSilence: mockDetectSilence,
  captureFrame: mockCaptureFrame,
  generatePlatformVariants: mockGeneratePlatformVariants,
}))

vi.mock('../../../L3-services/diagnostics/diagnostics.js', () => ({
  getFFmpegPath: mockGetFFmpegPath,
  getFFprobePath: mockGetFFprobePath,
}))

const baseEnvironment = {
  OPENAI_API_KEY: 'sk-test',
  WATCH_FOLDER: 'C:\\watch',
  REPO_ROOT: 'C:\\Repos\\htekdev\\video-auto-note-taker.expose-as-sdk',
  FFMPEG_PATH: 'ffmpeg',
  FFPROBE_PATH: 'ffprobe',
  EXA_API_KEY: 'exa-test',
  EXA_MCP_URL: 'http://exa.local',
  YOUTUBE_API_KEY: 'youtube-test',
  PERPLEXITY_API_KEY: 'perplexity-test',
  LLM_PROVIDER: 'copilot',
  LLM_MODEL: 'Claude Opus 4.6',
  ANTHROPIC_API_KEY: 'anthropic-test',
  OUTPUT_DIR: 'C:\\output',
  BRAND_PATH: 'C:\\brand.json',
  VERBOSE: false,
  SKIP_SILENCE_REMOVAL: false,
  SKIP_SHORTS: false,
  SKIP_MEDIUM_CLIPS: false,
  SKIP_SOCIAL: false,
  SKIP_CAPTIONS: false,
  SKIP_VISUAL_ENHANCEMENT: false,
  LATE_API_KEY: 'late-test',
  LATE_PROFILE_ID: 'profile-1',
  SKIP_SOCIAL_PUBLISH: false,
  GEMINI_API_KEY: 'gemini-test',
  GEMINI_MODEL: 'gemini-2.5-flash',
  IDEAS_REPO: 'owner/repo',
  GITHUB_TOKEN: 'github-test',
  MODEL_OVERRIDES: {},
}

const baseGlobalConfig = {
  credentials: {
    openaiApiKey: 'sk-test',
  },
  defaults: {
    outputDir: 'C:\\output',
  },
}

const envSnapshot = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_PROVIDER: process.env.LLM_PROVIDER,
  REPO_ROOT: process.env.REPO_ROOT,
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) {
      delete process.env[key]
      continue
    }

    process.env[key] = value
  }
}

function createIdeaInput(): CreateIdeaInput {
  return {
    topic: 'Ship the SDK',
    hook: 'Use one entry point for the whole pipeline.',
    audience: 'Developers',
    keyTakeaway: 'Delegate through the SDK facade.',
    talkingPoints: ['Factory', 'Delegation'],
    platforms: [Platform.YouTube],
    tags: ['sdk', 'testing'],
    publishBy: '2026-02-15',
  }
}

function createIdea(issueNumber = 42): Idea {
  return {
    issueNumber,
    issueUrl: `https://github.com/owner/repo/issues/${issueNumber}`,
    repoFullName: 'owner/repo',
    id: `idea-${issueNumber}`,
    topic: 'Ship the SDK',
    hook: 'Use one entry point for the whole pipeline.',
    audience: 'Developers',
    keyTakeaway: 'Delegate through the SDK facade.',
    talkingPoints: ['Factory', 'Delegation'],
    platforms: [Platform.YouTube],
    status: 'draft',
    tags: ['sdk', 'testing'],
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    publishBy: '2026-02-15',
  }
}

describe('VidPipeSDK', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockInitConfig.mockImplementation(() => ({ ...baseEnvironment }))
    mockGetConfig.mockReturnValue({ ...baseEnvironment })
    mockGetConfigDir.mockReturnValue('C:\\Users\\test\\AppData\\Roaming\\vidpipe')
    mockGetConfigPath.mockReturnValue('C:\\Users\\test\\AppData\\Roaming\\vidpipe\\config.json')
    mockLoadGlobalConfig.mockReturnValue({
      credentials: { ...baseGlobalConfig.credentials },
      defaults: { ...baseGlobalConfig.defaults },
    })
    mockSaveGlobalConfig.mockReturnValue(undefined)
    mockGetGlobalConfigValue.mockReturnValue(undefined)
    mockSetGlobalConfigValue.mockReturnValue(undefined)
    mockResetGlobalConfig.mockReturnValue(undefined)
    mockMaskSecret.mockImplementation((value: string) => `masked:${value}`)

    mockListIdeas.mockResolvedValue([])
    mockGetIdea.mockResolvedValue(null)
    mockCreateIdea.mockResolvedValue(createIdea())
    mockUpdateIdea.mockResolvedValue(createIdea())
    mockGetIdeasByIds.mockResolvedValue([])

    mockFindNextSlot.mockResolvedValue('2026-02-20T15:00:00.000Z')
    mockGetScheduleCalendar.mockResolvedValue([])
    mockLoadScheduleConfig.mockResolvedValue({ platforms: {} })
    mockBuildRealignPlan.mockResolvedValue({ posts: [], toCancel: [], skipped: 0 })
    mockExecuteRealignPlan.mockResolvedValue({ updated: 0, cancelled: 0, failed: 0 })

    mockExtractClip.mockResolvedValue('C:\\output\\clip.mp4')
    mockBurnCaptions.mockResolvedValue('C:\\output\\captioned.mp4')
    mockDetectSilence.mockResolvedValue([])
    mockCaptureFrame.mockResolvedValue('C:\\output\\frame.png')
    mockGeneratePlatformVariants.mockResolvedValue([])

    mockGetFFmpegPath.mockReturnValue('ffmpeg')
    mockGetFFprobePath.mockReturnValue('ffprobe')

    restoreEnv()
  })

  afterEach(() => {
    restoreEnv()
  })

  it('creates an SDK instance with no args', () => {
    const sdk = createVidPipe()

    expect(sdk).toBeDefined()
    expect(typeof sdk.processVideo).toBe('function')
    expect(typeof sdk.ideate).toBe('function')
    expect(typeof sdk.config.path).toBe('function')
    expect(typeof sdk.config.getGlobal).toBe('function')
    expect(mockInitConfig).toHaveBeenCalledOnce()
  })

  it('creates an SDK instance with partial config', () => {
    const sdk = createVidPipe({
      openaiApiKey: 'sk-partial',
      outputDir: 'C:\\custom-output',
      watchFolder: 'C:\\watch-custom',
      llmProvider: 'claude',
      llmModel: 'claude-opus-4.6',
      anthropicApiKey: 'anthropic-partial',
      geminiApiKey: 'gemini-partial',
      geminiModel: 'gemini-2.5-pro',
      repoRoot: 'C:\\Repos\\custom',
      verbose: true,
    })

    expect(sdk).toBeDefined()
    expect(mockInitConfig).toHaveBeenCalledWith(expect.objectContaining({
      openaiKey: 'sk-partial',
      outputDir: 'C:\\custom-output',
      watchDir: 'C:\\watch-custom',
      llmProvider: 'claude',
      llmModel: 'claude-opus-4.6',
      anthropicKey: 'anthropic-partial',
      geminiKey: 'gemini-partial',
      geminiModel: 'gemini-2.5-pro',
      repoRoot: 'C:\\Repos\\custom',
      verbose: true,
    }))
  })

  it('delegates ideas.list to listIdeas', async () => {
    const sdk = createVidPipe()
    const ideas = [createIdea(1)]
    mockListIdeas.mockResolvedValue(ideas)

    const result = await sdk.ideas.list({ status: 'draft', platform: Platform.YouTube })

    expect(result).toBe(ideas)
    expect(mockListIdeas).toHaveBeenCalledWith({ status: 'draft', platform: Platform.YouTube })
  })

  it('delegates ideas.get to getIdea', async () => {
    const sdk = createVidPipe()
    const idea = createIdea(9)
    mockGetIdea.mockResolvedValue(idea)

    const result = await sdk.ideas.get(9)

    expect(result).toBe(idea)
    expect(mockGetIdea).toHaveBeenCalledWith(9)
  })

  it('delegates ideas.create to createIdea', async () => {
    const sdk = createVidPipe()
    const input = createIdeaInput()
    const idea = createIdea(15)
    mockCreateIdea.mockResolvedValue(idea)

    const result = await sdk.ideas.create(input)

    expect(result).toBe(idea)
    expect(mockCreateIdea).toHaveBeenCalledWith(input)
  })

  it('delegates schedule.findNextSlot and stringifies numeric idea ids', async () => {
    const sdk = createVidPipe()

    const result = await sdk.schedule.findNextSlot('youtube', 'short', {
      ideaIds: [101, 202],
      publishBy: '2026-03-01',
    })

    expect(result).toBe('2026-02-20T15:00:00.000Z')
    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', 'short', {
      ideaIds: ['101', '202'],
      publishBy: '2026-03-01',
    })
  })

  it('delegates schedule.loadConfig to loadScheduleConfig', async () => {
    const sdk = createVidPipe()
    const scheduleConfig = { platforms: { youtube: { short: [] } } }
    mockLoadScheduleConfig.mockResolvedValue(scheduleConfig)

    const result = await sdk.schedule.loadConfig()

    expect(result).toBe(scheduleConfig)
    expect(mockLoadScheduleConfig).toHaveBeenCalledOnce()
  })

  it('delegates video.extractClip to extractClip', async () => {
    const sdk = createVidPipe()

    const result = await sdk.video.extractClip(
      'C:\\videos\\recording.mp4',
      5,
      25,
      'C:\\output\\clip.mp4',
    )

    expect(result).toBe('C:\\output\\clip.mp4')
    expect(mockExtractClip).toHaveBeenCalledWith(
      'C:\\videos\\recording.mp4',
      5,
      25,
      'C:\\output\\clip.mp4',
    )
  })

  it('reads config.get from the resolved environment config', () => {
    const sdk = createVidPipe()
    mockGetConfig.mockReturnValue({
      ...baseEnvironment,
      OUTPUT_DIR: 'C:\\resolved-output',
    })

    const result = sdk.config.get('OUTPUT_DIR')

    expect(result).toBe('C:\\resolved-output')
    expect(mockGetGlobalConfigValue).not.toHaveBeenCalled()
    expect(mockLoadGlobalConfig).not.toHaveBeenCalled()
  })

  it('reads mapped config.get keys from the resolved runtime config', () => {
    const sdk = createVidPipe()
    mockGetConfig.mockReturnValue({
      ...baseEnvironment,
      OUTPUT_DIR: 'C:\\resolved-output',
    })
    mockLoadGlobalConfig.mockReturnValue({
      credentials: { ...baseGlobalConfig.credentials },
      defaults: { ...baseGlobalConfig.defaults, outputDir: 'C:\\global-output' },
    })

    const result = sdk.config.get('output-dir')

    expect(result).toBe('C:\\resolved-output')
    expect(mockLoadGlobalConfig).not.toHaveBeenCalled()
    expect(mockGetGlobalConfigValue).not.toHaveBeenCalled()
  })

  it('returns resolved config from config.getAll', () => {
    const sdk = createVidPipe()
    const resolvedConfig = {
      ...baseEnvironment,
      OUTPUT_DIR: 'C:\\resolved-output',
    }
    mockGetConfig.mockReturnValue(resolvedConfig)

    const result = sdk.config.getAll()

    expect(result).toBe(resolvedConfig)
    expect(mockLoadGlobalConfig).not.toHaveBeenCalled()
  })

  it('returns raw global file values from config.getGlobal', () => {
    const sdk = createVidPipe()
    const globalConfig = {
      credentials: { openaiApiKey: 'sk-global' },
      defaults: { outputDir: 'C:\\global-output' },
    }
    mockLoadGlobalConfig.mockReturnValue(globalConfig)

    const result = sdk.config.getGlobal()

    expect(result).toBe(globalConfig)
    expect(mockLoadGlobalConfig).toHaveBeenCalledOnce()
  })

  it('returns config.path from getConfigPath', () => {
    const sdk = createVidPipe()

    const result = sdk.config.path()

    expect(result).toBe('C:\\Users\\test\\AppData\\Roaming\\vidpipe\\config.json')
    expect(mockGetConfigPath).toHaveBeenCalledOnce()
  })

  it('delegates config.set and save to global config helpers', async () => {
    const sdk = createVidPipe()
    const globalConfig = {
      credentials: { openaiApiKey: 'sk-test' },
      defaults: { outputDir: 'C:\\saved-output' },
    }
    mockLoadGlobalConfig.mockReturnValue(globalConfig)

    sdk.config.set('output-dir', 'C:\\updated-output')
    await sdk.config.save()

    expect(mockSetGlobalConfigValue).toHaveBeenCalledWith('defaults', 'outputDir', 'C:\\updated-output')
    expect(mockSaveGlobalConfig).toHaveBeenCalledWith(globalConfig)
    expect(mockInitConfig).toHaveBeenCalledTimes(3)
  })

  it('returns config.path and config.getGlobal from global config helpers', () => {
    const sdk = createVidPipe()
    const globalConfig = {
      credentials: { openaiApiKey: 'sk-listed' },
      defaults: { outputDir: 'C:\\listed-output' },
    }
    mockLoadGlobalConfig.mockReturnValue(globalConfig)

    expect(sdk.config.path()).toBe('C:\\Users\\test\\AppData\\Roaming\\vidpipe\\config.json')
    expect(sdk.config.getGlobal()).toBe(globalConfig)
    expect(mockGetConfigPath).toHaveBeenCalledOnce()
    expect(mockLoadGlobalConfig).toHaveBeenCalledOnce()
  })

  it('supports shorthand and dot-notation config keys', () => {
    const sdk = createVidPipe()

    sdk.config.set('output-dir', 'C:\\normalized-output')
    sdk.config.set('defaults.watchFolder', 'C:\\watch-next')

    expect(mockSetGlobalConfigValue).toHaveBeenNthCalledWith(1, 'defaults', 'outputDir', 'C:\\normalized-output')
    expect(mockSetGlobalConfigValue).toHaveBeenNthCalledWith(2, 'defaults', 'watchFolder', 'C:\\watch-next')
    expect(mockInitConfig).toHaveBeenCalledTimes(3)
  })

  it('applies runtime-only config overrides without persisting them', () => {
    const sdk = createVidPipe()

    sdk.config.set('VERBOSE', true)
    sdk.config.set('REPO_ROOT', 'C:\\Repos\\runtime')

    expect(mockSetGlobalConfigValue).not.toHaveBeenCalled()
    // initConfig called once for createVidPipe + once per config.set = 3 total
    expect(mockInitConfig).toHaveBeenCalledTimes(3)
    // The last initConfig call should include the runtime overrides
    const lastCallArgs = mockInitConfig.mock.calls[2][0]
    expect(lastCallArgs.repoRoot).toBe('C:\\Repos\\runtime')
  })

  it('throws for unknown config keys', () => {
    const sdk = createVidPipe()

    expect(() => sdk.config.set('unknown-key', 'value')).toThrow('Unknown config key: unknown-key')
    expect(mockSetGlobalConfigValue).not.toHaveBeenCalled()
  })

  it('delegates ideas.update to updateIdea', async () => {
    const sdk = createVidPipe()
    const idea = createIdea(15)
    mockUpdateIdea.mockResolvedValue(idea)

    const result = await sdk.ideas.update(15, { keyTakeaway: 'Updated takeaway' })

    expect(result).toBe(idea)
    expect(mockUpdateIdea).toHaveBeenCalledWith(15, {
      keyTakeaway: 'Updated takeaway',
    })
  })

  it('passes undefined options through schedule.findNextSlot', async () => {
    const sdk = createVidPipe()

    const result = await sdk.schedule.findNextSlot('youtube')

    expect(result).toBe('2026-02-20T15:00:00.000Z')
    expect(mockFindNextSlot).toHaveBeenCalledWith('youtube', undefined, {
      ideaIds: undefined,
      publishBy: undefined,
    })
  })

  it('delegates schedule calendar and realign helpers', async () => {
    const sdk = createVidPipe()
    const calendar = [{ id: 'calendar-entry' }]
    const plan = { posts: [{ id: 'post-1' }], toCancel: [{ id: 'post-2' }], skipped: 3 }
    const execution = { updated: 2, cancelled: 1, failed: 4 }
    const startDate = new Date('2026-02-20T00:00:00.000Z')
    const endDate = new Date('2026-02-27T00:00:00.000Z')
    mockGetScheduleCalendar.mockResolvedValue(calendar)
    mockBuildRealignPlan.mockResolvedValue(plan)
    mockExecuteRealignPlan.mockResolvedValue(execution)

    expect(await sdk.schedule.getCalendar(startDate, endDate)).toBe(calendar)
    expect(await sdk.schedule.realign({ platform: 'youtube', dryRun: true })).toStrictEqual({
      moved: 2,
      skipped: 3,
    })
    expect(await sdk.schedule.realign({ platform: 'youtube' })).toStrictEqual({
      moved: 3,
      skipped: 7,
    })
    expect(mockGetScheduleCalendar).toHaveBeenCalledWith(startDate, endDate)
    expect(mockBuildRealignPlan).toHaveBeenNthCalledWith(1, { platform: 'youtube' })
    expect(mockBuildRealignPlan).toHaveBeenNthCalledWith(2, { platform: 'youtube' })
    expect(mockExecuteRealignPlan).toHaveBeenCalledWith(plan)
  })

  it('maps schedule-config shorthand to defaults.scheduleConfig', () => {
    const sdk = createVidPipe()

    sdk.config.set('schedule-config', 'C:\\shared\\schedule.json')

    expect(mockSetGlobalConfigValue).toHaveBeenCalledWith('defaults', 'scheduleConfig', 'C:\\shared\\schedule.json')
  })

  it('delegates remaining video helpers', async () => {
    const sdk = createVidPipe()
    const silenceRegions = [{ start: 1, end: 2 }]
    const variants = [{ platform: 'youtube', path: 'C:\\output\\variant.mp4' }]
    mockDetectSilence.mockResolvedValue(silenceRegions)
    mockGeneratePlatformVariants.mockResolvedValue(variants)

    expect(await sdk.video.burnCaptions('C:\\videos\\recording.mp4', 'C:\\captions\\track.ass', 'C:\\output\\captioned.mp4')).toBe('C:\\output\\captioned.mp4')
    expect(await sdk.video.detectSilence('C:\\videos\\recording.mp4', { threshold: '-25dB', minDuration: 1.5 })).toStrictEqual(silenceRegions)
    expect(await sdk.video.captureFrame('C:\\videos\\recording.mp4', 12, 'C:\\output\\frame.png')).toBe('C:\\output\\frame.png')
    expect(await sdk.video.generateVariants('C:\\videos\\recording.mp4', [Platform.YouTube], 'C:\\output')).toStrictEqual(variants)

    expect(mockBurnCaptions).toHaveBeenCalledWith('C:\\videos\\recording.mp4', 'C:\\captions\\track.ass', 'C:\\output\\captioned.mp4')
    expect(mockDetectSilence).toHaveBeenCalledWith('C:\\videos\\recording.mp4', 1.5, '-25dB')
    expect(mockCaptureFrame).toHaveBeenCalledWith('C:\\videos\\recording.mp4', 12, 'C:\\output\\frame.png')
    expect(mockGeneratePlatformVariants).toHaveBeenCalledWith('C:\\videos\\recording.mp4', 'C:\\output', 'recording', ['youtube'])
  })

  it('sdk exposes generateAgenda method', () => {
    const sdk = createVidPipe()
    expect(typeof sdk.generateAgenda).toBe('function')
  })
})

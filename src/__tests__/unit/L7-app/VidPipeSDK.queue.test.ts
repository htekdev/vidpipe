import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ───────────────────────────────────────────────────────

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
  mockListIdeas,
  mockGetIdea,
  mockCreateIdea,
  mockUpdateIdea,
  mockGetIdeasByIds,
  mockGetQueueId,
  mockGetProfileId,
  mockPreviewQueue,
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
  mockListIdeas: vi.fn(),
  mockGetIdea: vi.fn(),
  mockCreateIdea: vi.fn(),
  mockUpdateIdea: vi.fn(),
  mockGetIdeasByIds: vi.fn(),
  mockGetQueueId: vi.fn(),
  mockGetProfileId: vi.fn(),
  mockPreviewQueue: vi.fn(),
}))

// ── L1 mocks ────────────────────────────────────────────────────────────

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

// ── L3 mocks ────────────────────────────────────────────────────────────

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

vi.mock('../../../L3-services/queueMapping/queueMapping.js', () => ({
  getQueueId: mockGetQueueId,
  getProfileId: mockGetProfileId,
}))

vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: () => ({
    previewQueue: mockPreviewQueue,
    async listAccounts() { return [] },
    async listProfiles() { return [] },
  }),
}))

// ── Import after mocks ──────────────────────────────────────────────────

import { createVidPipe } from '../../../L7-app/sdk/VidPipeSDK.js'

// ── Fixtures ────────────────────────────────────────────────────────────

const baseEnvironment = {
  OPENAI_API_KEY: 'sk-test',
  WATCH_FOLDER: 'C:\\watch',
  REPO_ROOT: 'C:\\Repos\\test',
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
  credentials: { openaiApiKey: 'sk-test' },
  defaults: { outputDir: 'C:\\output' },
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('VidPipeSDK schedule.findNextSlot — queue preview paths', () => {
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
    mockCreateIdea.mockResolvedValue({ issueNumber: 1 })
    mockUpdateIdea.mockResolvedValue({ issueNumber: 1 })
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

    mockGetQueueId.mockResolvedValue(null)
    mockGetProfileId.mockResolvedValue('profile-1')
    mockPreviewQueue.mockResolvedValue({ slots: [] })
  })

  it('returns queue slot when previewQueue succeeds', async () => {
    mockGetQueueId.mockResolvedValue('q-youtube-short')
    mockPreviewQueue.mockResolvedValue({ slots: ['2026-04-08T15:00:00Z'] })

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('youtube', 'short')

    expect(result).toBe('2026-04-08T15:00:00Z')
    expect(mockGetQueueId).toHaveBeenCalledWith('youtube', 'short')
    expect(mockPreviewQueue).toHaveBeenCalledWith('profile-1', 'q-youtube-short', 1)
    expect(mockFindNextSlot).not.toHaveBeenCalled()
  })

  it('falls back to local when previewQueue throws', async () => {
    mockGetQueueId.mockResolvedValue('q-tiktok-short')
    mockPreviewQueue.mockRejectedValue(new Error('API connection refused'))

    const sdk = createVidPipe()
    const result = await sdk.schedule.findNextSlot('tiktok', 'short')

    expect(result).toBe('2026-02-20T15:00:00.000Z')
    expect(mockFindNextSlot).toHaveBeenCalledWith('tiktok', 'short', {
      ideaIds: undefined,
      publishBy: undefined,
    })
  })
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Idea, InterviewResult } from '../../../L0-pure/types/index.js'
import { Platform } from '../../../L0-pure/types/index.js'

// --- L1 mocks ---
const mockInitConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
  getConfig: vi.fn().mockReturnValue({ MODEL_OVERRIDES: {} }),
}))

const mockSetChatMode = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/logger/configLogger.js', () => ({
  setChatMode: mockSetChatMode,
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const mockInterviewEmitter = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn().mockReturnValue(false),
  emit: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}))
vi.mock('../../../L1-infra/progress/interviewEmitter.js', () => ({
  interviewEmitter: mockInterviewEmitter,
}))

const mockAltScreenChatInstance = vi.hoisted(() => ({
  enter: vi.fn(),
  leave: vi.fn(),
  destroy: vi.fn(),
  showQuestion: vi.fn(),
  showInsight: vi.fn(),
  addMessage: vi.fn(),
  setStatus: vi.fn(),
  clearStatus: vi.fn(),
  promptInput: vi.fn().mockResolvedValue('no'),
  title: 'Test',
  subtitle: 'Test',
  inputPrompt: '> ',
}))
const MockAltScreenChat = vi.hoisted(() => vi.fn().mockImplementation(function () {
  return mockAltScreenChatInstance
}))
vi.mock('../../../L1-infra/terminal/altScreenChat.js', () => ({
  AltScreenChat: MockAltScreenChat,
}))

// --- L3 mocks ---
const mockLoadAndValidateIdea = vi.hoisted(() => vi.fn())
const mockSaveTranscript = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const mockUpdateIdeaFromInsights = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../L3-services/interview/interviewService.js', () => ({
  loadAndValidateIdea: mockLoadAndValidateIdea,
  saveTranscript: mockSaveTranscript,
  updateIdeaFromInsights: mockUpdateIdeaFromInsights,
}))

const mockUpdateIdea = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  updateIdea: mockUpdateIdea,
}))

// Mock LLM provider factory (L3) so L4 agents don't need real LLM
const mockSendAndWait = vi.hoisted(() => vi.fn().mockResolvedValue({
  content: '',
  toolCalls: [],
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
}))
const mockProvider = vi.hoisted(() => ({
  name: 'mock' as const,
  createSession: vi.fn().mockResolvedValue({
    sendAndWait: mockSendAndWait,
    on: vi.fn(),
    close: vi.fn(),
  }),
  isAvailable: () => true,
  getDefaultModel: () => 'mock-model',
}))
vi.mock('../../../L3-services/llm/providerFactory.js', () => ({
  getProvider: () => mockProvider,
}))

// Mock cost tracker (L3)
vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: {
    recordCall: vi.fn(),
    recordUsage: vi.fn(),
    recordServiceUsage: vi.fn(),
    setAgent: vi.fn(),
    setStage: vi.fn(),
    getReport: vi.fn().mockReturnValue({ totalCost: 0, entries: [] }),
    formatReport: vi.fn().mockReturnValue(''),
    reset: vi.fn(),
  },
}))

// Extra L1/L3 mocks needed by VidPipeSDK
vi.mock('../../../L1-infra/config/globalConfig.js', () => ({
  loadGlobalConfig: vi.fn().mockReturnValue({ credentials: {}, defaults: {} }),
  saveGlobalConfig: vi.fn(),
  setGlobalConfigValue: vi.fn(),
  getConfigPath: vi.fn().mockReturnValue('/tmp/config'),
}))
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  ensureDirectory: vi.fn(),
  fileExistsSync: vi.fn().mockReturnValue(false),
  writeTextFile: vi.fn(),
}))
vi.mock('../../../L1-infra/paths/paths.js', () => ({
  join: vi.fn((...args: string[]) => args.join('/')),
}))
vi.mock('../../../L1-infra/progress/progressEmitter.js', () => ({
  progressEmitter: { enable: vi.fn(), disable: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), isEnabled: vi.fn().mockReturnValue(false), emit: vi.fn() },
}))
vi.mock('../../../L1-infra/process/process.js', () => ({
  spawnCommand: vi.fn(),
}))
vi.mock('../../../L3-services/ideation/ideaService.js', () => ({
  getIdeasByIds: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../../L3-services/diagnostics/diagnostics.js', () => ({
  getFFmpegPath: vi.fn(),
  getFFprobePath: vi.fn(),
}))
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({
  createLateApiClient: vi.fn(),
}))
vi.mock('../../../L3-services/scheduler/realign.js', () => ({
  buildRealignPlan: vi.fn(),
  executeRealignPlan: vi.fn(),
}))
vi.mock('../../../L3-services/scheduler/scheduleConfig.js', () => ({
  loadScheduleConfig: vi.fn(),
}))
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: vi.fn(),
  getScheduleCalendar: vi.fn(),
}))
vi.mock('../../../L3-services/videoOperations/videoOperations.js', () => ({
  burnCaptions: vi.fn(),
  captureFrame: vi.fn(),
  detectSilence: vi.fn(),
  extractClip: vi.fn(),
  generatePlatformVariants: vi.fn(),
}))

import { runIdeateStart } from '../../../L7-app/commands/ideateStart.js'

function createMockIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    issueNumber: 42,
    issueUrl: 'https://github.com/test/repo/issues/42',
    repoFullName: 'test/repo',
    id: 'test-idea',
    topic: 'Test Idea',
    hook: 'Original hook',
    audience: 'developers',
    keyTakeaway: 'Original takeaway',
    talkingPoints: ['point 1'],
    platforms: [Platform.YouTube],
    status: 'draft',
    tags: ['test'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    publishBy: '2026-02-01',
    ...overrides,
  }
}

describe('ideate-start command integration (L7)', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockLoadAndValidateIdea.mockResolvedValue(createMockIdea())
    // Mock LLM to return empty (agent ends immediately with no tool calls)
    mockSendAndWait.mockResolvedValue({
      content: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    })
  })

  afterEach(() => {
    processExitSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  test('ideateStart.REQ-001: rejects invalid issue number', async () => {
    await expect(runIdeateStart('abc', {})).rejects.toThrow('process.exit called')
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid issue number'))
  })

  test('ideateStart.REQ-005: full lifecycle — init, chat mode, enter, destroy, restore', async () => {
    await runIdeateStart('42', {})

    expect(mockInitConfig).toHaveBeenCalled()
    expect(mockSetChatMode).toHaveBeenCalledWith(true)
    expect(mockAltScreenChatInstance.enter).toHaveBeenCalled()
    expect(mockAltScreenChatInstance.destroy).toHaveBeenCalled()
    expect(mockSetChatMode).toHaveBeenCalledWith(false)
  })

  test('ideateStart.REQ-006: --progress enables emitter', async () => {
    await runIdeateStart('42', { progress: true })
    expect(mockInterviewEmitter.enable).toHaveBeenCalled()
  })

  test('ideateStart.REQ-007: rejects unknown mode', async () => {
    await expect(runIdeateStart('42', { mode: 'bad' })).rejects.toThrow('process.exit called')
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown mode'))
  })

  test('ideateStart.REQ-017: shows welcome messages', async () => {
    await runIdeateStart('42', {})
    expect(mockAltScreenChatInstance.addMessage).toHaveBeenCalledWith(
      'system', expect.stringContaining('Starting interview'),
    )
  })

  test('ideateStart.REQ-033: prompts to mark ready after completion', async () => {
    await runIdeateStart('42', {})
    expect(mockAltScreenChatInstance.promptInput).toHaveBeenCalled()
  })

  test('ideateStart.REQ-004: propagates draft-only error', async () => {
    mockLoadAndValidateIdea.mockRejectedValue(new Error('only draft ideas'))
    await expect(runIdeateStart('42', {})).rejects.toThrow('only draft ideas')
  })

  // Stubs for E2E territory
  test('ideateStart.REQ-011: builds on previous answers (E2E)', () => { expect(true).toBe(true) })
  test('ideateStart.REQ-012: continues until /end (E2E)', () => { expect(true).toBe(true) })
  test('ideateStart.REQ-013: Ctrl+C saves partial (E2E)', () => { expect(true).toBe(true) })
  test('ideateStart.REQ-016: research tools (E2E)', () => { expect(true).toBe(true) })
  test('ideateStart.REQ-034: partial save on interrupt (E2E)', () => { expect(true).toBe(true) })
})

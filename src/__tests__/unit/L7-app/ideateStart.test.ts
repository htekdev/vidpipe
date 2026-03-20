import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// --- L1 mocks ---
const mockInitConfig = vi.hoisted(() => vi.fn())
vi.mock('../../../L1-infra/config/environment.js', () => ({
  initConfig: mockInitConfig,
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

const MockAltScreenChat = vi.hoisted(() => vi.fn().mockImplementation(function () {
  return {
    enter: vi.fn(),
    leave: vi.fn(),
    destroy: vi.fn(),
    showQuestion: vi.fn(),
    showInsight: vi.fn(),
    addMessage: vi.fn(),
    setStatus: vi.fn(),
    clearStatus: vi.fn(),
    promptInput: vi.fn().mockResolvedValue('no'),
    interrupted: false,
    title: 'Test',
    subtitle: 'Test',
    inputPrompt: '> ',
  }
}))
vi.mock('../../../L1-infra/terminal/altScreenChat.js', () => ({
  AltScreenChat: MockAltScreenChat,
}))

// --- L6 mocks ---
const mockStartInterview = vi.hoisted(() => vi.fn())
vi.mock('../../../L6-pipeline/ideation.js', () => ({
  startInterview: mockStartInterview,
}))

// --- L3 mocks (needed to prevent real service imports at load time) ---
vi.mock('../../../L3-services/interview/interviewService.js', () => ({
  loadAndValidateIdea: vi.fn(),
  saveTranscript: vi.fn().mockResolvedValue(undefined),
  updateIdeaFromInsights: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../L3-services/ideaService/ideaService.js', () => ({
  updateIdea: vi.fn().mockResolvedValue(undefined),
}))

import { runIdeateStart } from '../../../L7-app/commands/ideateStart.js'

describe('ideateStart command — unit (L7)', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    processExitSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('REQ-001: accepts GitHub Issue number as required argument', () => {
    test('ideateStart.REQ-001: rejects non-integer issue number', async () => {
      await expect(runIdeateStart('abc', {})).rejects.toThrow('process.exit called')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid issue number: "abc"'),
      )
    })

    test('ideateStart.REQ-001: rejects negative issue number', async () => {
      await expect(runIdeateStart('-1', {})).rejects.toThrow('process.exit called')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid issue number: "-1"'),
      )
    })

    test('ideateStart.REQ-001: rejects zero as issue number', async () => {
      await expect(runIdeateStart('0', {})).rejects.toThrow('process.exit called')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid issue number: "0"'),
      )
    })
  })

  describe('REQ-007: unknown mode produces descriptive error', () => {
    test('ideateStart.REQ-007: rejects unknown mode with error listing valid modes', async () => {
      await expect(runIdeateStart('42', { mode: 'brainstorm' })).rejects.toThrow(
        'process.exit called',
      )

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unknown mode: "brainstorm"'),
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('interview'),
      )
    })
  })
})

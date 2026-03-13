/**
 * L5 Unit Test — pipelineServices wrappers
 *
 * Mocks: L4 agents/bridges only
 * Tests that L5 wrapper functions delegate to L4 bridge modules.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PipelineStage } from '../../../L0-pure/types/index.js'

const mockReset = vi.hoisted(() => vi.fn())
const mockSetRunId = vi.hoisted(() => vi.fn())
const mockSetStage = vi.hoisted(() => vi.fn())
const mockGetReport = vi.hoisted(() => vi.fn())
const mockFormatReport = vi.hoisted(() => vi.fn())
const mockRecordServiceUsage = vi.hoisted(() => vi.fn())
const mockStartRun = vi.hoisted(() => vi.fn())
const mockCompleteRun = vi.hoisted(() => vi.fn())
const mockFailRun = vi.hoisted(() => vi.fn())
const mockMarkPending = vi.hoisted(() => vi.fn())
const mockMarkProcessing = vi.hoisted(() => vi.fn())
const mockMarkCompleted = vi.hoisted(() => vi.fn())
const mockMarkFailed = vi.hoisted(() => vi.fn())
const mockBuildPublishQueue = vi.hoisted(() => vi.fn())
const mockCommitAndPush = vi.hoisted(() => vi.fn())
const mockScheduleAgent = vi.hoisted(() => vi.fn().mockImplementation(function(this: Record<string, unknown>) {
  this.run = vi.fn()
}))

vi.mock('../../../L4-agents/pipelineServiceBridge.js', () => ({
  costTracker: {
    reset: mockReset,
    setRunId: mockSetRunId,
    setStage: mockSetStage,
    getReport: mockGetReport,
    formatReport: mockFormatReport,
    recordServiceUsage: mockRecordServiceUsage,
  },
  startRun: mockStartRun,
  completeRun: mockCompleteRun,
  failRun: mockFailRun,
  markPending: mockMarkPending,
  markProcessing: mockMarkProcessing,
  markCompleted: mockMarkCompleted,
  markFailed: mockMarkFailed,
  buildPublishQueue: mockBuildPublishQueue,
  commitAndPush: mockCommitAndPush,
}))

vi.mock('../../../L4-agents/ScheduleAgent.js', () => ({
  ScheduleAgent: mockScheduleAgent,
}))

import {
  buildPublishQueue,
  commitAndPush,
  completeRun,
  costTracker,
  createScheduleAgent,
  failRun,
  markCompleted,
  markFailed,
  markPending,
  markProcessing,
  startRun,
} from '../../../L5-assets/pipelineServices.js'

function createStageResults() {
  return [
    {
      stage: PipelineStage.Ingestion,
      success: true,
      duration: 120,
    },
  ]
}

describe('L5 Unit: pipelineServices wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('exposes the pipeline run re-exports', () => {
    expect(typeof startRun).toBe('function')
    expect(typeof completeRun).toBe('function')
    expect(typeof failRun).toBe('function')
  })

  it('costTracker.reset delegates to L4', () => {
    costTracker.reset()
    expect(mockReset).toHaveBeenCalledOnce()
  })

  it('costTracker.setRunId delegates to L4', () => {
    costTracker.setRunId('run-123')
    expect(mockSetRunId).toHaveBeenCalledWith('run-123')
  })

  it('costTracker.setStage delegates to L4', () => {
    costTracker.setStage('ingestion' as never)
    expect(mockSetStage).toHaveBeenCalledWith('ingestion')
  })

  it('startRun delegates to L4', async () => {
    await startRun('run-123', 'video-slug')
    expect(mockStartRun).toHaveBeenCalledWith('run-123', 'video-slug')
  })

  it('completeRun delegates to L4', async () => {
    const stageResults = createStageResults()
    await completeRun('run-123', stageResults, 480)
    expect(mockCompleteRun).toHaveBeenCalledWith('run-123', stageResults, 480)
  })

  it('failRun delegates to L4', async () => {
    const stageResults = createStageResults()
    await failRun('run-123', 'boom', stageResults)
    expect(mockFailRun).toHaveBeenCalledWith('run-123', 'boom', stageResults)
  })

  it('markPending delegates to L4', async () => {
    mockMarkPending.mockResolvedValue(undefined)
    await markPending('test-slug', '/source/path.mp4')
    expect(mockMarkPending).toHaveBeenCalledWith('test-slug', '/source/path.mp4')
  })

  it('markProcessing delegates to L4', async () => {
    mockMarkProcessing.mockResolvedValue(undefined)
    await markProcessing('/dir')
    expect(mockMarkProcessing).toHaveBeenCalledWith('/dir')
  })

  it('markCompleted delegates to L4', async () => {
    mockMarkCompleted.mockResolvedValue(undefined)
    await markCompleted('/dir')
    expect(mockMarkCompleted).toHaveBeenCalledWith('/dir')
  })

  it('markFailed delegates to L4', async () => {
    mockMarkFailed.mockResolvedValue(undefined)
    await markFailed('/dir', 'err')
    expect(mockMarkFailed).toHaveBeenCalledWith('/dir', 'err')
  })

  it('buildPublishQueue delegates to L4', async () => {
    mockBuildPublishQueue.mockResolvedValue({ items: [] })
    const mockVideo = { slug: 'test' } as never
    const result = await buildPublishQueue(mockVideo, [], [], [], undefined)
    expect(result).toEqual({ items: [] })
    expect(mockBuildPublishQueue).toHaveBeenCalledWith(mockVideo, [], [], [], undefined)
  })

  it('commitAndPush delegates to L4', async () => {
    mockCommitAndPush.mockResolvedValue(undefined)
    await commitAndPush('/dir', 'msg')
    expect(mockCommitAndPush).toHaveBeenCalledWith('/dir', 'msg')
  })

  it('createScheduleAgent delegates to L4 ScheduleAgent constructor', () => {
    const agent = createScheduleAgent()
    expect(mockScheduleAgent).toHaveBeenCalledOnce()
    expect(agent).toBeDefined()
  })
})

/**
 * L4 Unit Test — pipelineServiceBridge wrappers
 *
 * Mocks: L3 services only (costTracking, pipelineRuns, processingState, gitOperations, queueBuilder)
 * Tests that the bridge module wraps L3 functions and delegates calls.
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
const mockCommitAndPush = vi.hoisted(() => vi.fn())
const mockBuildPublishQueue = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: {
    reset: mockReset,
    setRunId: mockSetRunId,
    setStage: mockSetStage,
    getReport: mockGetReport,
    formatReport: mockFormatReport,
    recordServiceUsage: mockRecordServiceUsage,
  },
}))

vi.mock('../../../L3-services/pipelineRuns/pipelineRuns.js', () => ({
  startRun: mockStartRun,
  completeRun: mockCompleteRun,
  failRun: mockFailRun,
}))

vi.mock('../../../L3-services/processingState/processingState.js', () => ({
  markPending: mockMarkPending,
  markProcessing: mockMarkProcessing,
  markCompleted: mockMarkCompleted,
  markFailed: mockMarkFailed,
}))

vi.mock('../../../L3-services/gitOperations/gitOperations.js', () => ({
  commitAndPush: mockCommitAndPush,
}))

vi.mock('../../../L3-services/queueBuilder/queueBuilder.js', () => ({
  buildPublishQueue: mockBuildPublishQueue,
}))

import {
  buildPublishQueue,
  commitAndPush,
  completeRun,
  costTracker,
  failRun,
  markCompleted,
  markFailed,
  markPending,
  markProcessing,
  startRun,
} from '../../../L4-agents/pipelineServiceBridge.js'

function createStageResults() {
  return [
    {
      stage: PipelineStage.Ingestion,
      success: true,
      duration: 120,
    },
  ]
}

describe('L4 Unit: pipelineServiceBridge wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('exposes the pipeline run re-exports', () => {
    expect(typeof startRun).toBe('function')
    expect(typeof completeRun).toBe('function')
    expect(typeof failRun).toBe('function')
  })

  it('costTracker.reset delegates to L3', () => {
    costTracker.reset()
    expect(mockReset).toHaveBeenCalledOnce()
  })

  it('costTracker.setRunId delegates to L3', () => {
    costTracker.setRunId('run-123')
    expect(mockSetRunId).toHaveBeenCalledWith('run-123')
  })

  it('costTracker.setStage delegates to L3', () => {
    costTracker.setStage('ingestion' as never)
    expect(mockSetStage).toHaveBeenCalledWith('ingestion')
  })

  it('costTracker.getReport delegates to L3', () => {
    mockGetReport.mockReturnValue({ total: 0 })
    const result = costTracker.getReport()
    expect(result).toEqual({ total: 0 })
  })

  it('costTracker.formatReport delegates to L3', () => {
    mockFormatReport.mockReturnValue('report')
    expect(costTracker.formatReport()).toBe('report')
  })

  it('startRun delegates to L3', async () => {
    await startRun('run-123', 'video-slug')
    expect(mockStartRun).toHaveBeenCalledWith('run-123', 'video-slug')
  })

  it('completeRun delegates to L3', async () => {
    const stageResults = createStageResults()
    await completeRun('run-123', stageResults, 480)
    expect(mockCompleteRun).toHaveBeenCalledWith('run-123', stageResults, 480)
  })

  it('failRun delegates to L3', async () => {
    const stageResults = createStageResults()
    await failRun('run-123', 'boom', stageResults)
    expect(mockFailRun).toHaveBeenCalledWith('run-123', 'boom', stageResults)
  })

  it('markPending delegates to L3', async () => {
    mockMarkPending.mockResolvedValue(undefined)
    await markPending('test-slug', '/source/path.mp4')
    expect(mockMarkPending).toHaveBeenCalledWith('test-slug', '/source/path.mp4')
  })

  it('markProcessing delegates to L3', async () => {
    mockMarkProcessing.mockResolvedValue(undefined)
    await markProcessing('/dir')
    expect(mockMarkProcessing).toHaveBeenCalledWith('/dir')
  })

  it('markCompleted delegates to L3', async () => {
    mockMarkCompleted.mockResolvedValue(undefined)
    await markCompleted('/dir')
    expect(mockMarkCompleted).toHaveBeenCalledWith('/dir')
  })

  it('markFailed delegates to L3', async () => {
    mockMarkFailed.mockResolvedValue(undefined)
    await markFailed('/dir', 'err')
    expect(mockMarkFailed).toHaveBeenCalledWith('/dir', 'err')
  })

  it('commitAndPush delegates to L3', async () => {
    mockCommitAndPush.mockResolvedValue(undefined)
    await commitAndPush('/dir', 'msg')
    expect(mockCommitAndPush).toHaveBeenCalledWith('/dir', 'msg')
  })

  it('buildPublishQueue delegates to L3', async () => {
    mockBuildPublishQueue.mockResolvedValue({ items: [] })
    const mockVideo = { slug: 'test' } as never
    const result = await buildPublishQueue(mockVideo, [], [], [], undefined)
    expect(result).toEqual({ items: [] })
    expect(mockBuildPublishQueue).toHaveBeenCalledWith(mockVideo, [], [], [], undefined)
  })
})

/**
 * L4 Unit Test — pipelineServiceBridge wrappers
 *
 * Mocks: L3 services only (costTracking, processingState, gitOperations, queueBuilder)
 * Tests that the bridge module wraps L3 functions and delegates calls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const mockReset = vi.hoisted(() => vi.fn())
const mockSetStage = vi.hoisted(() => vi.fn())
const mockGetReport = vi.hoisted(() => vi.fn())
const mockFormatReport = vi.hoisted(() => vi.fn())
const mockRecordCall = vi.hoisted(() => vi.fn())
const mockRecordServiceUsage = vi.hoisted(() => vi.fn())
const mockMarkPending = vi.hoisted(() => vi.fn())
const mockMarkProcessing = vi.hoisted(() => vi.fn())
const mockMarkCompleted = vi.hoisted(() => vi.fn())
const mockMarkFailed = vi.hoisted(() => vi.fn())
const mockCommitAndPush = vi.hoisted(() => vi.fn())
const mockBuildPublishQueue = vi.hoisted(() => vi.fn())

vi.mock('../../../L3-services/costTracking/costTracker.js', () => ({
  costTracker: {
    reset: mockReset,
    setStage: mockSetStage,
    getReport: mockGetReport,
    formatReport: mockFormatReport,
    recordCall: mockRecordCall,
    recordServiceUsage: mockRecordServiceUsage,
  },
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
  costTracker,
  markPending, markProcessing, markCompleted, markFailed,
  commitAndPush, buildPublishQueue,
} from '../../../L4-agents/pipelineServiceBridge.js'

describe('L4 Unit: pipelineServiceBridge wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('costTracker.reset delegates to L3', () => {
    costTracker.reset()
    expect(mockReset).toHaveBeenCalledOnce()
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
  })
})

/**
 * L5 Unit Test — pipelineServices wrappers
 *
 * Mocks: L4 agents/bridges only
 * Tests that L5 wrapper functions delegate to L4 bridge modules.
 */
import { vi, describe, it, expect, afterEach } from 'vitest'

const mockReset = vi.hoisted(() => vi.fn())
const mockSetStage = vi.hoisted(() => vi.fn())
const mockGetReport = vi.hoisted(() => vi.fn())
const mockFormatReport = vi.hoisted(() => vi.fn())
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
    setStage: mockSetStage,
    getReport: mockGetReport,
    formatReport: mockFormatReport,
    recordCall: vi.fn(),
    recordServiceUsage: vi.fn(),
  },
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
  costTracker, markPending, markProcessing, markCompleted, markFailed,
  buildPublishQueue, commitAndPush, createScheduleAgent,
} from '../../../L5-assets/pipelineServices.js'

describe('L5 Unit: pipelineServices wrappers', () => {
  afterEach(() => vi.clearAllMocks())

  it('costTracker.reset delegates to L4', () => {
    costTracker.reset()
    expect(mockReset).toHaveBeenCalledOnce()
  })

  it('costTracker.setStage delegates to L4', () => {
    costTracker.setStage('ingestion' as never)
    expect(mockSetStage).toHaveBeenCalledWith('ingestion')
  })

  it('markPending delegates to L4', async () => {
    mockMarkPending.mockResolvedValue(undefined)
    await markPending('/dir')
    expect(mockMarkPending).toHaveBeenCalledWith('/dir')
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
    const result = await buildPublishQueue('/dir')
    expect(result).toEqual({ items: [] })
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

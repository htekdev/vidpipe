import { afterEach, describe, expect, it, vi } from 'vitest'

import { PipelineStage } from '../../../L0-pure/types/index.js'
import type { StageResult } from '../../../L0-pure/types/index.js'

const mockCreatePipelineRun = vi.hoisted(() => vi.fn())
const mockCompletePipelineRun = vi.hoisted(() => vi.fn())
const mockFailPipelineRun = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/pipelineRunStore.js', () => ({
  createPipelineRun: mockCreatePipelineRun,
  completePipelineRun: mockCompletePipelineRun,
  failPipelineRun: mockFailPipelineRun,
}))

import { completeRun, failRun, startRun } from '../../../L3-services/pipelineRuns/pipelineRuns.js'

function createStageResults(): StageResult[] {
  return [
    {
      stage: PipelineStage.Ingestion,
      success: true,
      duration: 125,
    },
  ]
}

describe('L3 Unit: pipelineRuns service', () => {
  afterEach(() => vi.clearAllMocks())

  it('startRun delegates to createPipelineRun', async () => {
    await startRun('run-123', 'video-slug')

    expect(mockCreatePipelineRun).toHaveBeenCalledOnce()
    expect(mockCreatePipelineRun).toHaveBeenCalledWith('run-123', 'video-slug')
  })

  it('completeRun delegates to completePipelineRun', async () => {
    const stageResults = createStageResults()

    await completeRun('run-456', stageResults, 980)

    expect(mockCompletePipelineRun).toHaveBeenCalledOnce()
    expect(mockCompletePipelineRun).toHaveBeenCalledWith('run-456', stageResults, 980)
  })

  it('failRun delegates to failPipelineRun with partial stage results', async () => {
    const stageResults = createStageResults()

    await failRun('run-789', 'pipeline exploded', stageResults)

    expect(mockFailPipelineRun).toHaveBeenCalledOnce()
    expect(mockFailPipelineRun).toHaveBeenCalledWith('run-789', 'pipeline exploded', stageResults)
  })

  it('failRun passes through an omitted stageResults argument', async () => {
    await failRun('run-999', 'fatal error')

    expect(mockFailPipelineRun).toHaveBeenCalledOnce()
    expect(mockFailPipelineRun).toHaveBeenCalledWith('run-999', 'fatal error', undefined)
  })
})

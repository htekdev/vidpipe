import type { StageResult } from '../../L0-pure/types/index.js'
import {
  createPipelineRun,
  completePipelineRun,
  failPipelineRun,
} from '../../L2-clients/dataStore/pipelineRunStore.js'

export async function startRun(runId: string, slug: string): Promise<void> {
  createPipelineRun(runId, slug)
}

export async function completeRun(
  runId: string,
  stageResults: StageResult[],
  totalDuration: number,
): Promise<void> {
  completePipelineRun(runId, stageResults, totalDuration)
}

export async function failRun(
  runId: string,
  error: string,
  stageResults?: StageResult[],
): Promise<void> {
  failPipelineRun(runId, error, stageResults)
}

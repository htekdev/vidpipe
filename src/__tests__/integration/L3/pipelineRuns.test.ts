import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { PipelineStage } from '../../../L0-pure/types/index.js'
import { closeDatabase, getDatabase, initializeDatabase, resetDatabaseSingleton } from '../../../L1-infra/database/index.js'
import { getPipelineRun } from '../../../L2-clients/dataStore/pipelineRunStore.js'
import { upsertVideo } from '../../../L2-clients/dataStore/videoStore.js'
import { completeRun, failRun, startRun } from '../../../L3-services/pipelineRuns/pipelineRuns.js'

function clearPipelineRunTables(): void {
  getDatabase().exec(`
    DELETE FROM pipeline_runs;
    DELETE FROM videos;
  `)
}

function createStageResults() {
  return [
    {
      stage: PipelineStage.Ingestion,
      success: true,
      duration: 120,
    },
    {
      stage: PipelineStage.Transcription,
      success: true,
      duration: 360,
    },
  ]
}

beforeAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
  initializeDatabase({ inMemory: true })
})

afterAll(() => {
  closeDatabase()
  resetDatabaseSingleton()
})

describe('L3 Integration: pipelineRuns service', () => {
  beforeEach(() => {
    clearPipelineRunTables()
  })

  afterEach(() => {
    clearPipelineRunTables()
  })

  test('startRun and completeRun persist a completed run through the real SQLite store', async () => {
    upsertVideo('pipeline-runs-video', 'C:\\videos\\pipeline-runs-video.mp4', 'processing')

    await startRun('service-run-1', 'pipeline-runs-video')

    expect(getPipelineRun('service-run-1')).toMatchObject({
      run_id: 'service-run-1',
      slug: 'pipeline-runs-video',
      status: 'running',
      stage_results: null,
      total_duration: null,
      error: null,
    })

    const stageResults = createStageResults()
    await completeRun('service-run-1', stageResults, 480)

    const completedRun = getPipelineRun('service-run-1')
    expect(completedRun).toMatchObject({
      run_id: 'service-run-1',
      slug: 'pipeline-runs-video',
      status: 'completed',
      total_duration: 480,
      error: null,
    })
    expect(completedRun?.completed_at).toBeTruthy()
    expect(JSON.parse(completedRun?.stage_results ?? '[]')).toEqual(stageResults)
  })

  test('startRun and failRun persist a failed run with partial stage results', async () => {
    upsertVideo('pipeline-runs-failure', 'C:\\videos\\pipeline-runs-failure.mp4', 'processing')

    await startRun('service-run-2', 'pipeline-runs-failure')

    const partialStageResults = [
      {
        stage: PipelineStage.Ingestion,
        success: true,
        duration: 95,
      },
      {
        stage: PipelineStage.Transcription,
        success: false,
        error: 'whisper timeout',
        duration: 410,
      },
    ]

    await failRun('service-run-2', 'whisper timeout', partialStageResults)

    const failedRun = getPipelineRun('service-run-2')
    expect(failedRun).toMatchObject({
      run_id: 'service-run-2',
      slug: 'pipeline-runs-failure',
      status: 'failed',
      error: 'whisper timeout',
    })
    expect(failedRun?.completed_at).toBeTruthy()
    expect(JSON.parse(failedRun?.stage_results ?? '[]')).toEqual(partialStageResults)
  })
})

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { PipelineStage } from '../../../L0-pure/types/index.js'

const mockCreatePipelineRun = vi.hoisted(() => vi.fn())
const mockCompletePipelineRun = vi.hoisted(() => vi.fn())
const mockFailPipelineRun = vi.hoisted(() => vi.fn())

vi.mock('../../../L2-clients/dataStore/pipelineRunStore.js', () => ({
  createPipelineRun: mockCreatePipelineRun,
  completePipelineRun: mockCompletePipelineRun,
  failPipelineRun: mockFailPipelineRun,
}))

import { initConfig } from '../../../L1-infra/config/environment.js'
import { processVideo } from '../../../L6-pipeline/pipeline.js'

let tempDir: string

beforeEach(async () => {
  vi.clearAllMocks()
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vidpipe-pipeline-runs-int-'))
  initConfig({
    outputDir: tempDir,
    openaiKey: 'test-openai-key',
    git: false,
    silenceRemoval: false,
    shorts: false,
    mediumClips: false,
    social: false,
    captions: false,
    visualEnhancement: false,
    socialPublish: false,
  })
})

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
})

describe('L4-L6 Integration: pipeline run tracking', () => {
  test('processVideo records run start and failure through real L4 and L5 bridges', async () => {
    const missingVideoPath = path.join(tempDir, 'missing-input.mp4')

    const result = await processVideo(missingVideoPath)

    expect(mockCreatePipelineRun).toHaveBeenCalledOnce()
    expect(mockCompletePipelineRun).not.toHaveBeenCalled()
    expect(mockFailPipelineRun).toHaveBeenCalledOnce()

    const [[startedRunId, startedSlug]] = mockCreatePipelineRun.mock.calls
    expect(startedRunId).toEqual(expect.any(String))
    expect(startedSlug).toBe('missing-input')

    expect(mockFailPipelineRun).toHaveBeenCalledWith(
      startedRunId,
      'Ingestion failed — cannot proceed without video metadata',
      expect.arrayContaining([
        expect.objectContaining({
          stage: PipelineStage.Ingestion,
          success: false,
          error: expect.any(String),
        }),
      ]),
    )

    expect(result.stageResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: PipelineStage.Ingestion,
          success: false,
        }),
      ]),
    )
    expect(result.totalDuration).toBeGreaterThanOrEqual(0)
  })
})

import { describe, test, expect } from 'vitest'
import {
  PIPELINE_STAGES,
  TOTAL_STAGES,
  getStageInfo,
  PipelineStage,
} from '../../../../src/L0-pure/types/index.js'
import type { StageInfo, ProgressEvent } from '../../../../src/L0-pure/types/index.js'

describe('PIPELINE_STAGES', () => {
  describe('progressEvents.REQ-013: one entry per PipelineStage enum value', () => {
    const allEnumValues = Object.values(PipelineStage)

    test('progressEvents.REQ-013 - has exactly one entry per PipelineStage enum value', () => {
      expect(PIPELINE_STAGES).toHaveLength(allEnumValues.length)
      const stageValues = PIPELINE_STAGES.map(s => s.stage)
      for (const enumVal of allEnumValues) {
        expect(stageValues).toContain(enumVal)
      }
    })

    test('progressEvents.REQ-013 - no duplicate stages', () => {
      const stageValues = PIPELINE_STAGES.map(s => s.stage)
      const unique = new Set(stageValues)
      expect(unique.size).toBe(stageValues.length)
    })
  })

  describe('progressEvents.REQ-012: totalStages derived from constant', () => {
    test('progressEvents.REQ-012 - TOTAL_STAGES equals PIPELINE_STAGES.length', () => {
      expect(TOTAL_STAGES).toBe(PIPELINE_STAGES.length)
    })

    test('progressEvents.REQ-012 - TOTAL_STAGES is 17', () => {
      expect(TOTAL_STAGES).toBe(17)
    })
  })

  describe('progressEvents.REQ-014: stage numbers match execution order', () => {
    test('progressEvents.REQ-014 - stageNumbers are sequential 1..N', () => {
      for (let i = 0; i < PIPELINE_STAGES.length; i++) {
        expect(PIPELINE_STAGES[i].stageNumber).toBe(i + 1)
      }
    })

    test('progressEvents.REQ-014 - first stage is Ingestion', () => {
      expect(PIPELINE_STAGES[0].stage).toBe(PipelineStage.Ingestion)
    })

    test('progressEvents.REQ-014 - last stage is Blog', () => {
      expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1].stage).toBe(PipelineStage.Blog)
    })
  })

  describe('progressEvents.REQ-011: every entry has name and stageNumber', () => {
    test('progressEvents.REQ-011 - all entries have non-empty name', () => {
      for (const entry of PIPELINE_STAGES) {
        expect(entry.name).toBeTruthy()
        expect(typeof entry.name).toBe('string')
        expect(entry.name.length).toBeGreaterThan(0)
      }
    })

    test('progressEvents.REQ-011 - all entries have positive stageNumber', () => {
      for (const entry of PIPELINE_STAGES) {
        expect(entry.stageNumber).toBeGreaterThan(0)
      }
    })
  })
})

describe('getStageInfo', () => {
  test('returns correct info for Ingestion', () => {
    const info = getStageInfo(PipelineStage.Ingestion)
    expect(info).toEqual<StageInfo>({
      stage: PipelineStage.Ingestion,
      name: 'Ingestion',
      stageNumber: 1,
    })
  })

  test('returns correct info for Blog', () => {
    const info = getStageInfo(PipelineStage.Blog)
    expect(info).toEqual<StageInfo>({
      stage: PipelineStage.Blog,
      name: 'Blog',
      stageNumber: 17,
    })
  })

  test('returns correct info for every stage', () => {
    for (const expected of PIPELINE_STAGES) {
      const info = getStageInfo(expected.stage)
      expect(info).toEqual(expected)
    }
  })

  test('throws for unknown stage', () => {
    expect(() => getStageInfo('nonexistent' as PipelineStage)).toThrow('Unknown pipeline stage')
  })
})

describe('ProgressEvent type discrimination', () => {
  test('pipeline:start event shape', () => {
    const event: ProgressEvent = {
      event: 'pipeline:start',
      videoPath: '/test/video.mp4',
      totalStages: 15,
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(event.event).toBe('pipeline:start')
  })

  test('stage:complete event shape', () => {
    const event: ProgressEvent = {
      event: 'stage:complete',
      stage: PipelineStage.Ingestion,
      stageNumber: 1,
      totalStages: 15,
      name: 'Ingestion',
      duration: 100,
      success: true,
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(event.event).toBe('stage:complete')
    expect(event.success).toBe(true)
  })

  test('stage:error event shape', () => {
    const event: ProgressEvent = {
      event: 'stage:error',
      stage: PipelineStage.Transcription,
      stageNumber: 2,
      totalStages: 15,
      name: 'Transcription',
      duration: 500,
      error: 'Whisper timeout',
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(event.event).toBe('stage:error')
    expect(event.error).toBe('Whisper timeout')
  })

  test('stage:skip event shape', () => {
    const event: ProgressEvent = {
      event: 'stage:skip',
      stage: PipelineStage.Shorts,
      stageNumber: 7,
      totalStages: 15,
      name: 'Shorts',
      reason: 'SKIP_SHORTS',
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(event.event).toBe('stage:skip')
    expect(event.reason).toBe('SKIP_SHORTS')
  })

  test('pipeline:complete event shape', () => {
    const event: ProgressEvent = {
      event: 'pipeline:complete',
      totalDuration: 45000,
      stagesCompleted: 14,
      stagesFailed: 1,
      stagesSkipped: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    expect(event.event).toBe('pipeline:complete')
    expect(event.stagesCompleted + event.stagesFailed + event.stagesSkipped).toBe(16)
  })
})

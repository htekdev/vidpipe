import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { PipelineStage, TOTAL_STAGES } from '../../../../src/L0-pure/types/index.js'
import type { ProgressEvent } from '../../../../src/L0-pure/types/index.js'

// Import the actual module (L1 tests mock Node.js builtins only)
import { progressEmitter } from '../../../../src/L1-infra/progress/progressEmitter.js'

describe('ProgressEmitter', () => {
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    progressEmitter.disable()
  })

  afterEach(() => {
    stderrWriteSpy.mockRestore()
    progressEmitter.disable()
  })

  describe('progressEvents.REQ-002: no output when disabled', () => {
    test('progressEvents.REQ-002 - emit is no-op when disabled', () => {
      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)
      expect(stderrWriteSpy).not.toHaveBeenCalled()
    })

    test('progressEvents.REQ-002 - isEnabled returns false by default', () => {
      expect(progressEmitter.isEnabled()).toBe(false)
    })
  })

  describe('progressEvents.REQ-001: structured output when enabled', () => {
    test('progressEvents.REQ-001 - emit writes to stderr when enabled', () => {
      progressEmitter.enable()
      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)
      expect(stderrWriteSpy).toHaveBeenCalledOnce()
    })

    test('progressEvents.REQ-001 - isEnabled returns true after enable()', () => {
      progressEmitter.enable()
      expect(progressEmitter.isEnabled()).toBe(true)
    })
  })

  describe('progressEvents.REQ-003: JSONL format', () => {
    test('progressEvents.REQ-003 - output is valid JSON followed by newline', () => {
      progressEmitter.enable()
      const event: ProgressEvent = {
        event: 'stage:start',
        stage: PipelineStage.Ingestion,
        stageNumber: 1,
        totalStages: TOTAL_STAGES,
        name: 'Ingestion',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      const written = stderrWriteSpy.mock.calls[0][0] as string
      expect(written).toMatch(/\n$/)

      const parsed = JSON.parse(written.trim())
      expect(parsed.event).toBe('stage:start')
      expect(parsed.stage).toBe('ingestion')
    })

    test('progressEvents.REQ-003 - multiple emits produce one JSON per line', () => {
      progressEmitter.enable()
      const event1: ProgressEvent = {
        event: 'stage:start',
        stage: PipelineStage.Ingestion,
        stageNumber: 1,
        totalStages: TOTAL_STAGES,
        name: 'Ingestion',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      const event2: ProgressEvent = {
        event: 'stage:complete',
        stage: PipelineStage.Ingestion,
        stageNumber: 1,
        totalStages: TOTAL_STAGES,
        name: 'Ingestion',
        duration: 100,
        success: true,
        timestamp: '2026-01-01T00:00:00.001Z',
      }
      progressEmitter.emit(event1)
      progressEmitter.emit(event2)

      expect(stderrWriteSpy).toHaveBeenCalledTimes(2)
      for (const call of stderrWriteSpy.mock.calls) {
        const line = call[0] as string
        expect(line).toMatch(/\n$/)
        expect(() => JSON.parse(line.trim())).not.toThrow()
      }
    })
  })

  describe('event serialization', () => {
    test('stage:error event includes error field', () => {
      progressEmitter.enable()
      const event: ProgressEvent = {
        event: 'stage:error',
        stage: PipelineStage.Transcription,
        stageNumber: 2,
        totalStages: TOTAL_STAGES,
        name: 'Transcription',
        duration: 1200,
        error: 'Whisper timeout',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      const parsed = JSON.parse((stderrWriteSpy.mock.calls[0][0] as string).trim())
      expect(parsed.error).toBe('Whisper timeout')
      expect(parsed.duration).toBe(1200)
    })

    test('stage:skip event includes reason field', () => {
      progressEmitter.enable()
      const event: ProgressEvent = {
        event: 'stage:skip',
        stage: PipelineStage.Shorts,
        stageNumber: 7,
        totalStages: TOTAL_STAGES,
        name: 'Shorts',
        reason: 'SKIP_SHORTS',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      const parsed = JSON.parse((stderrWriteSpy.mock.calls[0][0] as string).trim())
      expect(parsed.reason).toBe('SKIP_SHORTS')
    })

    test('pipeline:complete event includes summary counts', () => {
      progressEmitter.enable()
      const event: ProgressEvent = {
        event: 'pipeline:complete',
        totalDuration: 45000,
        stagesCompleted: 12,
        stagesFailed: 1,
        stagesSkipped: 3,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      const parsed = JSON.parse((stderrWriteSpy.mock.calls[0][0] as string).trim())
      expect(parsed.stagesCompleted).toBe(12)
      expect(parsed.stagesFailed).toBe(1)
      expect(parsed.stagesSkipped).toBe(3)
    })
  })

  describe('enable/disable lifecycle', () => {
    test('disable stops emission after being enabled', () => {
      progressEmitter.enable()
      progressEmitter.disable()

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)
      expect(stderrWriteSpy).not.toHaveBeenCalled()
    })

    test('re-enable after disable works', () => {
      progressEmitter.enable()
      progressEmitter.disable()
      progressEmitter.enable()

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)
      expect(stderrWriteSpy).toHaveBeenCalledOnce()
    })
  })
  describe('listener support', () => {
    afterEach(() => {
      // Remove any listeners added during tests (no removeAll, so we track manually)
    })

    test('addListener receives emitted events', () => {
      const received: ProgressEvent[] = []
      const listener = (event: ProgressEvent) => received.push(event)
      progressEmitter.addListener(listener)

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      expect(received).toHaveLength(1)
      expect(received[0].event).toBe('pipeline:start')

      progressEmitter.removeListener(listener)
    })

    test('isEnabled returns true when listeners are registered even without enable()', () => {
      const listener = () => {}
      progressEmitter.addListener(listener)

      expect(progressEmitter.isEnabled()).toBe(true)

      progressEmitter.removeListener(listener)
      expect(progressEmitter.isEnabled()).toBe(false)
    })

    test('removeListener stops delivery', () => {
      const received: ProgressEvent[] = []
      const listener = (event: ProgressEvent) => received.push(event)
      progressEmitter.addListener(listener)
      progressEmitter.removeListener(listener)

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      expect(received).toHaveLength(0)
    })

    test('listener receives events without stderr output when not enabled', () => {
      const received: ProgressEvent[] = []
      const listener = (event: ProgressEvent) => received.push(event)
      progressEmitter.addListener(listener)

      const event: ProgressEvent = {
        event: 'stage:start',
        stage: PipelineStage.Ingestion,
        stageNumber: 1,
        totalStages: TOTAL_STAGES,
        name: 'Ingestion',
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      expect(received).toHaveLength(1)
      expect(stderrWriteSpy).not.toHaveBeenCalled()

      progressEmitter.removeListener(listener)
    })

    test('both stderr and listener fire when enabled with listener', () => {
      progressEmitter.enable()
      const received: ProgressEvent[] = []
      const listener = (event: ProgressEvent) => received.push(event)
      progressEmitter.addListener(listener)

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      expect(received).toHaveLength(1)
      expect(stderrWriteSpy).toHaveBeenCalledOnce()

      progressEmitter.removeListener(listener)
    })

    test('multiple listeners all receive events', () => {
      const received1: ProgressEvent[] = []
      const received2: ProgressEvent[] = []
      const listener1 = (event: ProgressEvent) => received1.push(event)
      const listener2 = (event: ProgressEvent) => received2.push(event)
      progressEmitter.addListener(listener1)
      progressEmitter.addListener(listener2)

      const event: ProgressEvent = {
        event: 'pipeline:start',
        videoPath: '/test.mp4',
        totalStages: TOTAL_STAGES,
        timestamp: '2026-01-01T00:00:00.000Z',
      }
      progressEmitter.emit(event)

      expect(received1).toHaveLength(1)
      expect(received2).toHaveLength(1)

      progressEmitter.removeListener(listener1)
      progressEmitter.removeListener(listener2)
    })
  })
})

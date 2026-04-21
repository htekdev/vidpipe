import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { interviewEmitter } from '../../../L1-infra/progress/interviewEmitter.js'
import type { InterviewEvent } from '../../../L0-pure/types/index.js'

function makeEvent(overrides: Partial<InterviewEvent> = {}): InterviewEvent {
  return {
    event: 'interview:start',
    ideaNumber: 42,
    mode: 'interview',
    ideaTopic: 'Test Topic',
    timestamp: '2026-01-01T00:00:00Z',
    ...overrides,
  } as InterviewEvent
}

describe('InterviewEmitter', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    interviewEmitter.disable()
    // Remove any lingering listeners by creating a fresh spy
    stderrSpy.mockRestore()
  })

  describe('REQ-051: onEvent callback receives all InterviewEvent variants', () => {
    test('ideateStart.REQ-051: addListener registers a listener that receives emitted events', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }

      interviewEmitter.addListener(listener)
      const event = makeEvent()
      interviewEmitter.emit(event)

      expect(received).toHaveLength(1)
      expect(received[0]).toBe(event)

      interviewEmitter.removeListener(listener)
    })

    test('ideateStart.REQ-051: multiple listeners all receive the same event', () => {
      const receivedA: InterviewEvent[] = []
      const receivedB: InterviewEvent[] = []
      const listenerA = (e: InterviewEvent) => { receivedA.push(e) }
      const listenerB = (e: InterviewEvent) => { receivedB.push(e) }

      interviewEmitter.addListener(listenerA)
      interviewEmitter.addListener(listenerB)

      const event = makeEvent()
      interviewEmitter.emit(event)

      expect(receivedA).toHaveLength(1)
      expect(receivedA[0]).toBe(event)
      expect(receivedB).toHaveLength(1)
      expect(receivedB[0]).toBe(event)

      interviewEmitter.removeListener(listenerA)
      interviewEmitter.removeListener(listenerB)
    })

    test('ideateStart.REQ-051: dispatches to listeners even when stderr output is disabled', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }

      interviewEmitter.addListener(listener)
      interviewEmitter.emit(makeEvent())

      expect(received).toHaveLength(1)
      expect(stderrSpy).not.toHaveBeenCalled()

      interviewEmitter.removeListener(listener)
    })
  })

  describe('REQ-053: InterviewEvent includes all event types', () => {
    test('ideateStart.REQ-053: emits interview:start event with correct shape', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      const event = makeEvent({ event: 'interview:start' })
      interviewEmitter.emit(event)

      expect(received[0].event).toBe('interview:start')

      interviewEmitter.removeListener(listener)
    })

    test('ideateStart.REQ-053: emits thinking:start event', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({ event: 'thinking:start', timestamp: '2026-01-01T00:00:00Z' })

      expect(received[0].event).toBe('thinking:start')

      interviewEmitter.removeListener(listener)
    })

    test('ideateStart.REQ-053: emits tool:start event with toolName', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({ event: 'tool:start', toolName: 'web_search', timestamp: '2026-01-01T00:00:00Z' })

      expect(received[0].event).toBe('tool:start')

      interviewEmitter.removeListener(listener)
    })

    test('ideateStart.REQ-053: emits insight:discovered event with field and insight', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({
        event: 'insight:discovered',
        insight: 'Better hook found',
        field: 'hook',
        timestamp: '2026-01-01T00:00:00Z',
      })

      expect(received[0].event).toBe('insight:discovered')

      interviewEmitter.removeListener(listener)
    })
  })

  describe('REQ-055: Event listener cleaned up in finally block', () => {
    test('ideateStart.REQ-055: removeListener stops the listener from receiving events', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }

      interviewEmitter.addListener(listener)
      interviewEmitter.emit(makeEvent())
      expect(received).toHaveLength(1)

      interviewEmitter.removeListener(listener)
      interviewEmitter.emit(makeEvent())
      expect(received).toHaveLength(1)
    })

    test('ideateStart.REQ-055: disable() cleans up stderr output', () => {
      interviewEmitter.enable()
      interviewEmitter.emit(makeEvent())
      expect(stderrSpy).toHaveBeenCalledOnce()

      interviewEmitter.disable()
      interviewEmitter.emit(makeEvent())
      expect(stderrSpy).toHaveBeenCalledOnce()
    })
  })

  describe('emit', () => {
    test('is a no-op when disabled and no listeners registered', () => {
      interviewEmitter.disable()
      interviewEmitter.emit(makeEvent())

      expect(stderrSpy).not.toHaveBeenCalled()
    })
  })

  describe('enable / disable', () => {
    test('enable() causes events to be written to stderr as JSON', () => {
      interviewEmitter.enable()
      const event = makeEvent()
      interviewEmitter.emit(event)

      expect(stderrSpy).toHaveBeenCalledOnce()
      const written = stderrSpy.mock.calls[0][0] as string
      expect(written).toBe(JSON.stringify(event) + '\n')
    })

    test('enable() and listeners both produce output', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }

      interviewEmitter.enable()
      interviewEmitter.addListener(listener)

      interviewEmitter.emit(makeEvent())

      expect(stderrSpy).toHaveBeenCalledOnce()
      expect(received).toHaveLength(1)

      interviewEmitter.removeListener(listener)
    })
  })

  describe('isEnabled', () => {
    test('returns false when disabled and no listeners', () => {
      interviewEmitter.disable()
      expect(interviewEmitter.isEnabled()).toBe(false)
    })

    test('returns true when enabled', () => {
      interviewEmitter.enable()
      expect(interviewEmitter.isEnabled()).toBe(true)
    })

    test('returns true when listeners exist even if stderr is disabled', () => {
      const listener = () => {}
      interviewEmitter.addListener(listener)
      expect(interviewEmitter.isEnabled()).toBe(true)

      interviewEmitter.removeListener(listener)
      expect(interviewEmitter.isEnabled()).toBe(false)
    })

    test('returns true when both enabled and listeners exist', () => {
      const listener = () => {}
      interviewEmitter.enable()
      interviewEmitter.addListener(listener)
      expect(interviewEmitter.isEnabled()).toBe(true)

      interviewEmitter.removeListener(listener)
    })
  })

  describe('ideateStart UI events (REQ-040 through REQ-047)', () => {
    test.skip('ideateStart.REQ-040: AltScreenChat class is importable', () => {
      // Alt-screen mode verified via Ink render — integration test territory.
      // Dynamic import of altScreenChat triggers Ink's patch-console which
      // fails in test environments (console.Console is not a constructor).
    })

    test.skip('ideateStart.REQ-041: agent questions styled cyan — integration test territory', () => {
      // Ink component styling verified in integration/E2E tests
    })

    test.skip('ideateStart.REQ-042: user answers styled green — integration test territory', () => {
      // Ink component styling verified in integration/E2E tests
    })

    test('ideateStart.REQ-043: thinking state emits thinking:start event for status bar', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({ event: 'thinking:start', timestamp: '2026-01-01T00:00:00Z' })

      expect(received).toHaveLength(1)
      expect(received[0].event).toBe('thinking:start')

      interviewEmitter.removeListener(listener)
    })

    test('ideateStart.REQ-044: tool calls emit tool:start event with tool name for status bar', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({ event: 'tool:start', toolName: 'web_search', timestamp: '2026-01-01T00:00:00Z' })

      expect(received[0].event).toBe('tool:start')
      if (received[0].event === 'tool:start') {
        expect(received[0].toolName).toBe('web_search')
      }

      interviewEmitter.removeListener(listener)
    })

    test.skip('ideateStart.REQ-045: terminal resize redraws — integration test territory', () => {
      // Terminal resize handling is an Ink runtime behavior — E2E test
    })

    test.skip('ideateStart.REQ-046: non-TTY fallback — integration test territory', () => {
      // Non-TTY detection is a runtime check in AltScreenChat — E2E test
    })

    test('ideateStart.REQ-047: insight discoveries emit insight:discovered event', () => {
      const received: InterviewEvent[] = []
      const listener = (e: InterviewEvent) => { received.push(e) }
      interviewEmitter.addListener(listener)

      interviewEmitter.emit({
        event: 'insight:discovered',
        insight: 'Sharper hook found',
        field: 'hook',
        timestamp: '2026-01-01T00:00:00Z',
      })

      expect(received[0].event).toBe('insight:discovered')

      interviewEmitter.removeListener(listener)
    })
  })
})

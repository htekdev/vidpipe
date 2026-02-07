import { describe, it, expect } from 'vitest'
import { adjustTranscript } from '../pipeline.js'
import type { Transcript } from '../types/index.js'

function makeTranscript(overrides: Partial<Transcript> = {}): Transcript {
  return {
    text: 'hello world test',
    language: 'en',
    duration: 30,
    segments: [
      { id: 0, text: 'hello', start: 0, end: 5, words: [] },
      { id: 1, text: 'world', start: 10, end: 15, words: [] },
      { id: 2, text: 'test', start: 20, end: 25, words: [] },
    ],
    words: [
      { word: 'hello', start: 0, end: 2 },
      { word: 'world', start: 10, end: 12 },
      { word: 'test', start: 20, end: 22 },
    ],
    ...overrides,
  }
}

describe('adjustTranscript', () => {
  it('empty removals = no change', () => {
    const transcript = makeTranscript()
    const result = adjustTranscript(transcript, [])

    expect(result.duration).toBe(30)
    expect(result.segments).toHaveLength(3)
    expect(result.words).toHaveLength(3)
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[1].start).toBe(10)
    expect(result.segments[2].start).toBe(20)
  })

  it('correctly shifts word timestamps based on removal regions', () => {
    const transcript = makeTranscript()
    // Remove silence from 5-10 (5 seconds gap between seg 0 and seg 1)
    const result = adjustTranscript(transcript, [{ start: 5, end: 10 }])

    // Segments after removal should be shifted by 5s
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[0].end).toBe(5)
    // segment at 10-15 shifts to 5-10
    expect(result.segments[1].start).toBe(5)
    expect(result.segments[1].end).toBe(10)
    // segment at 20-25 shifts to 15-20
    expect(result.segments[2].start).toBe(15)
    expect(result.segments[2].end).toBe(20)

    // Words should also shift
    expect(result.words[1].start).toBe(5)
    expect(result.words[2].start).toBe(15)
  })

  it('multiple removals accumulate', () => {
    const transcript = makeTranscript()
    // Remove 5-10 (5s) and 15-20 (5s) — total 10s removed
    const result = adjustTranscript(transcript, [
      { start: 5, end: 10 },
      { start: 15, end: 20 },
    ])

    // seg 0 (0-5) → no shift
    expect(result.segments[0].start).toBe(0)
    expect(result.segments[0].end).toBe(5)
    // seg 1 (10-15) → shifted by first removal (5s) → 5-10
    expect(result.segments[1].start).toBe(5)
    expect(result.segments[1].end).toBe(10)
    // seg 2 (20-25) → shifted by both removals (10s) → 10-15
    expect(result.segments[2].start).toBe(10)
    expect(result.segments[2].end).toBe(15)

    // Duration 30 → shifted by 10s total removed
    expect(result.duration).toBe(20)
  })

  it('filters out segments entirely within a removal region', () => {
    const transcript = makeTranscript()
    // Remove 10-15 — this encompasses segment 1 entirely
    const result = adjustTranscript(transcript, [{ start: 10, end: 15 }])

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0].text).toBe('hello')
    expect(result.segments[1].text).toBe('test')
  })

  it('filters out words entirely within a removal region', () => {
    const transcript = makeTranscript()
    // Remove 10-15 — encompasses word "world" (10-12)
    const result = adjustTranscript(transcript, [{ start: 10, end: 15 }])

    expect(result.words).toHaveLength(2)
    expect(result.words[0].word).toBe('hello')
    expect(result.words[1].word).toBe('test')
  })
})

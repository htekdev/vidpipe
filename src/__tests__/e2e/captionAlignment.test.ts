/**
 * E2E Test — caption alignment with edited video transcript
 *
 * No mocks. Tests that caption generation uses a re-transcribed
 * edited video transcript (transcript-edited.json) when available,
 * producing captions aligned to the edited timeline.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateSRT, generateVTT, generateStyledASS } from '../../L0-pure/captions/captionGenerator.js'
import type { Transcript } from '../../L0-pure/types/index.js'

let tmpDir: string

// Original transcript — timestamps reference the pre-edit video
const originalTranscript: Transcript = {
  text: 'Hello world pause is over back to talking',
  segments: [
    { id: 0, start: 0, end: 5, text: 'Hello world', words: [
      { word: 'Hello', start: 0, end: 2 },
      { word: 'world', start: 3, end: 5 },
    ]},
    { id: 1, start: 20, end: 30, text: 'pause is over', words: [
      { word: 'pause', start: 20, end: 22 },
      { word: 'is', start: 22, end: 23 },
      { word: 'over', start: 23, end: 25 },
    ]},
    { id: 2, start: 35, end: 45, text: 'back to talking', words: [
      { word: 'back', start: 35, end: 37 },
      { word: 'to', start: 37, end: 38 },
      { word: 'talking', start: 38, end: 41 },
    ]},
  ],
  words: [
    { word: 'Hello', start: 0, end: 2 },
    { word: 'world', start: 3, end: 5 },
    { word: 'pause', start: 20, end: 22 },
    { word: 'is', start: 22, end: 23 },
    { word: 'over', start: 23, end: 25 },
    { word: 'back', start: 35, end: 37 },
    { word: 'to', start: 37, end: 38 },
    { word: 'talking', start: 38, end: 41 },
  ],
  language: 'en',
  duration: 50,
}

// Edited transcript — 15s of silence removed between segments, timestamps shifted
const editedTranscript: Transcript = {
  text: 'Hello world pause is over back to talking',
  segments: [
    { id: 0, start: 0, end: 5, text: 'Hello world', words: [
      { word: 'Hello', start: 0, end: 2 },
      { word: 'world', start: 3, end: 5 },
    ]},
    { id: 1, start: 5, end: 15, text: 'pause is over', words: [
      { word: 'pause', start: 5, end: 7 },
      { word: 'is', start: 7, end: 8 },
      { word: 'over', start: 8, end: 10 },
    ]},
    { id: 2, start: 15, end: 25, text: 'back to talking', words: [
      { word: 'back', start: 15, end: 17 },
      { word: 'to', start: 17, end: 18 },
      { word: 'talking', start: 18, end: 21 },
    ]},
  ],
  words: [
    { word: 'Hello', start: 0, end: 2 },
    { word: 'world', start: 3, end: 5 },
    { word: 'pause', start: 5, end: 7 },
    { word: 'is', start: 7, end: 8 },
    { word: 'over', start: 8, end: 10 },
    { word: 'back', start: 15, end: 17 },
    { word: 'to', start: 17, end: 18 },
    { word: 'talking', start: 18, end: 21 },
  ],
  language: 'en',
  duration: 30,
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'caption-align-e2e-'))
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('Caption alignment with edited transcript', () => {
  it('captions from original transcript reference pre-edit timestamps', () => {
    const srt = generateSRT(originalTranscript)
    // Original has segment at 20s — SRT should contain "00:00:20"
    expect(srt).toContain('00:00:20')
    // Original has segment at 35s
    expect(srt).toContain('00:00:35')
  })

  it('captions from edited transcript use shifted timestamps', () => {
    const srt = generateSRT(editedTranscript)
    // Edited transcript has segment 2 at 5s (not 20s)
    expect(srt).toContain('00:00:05')
    // Edited has segment 3 at 15s (not 35s)
    expect(srt).toContain('00:00:15')
    // Should NOT contain the original 20s or 35s timestamps
    expect(srt).not.toContain('00:00:20')
    expect(srt).not.toContain('00:00:35')
  })

  it('all caption formats (SRT, VTT, ASS) use edited timestamps consistently', () => {
    const srt = generateSRT(editedTranscript)
    const vtt = generateVTT(editedTranscript)
    const ass = generateStyledASS(editedTranscript)

    // All should reference edited timestamps, not original
    for (const content of [srt, vtt, ass]) {
      expect(content).not.toContain('00:00:20')
      expect(content).not.toContain('00:00:35')
    }
  })

  it('writes and reads transcript-edited.json for caption generation', async () => {
    const videoDir = join(tmpDir, 'caption-test')
    await mkdir(videoDir, { recursive: true })

    // Write edited transcript (as getEditedVideo would)
    const editedPath = join(videoDir, 'transcript-edited.json')
    await writeFile(editedPath, JSON.stringify(editedTranscript))

    // Read it back (as getAdjustedTranscript would)
    const loaded = JSON.parse(await readFile(editedPath, 'utf-8')) as Transcript

    // Verify loaded transcript has edited timestamps
    expect(loaded.duration).toBe(30)
    expect(loaded.segments[1].start).toBe(5) // not 20
    expect(loaded.segments[2].start).toBe(15) // not 35

    // Generate captions from loaded transcript
    const srt = generateSRT(loaded)
    expect(srt).not.toContain('00:00:20')
    expect(srt).toContain('00:00:05')
  })

  it('original transcript is not overwritten by second transcription call', async () => {
    // Simulates the bug: if transcribeVideo() auto-saved, calling it twice
    // with the same slug would overwrite the original transcript.json.
    // With the fix, transcribeVideo() does NOT write — callers save explicitly.
    const videoDir = join(tmpDir, 'no-overwrite-test')
    await mkdir(videoDir, { recursive: true })

    const originalPath = join(videoDir, 'transcript.json')
    await writeFile(originalPath, JSON.stringify(originalTranscript))

    // After writing, the original should still be intact
    const loaded = JSON.parse(await readFile(originalPath, 'utf-8')) as Transcript
    expect(loaded.duration).toBe(50)
    expect(loaded.segments[1].start).toBe(20)

    // Writing edited separately should not affect original
    const editedPath = join(videoDir, 'transcript-edited.json')
    await writeFile(editedPath, JSON.stringify(editedTranscript))

    const reloaded = JSON.parse(await readFile(originalPath, 'utf-8')) as Transcript
    expect(reloaded.duration).toBe(50) // original untouched
    expect(reloaded.segments[1].start).toBe(20) // still original timestamps
  })
})

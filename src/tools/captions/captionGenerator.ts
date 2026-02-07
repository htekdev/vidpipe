import { Transcript, Segment, Word, CaptionStyle } from '../../types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pad a number to a fixed width with leading zeros. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/** Convert seconds → SRT timestamp  "HH:MM:SS,mmm" */
function toSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000)
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(ms, 3)}`
}

/** Convert seconds → VTT timestamp  "HH:MM:SS.mmm" */
function toVTT(seconds: number): string {
  return toSRT(seconds).replace(',', '.')
}

/** Convert seconds → ASS timestamp  "H:MM:SS.cc" */
function toASS(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.round((seconds - Math.floor(seconds)) * 100)
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`
}

// ---------------------------------------------------------------------------
// Premium caption constants
// ---------------------------------------------------------------------------

/** Silence gap threshold in seconds – gaps longer than this split caption groups. */
const SILENCE_GAP_THRESHOLD = 0.8
/** Maximum words displayed simultaneously in a caption group. */
const MAX_WORDS_PER_GROUP = 8
/** Target words per display line within a group (splits into 2 lines above this). */
const WORDS_PER_LINE = 4
/** ASS BGR color for the active (currently-spoken) word – yellow. */
const ACTIVE_COLOR = '\\c&H00FFFF&'
/** ASS BGR color for inactive words – white. */
const BASE_COLOR = '\\c&HFFFFFF&'
/** Font size for the active word. */
const ACTIVE_FONT_SIZE = 54
/** Font size for inactive words (matches style default). */
const BASE_FONT_SIZE = 42

// ---------------------------------------------------------------------------
// Medium caption constants (smaller, bottom-positioned for longer content)
// ---------------------------------------------------------------------------

/** Font size for the active word in medium style. */
const MEDIUM_ACTIVE_FONT_SIZE = 40
/** Font size for inactive words in medium style. */
const MEDIUM_BASE_FONT_SIZE = 32

// ---------------------------------------------------------------------------
// SRT (segment-level)
// ---------------------------------------------------------------------------

export function generateSRT(transcript: Transcript): string {
  return transcript.segments
    .map((seg: Segment, i: number) => {
      const idx = i + 1
      const start = toSRT(seg.start)
      const end = toSRT(seg.end)
      const text = seg.text.trim()
      return `${idx}\n${start} --> ${end}\n${text}`
    })
    .join('\n\n')
    .concat('\n')
}

// ---------------------------------------------------------------------------
// VTT (segment-level)
// ---------------------------------------------------------------------------

export function generateVTT(transcript: Transcript): string {
  const cues = transcript.segments
    .map((seg: Segment) => {
      const start = toVTT(seg.start)
      const end = toVTT(seg.end)
      const text = seg.text.trim()
      return `${start} --> ${end}\n${text}`
    })
    .join('\n\n')

  return `WEBVTT\n\n${cues}\n`
}

// ---------------------------------------------------------------------------
// ASS – Premium active-word-pop captions
// ---------------------------------------------------------------------------

// Bundled Montserrat fonts are copied alongside the ASS file at render time;
// FFmpeg's ass filter is invoked with fontsdir=. so libass finds them.
const ASS_HEADER = `[Script Info]
Title: Auto-generated captions
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,42,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

// Medium style: smaller font, bottom-aligned (Alignment=2 is bottom-center)
// MarginV=60 pushes it slightly higher from the very bottom edge
const ASS_HEADER_MEDIUM = `[Script Info]
Title: Auto-generated captions
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,32,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,1,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

/**
 * Group words into caption groups split on silence gaps and max word count.
 * All words within a group are displayed simultaneously; captions disappear
 * entirely during gaps longer than SILENCE_GAP_THRESHOLD.
 */
function groupWordsBySpeech(words: Word[]): Word[][] {
  if (words.length === 0) return []

  const groups: Word[][] = []
  let current: Word[] = []

  for (let i = 0; i < words.length; i++) {
    current.push(words[i])

    const isLast = i === words.length - 1
    const hasGap =
      !isLast && words[i + 1].start - words[i].end > SILENCE_GAP_THRESHOLD
    const atMax = current.length >= MAX_WORDS_PER_GROUP

    if (isLast || hasGap || atMax) {
      groups.push(current)
      current = []
    }
  }

  return groups
}

/**
 * Split a caption group into 1–2 display lines.
 * Groups with ≤ WORDS_PER_LINE words stay on one line; larger groups
 * are split at the midpoint into two lines joined with \\N.
 */
function splitGroupIntoLines(group: Word[]): Word[][] {
  if (group.length <= WORDS_PER_LINE) return [group]
  const mid = Math.ceil(group.length / 2)
  return [group.slice(0, mid), group.slice(mid)]
}

/**
 * Build premium ASS dialogue lines with active-word highlighting.
 * Generates one Dialogue line per word-state: the full caption group is
 * rendered with the currently-spoken word in yellow at a larger size while
 * all other words stay white at the base size.  Contiguous end/start times
 * between word-states prevent flicker.
 */
function buildPremiumDialogueLines(words: Word[], style: CaptionStyle = 'shorts'): string[] {
  const activeFontSize = style === 'medium' ? MEDIUM_ACTIVE_FONT_SIZE : ACTIVE_FONT_SIZE
  const baseFontSize = style === 'medium' ? MEDIUM_BASE_FONT_SIZE : BASE_FONT_SIZE
  const groups = groupWordsBySpeech(words)
  const dialogues: string[] = []

  for (const group of groups) {
    const displayLines = splitGroupIntoLines(group)

    for (let activeIdx = 0; activeIdx < group.length; activeIdx++) {
      const activeWord = group[activeIdx]

      // Contiguous timing: end = next word's start, or this word's own end
      const endTime =
        activeIdx < group.length - 1
          ? group[activeIdx + 1].start
          : activeWord.end

      // Render all words across display lines with the active word highlighted
      const renderedLines: string[] = []
      let globalIdx = 0

      for (const line of displayLines) {
        const rendered = line.map((w) => {
          const idx = globalIdx++
          const text = w.word.trim()
          if (idx === activeIdx) {
            return `{${ACTIVE_COLOR}\\fs${activeFontSize}}${text}`
          }
          return `{${BASE_COLOR}\\fs${baseFontSize}}${text}`
        })
        renderedLines.push(rendered.join(' '))
      }

      const text = renderedLines.join('\\N')
      dialogues.push(
        `Dialogue: 0,${toASS(activeWord.start)},${toASS(endTime)},Default,,0,0,0,,${text}`,
      )
    }
  }

  return dialogues
}

/**
 * Generate premium ASS captions with active-word-pop highlighting.
 * Shows 2–3 lines of text with the currently-spoken word in yellow at a
 * larger size; all other words stay white. Captions disappear during
 * silence gaps (> 0.8 s).
 */
export function generateStyledASS(transcript: Transcript, style: CaptionStyle = 'shorts'): string {
  const header = style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
  const allWords = transcript.words
  if (allWords.length === 0) return header

  return header + buildPremiumDialogueLines(allWords, style).join('\n') + '\n'
}

/**
 * Generate premium ASS captions for a single contiguous segment.
 * Filters words within [startTime, endTime] (plus buffer), adjusts timestamps
 * relative to the clip's buffered start so they align with the extracted video.
 */
export function generateStyledASSForSegment(
  transcript: Transcript,
  startTime: number,
  endTime: number,
  buffer: number = 1.0,
  style: CaptionStyle = 'shorts',
): string {
  const header = style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
  const bufferedStart = Math.max(0, startTime - buffer)
  const bufferedEnd = endTime + buffer

  const words = transcript.words.filter(
    (w) => w.start >= bufferedStart && w.end <= bufferedEnd,
  )
  if (words.length === 0) return header

  const adjusted: Word[] = words.map((w) => ({
    word: w.word,
    start: w.start - bufferedStart,
    end: w.end - bufferedStart,
  }))

  return header + buildPremiumDialogueLines(adjusted, style).join('\n') + '\n'
}

/**
 * Generate premium ASS captions for a composite clip made of multiple segments.
 * Each segment's words are extracted and remapped to the concatenated timeline,
 * accounting for the buffer added during clip extraction.
 */
export function generateStyledASSForComposite(
  transcript: Transcript,
  segments: { start: number; end: number }[],
  buffer: number = 1.0,
  style: CaptionStyle = 'shorts',
): string {
  const header = style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
  const allAdjusted: Word[] = []
  let runningOffset = 0

  for (const seg of segments) {
    const bufferedStart = Math.max(0, seg.start - buffer)
    const bufferedEnd = seg.end + buffer
    const segDuration = bufferedEnd - bufferedStart

    const words = transcript.words.filter(
      (w) => w.start >= bufferedStart && w.end <= bufferedEnd,
    )

    for (const w of words) {
      allAdjusted.push({
        word: w.word,
        start: w.start - bufferedStart + runningOffset,
        end: w.end - bufferedStart + runningOffset,
      })
    }

    runningOffset += segDuration
  }

  if (allAdjusted.length === 0) return header

  return header + buildPremiumDialogueLines(allAdjusted, style).join('\n') + '\n'
}

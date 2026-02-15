/**
 * Caption generator for the Advanced SubStation Alpha (ASS) subtitle format.
 *
 * ### Why ASS instead of SRT/VTT?
 * ASS supports inline style overrides — font size, color, and animation per
 * character/word — which enables the "active word pop" karaoke effect used
 * in modern short-form video (TikTok, Reels). SRT and VTT only support
 * plain text or basic HTML tags with no per-word timing control.
 *
 * ### Karaoke word highlighting approach
 * Instead of ASS's native `\k` karaoke tags (which highlight left-to-right
 * within a line), we generate **one Dialogue line per word-state**. Each line
 * renders the entire caption group but with the currently-spoken word in a
 * different color and size. Contiguous end/start timestamps between
 * word-states prevent flicker. This gives us full control over the visual
 * treatment (color, font-size, scale animations) without the limitations
 * of the `\k` tag.
 *
 * @module captionGenerator
 */

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
const SILENCE_GAP_THRESHOLD = 0.4
/** Maximum words displayed simultaneously in a caption group. */
const MAX_WORDS_PER_GROUP = 5
/** Target words per display line within a group (splits into 2 lines above this). */
const WORDS_PER_LINE = 3
/** ASS BGR color for the active (currently-spoken) word – yellow. */
const ACTIVE_COLOR = '\\c&H00FFFF&'
/** ASS BGR color for inactive words – white. */
const BASE_COLOR = '\\c&HFFFFFF&'
/** Font size for the active word. */
const ACTIVE_FONT_SIZE = 72
/** Font size for inactive words (matches style default). */
const BASE_FONT_SIZE = 58

// ---------------------------------------------------------------------------
// Medium caption constants (smaller, bottom-positioned for longer content)
// ---------------------------------------------------------------------------

/** Font size for the active word in medium style. */
const MEDIUM_ACTIVE_FONT_SIZE = 54
/** Font size for inactive words in medium style. */
const MEDIUM_BASE_FONT_SIZE = 44

// ---------------------------------------------------------------------------
// Portrait caption constants (Opus Clips style)
// ---------------------------------------------------------------------------

/** Font size for the active word in portrait style. */
const PORTRAIT_ACTIVE_FONT_SIZE = 144
/** Font size for inactive words in portrait style. */
const PORTRAIT_BASE_FONT_SIZE = 120
/** ASS BGR color for the active word in portrait style – green. */
const PORTRAIT_ACTIVE_COLOR = '\\c&H00FF00&'
/** ASS BGR color for inactive words in portrait style – white. */
const PORTRAIT_BASE_COLOR = '\\c&HFFFFFF&'

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

/**
 * ASS header for landscape (16:9, 1920×1080) captions.
 *
 * ### Style fields explained (comma-separated in the Style line):
 * - `Fontname: Montserrat` — bundled with the project; FFmpeg's `ass` filter
 *   uses `fontsdir=.` so libass finds the .ttf files next to the .ass file.
 * - `Fontsize: 58` — base size for inactive words
 * - `PrimaryColour: &H00FFFFFF` — white (ASS uses `&HAABBGGRR` — alpha, blue, green, red)
 * - `OutlineColour: &H00000000` — black outline for readability on any background
 * - `BackColour: &H80000000` — 50% transparent black shadow
 * - `Bold: 1` — bold for better readability at small sizes
 * - `BorderStyle: 1` — outline + drop shadow (not opaque box)
 * - `Outline: 3` — 3px outline thickness
 * - `Shadow: 1` — 1px drop shadow
 * - `Alignment: 2` — bottom-center (SSA alignment: 1=left, 2=center, 3=right;
 *   add 4 for top, 8 for middle — so 2 = bottom-center)
 * - `MarginV: 40` — 40px above the bottom edge
 * - `WrapStyle: 0` — smart word wrap
 */
const ASS_HEADER = `[Script Info]
Title: Auto-generated captions
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,58,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,20,20,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

/**
 * ASS header for portrait (9:16, 1080×1920) captions — used for shorts.
 *
 * Key differences from the landscape header:
 * - `PlayResX/Y: 1080×1920` — matches portrait video dimensions
 * - `Fontsize: 120` — larger base font for vertical video viewing (small screens)
 * - `MarginV: 770` — pushes captions toward lower-center of the frame (above
 *   bottom dead zones: TikTok=320px, Reels=310px, Shorts=300px)
 * - Hook `MarginV: 250` — below all platform top dead zones (TikTok=108px,
 *   Instagram=210px, YouTube=120px)
 * - Includes a `Hook` style: semi-transparent pill/badge background
 *   (`BorderStyle: 3` = opaque box) for the opening hook text overlay
 */
const ASS_HEADER_PORTRAIT = `[Script Info]
Title: Auto-generated captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,120,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,30,30,770,1
Style: Hook,Montserrat,56,&H00333333,&H00333333,&H60D0D0D0,&H60E0E0E0,1,0,0,0,100,100,2,0,3,18,2,8,80,80,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

/**
 * ASS header for medium-style captions (1920×1080 but smaller font).
 *
 * Used for longer clips where large captions would be distracting.
 * - `Fontsize: 44` — smaller than the shorts style
 * - `Alignment: 2` — bottom-center
 * - `MarginV: 60` — slightly higher from the bottom edge to avoid UI overlaps
 */
const ASS_HEADER_MEDIUM = `[Script Info]
Title: Auto-generated captions
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,44,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,2,1,2,20,20,60,1

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
  const activeFontSize = style === 'portrait' ? PORTRAIT_ACTIVE_FONT_SIZE
    : style === 'medium' ? MEDIUM_ACTIVE_FONT_SIZE : ACTIVE_FONT_SIZE
  const baseFontSize = style === 'portrait' ? PORTRAIT_BASE_FONT_SIZE
    : style === 'medium' ? MEDIUM_BASE_FONT_SIZE : BASE_FONT_SIZE
  const groups = groupWordsBySpeech(words)
  const dialogues: string[] = []

  for (const group of groups) {
    const displayLines = splitGroupIntoLines(group)

    for (let activeIdx = 0; activeIdx < group.length; activeIdx++) {
      const activeWord = group[activeIdx]

      // Contiguous timing: end = next word's start, or this word's own end
      // BUT cap the gap — don't stretch across pauses > 0.3s
      const endTime =
        activeIdx < group.length - 1
          ? Math.min(group[activeIdx + 1].start, activeWord.end + 0.3)
          : activeWord.end

      // Render all words across display lines with the active word highlighted
      const renderedLines: string[] = []
      let globalIdx = 0

      for (const line of displayLines) {
        const rendered = line.map((w) => {
          const idx = globalIdx++
          const text = w.word.trim()
          if (idx === activeIdx) {
            if (style === 'portrait') {
              // Opus Clips style: green color + scale pop animation
              return `{${PORTRAIT_ACTIVE_COLOR}\\fs${activeFontSize}\\fscx130\\fscy130\\t(0,150,\\fscx100\\fscy100)}${text}`
            }
            return `{${ACTIVE_COLOR}\\fs${activeFontSize}}${text}`
          }
          if (style === 'portrait') {
            return `{${PORTRAIT_BASE_COLOR}\\fs${baseFontSize}}${text}`
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
 *
 * ### How it works
 * Words are grouped by speech bursts (split on silence gaps > 0.8s or after
 * 5 words). Within each group, one Dialogue line is emitted per word — the
 * full group is shown each time, but the "active" word gets a different color
 * and larger font size. This creates a karaoke-style bounce effect.
 *
 * @param transcript - Full transcript with word-level timestamps
 * @param style - Visual style: 'shorts' (large centered), 'medium' (small bottom),
 *   or 'portrait' (Opus Clips style with green highlight + scale animation)
 * @returns Complete ASS file content (header + dialogue lines)
 */
export function generateStyledASS(transcript: Transcript, style: CaptionStyle = 'shorts'): string {
  const header = style === 'portrait' ? ASS_HEADER_PORTRAIT : style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
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
  const header = style === 'portrait' ? ASS_HEADER_PORTRAIT : style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
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
  const header = style === 'portrait' ? ASS_HEADER_PORTRAIT : style === 'medium' ? ASS_HEADER_MEDIUM : ASS_HEADER
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

// ---------------------------------------------------------------------------
// Hook text overlay for portrait shorts
// ---------------------------------------------------------------------------

/** Maximum characters for hook text before truncation. */
const HOOK_TEXT_MAX_LENGTH = 60

/**
 * Generate ASS dialogue lines for a hook text overlay at the top of the video.
 *
 * The hook is a short attention-grabbing phrase (e.g. "Here's why you should
 * learn TypeScript") displayed as a translucent pill/badge at the top of a
 * portrait video for the first few seconds.
 *
 * Uses the `Hook` style defined in {@link ASS_HEADER_PORTRAIT} which has
 * `BorderStyle: 3` (opaque box background) and `Alignment: 8` (top-center).
 *
 * The `\fad(300,500)` tag creates a 300ms fade-in and 500ms fade-out so the
 * hook doesn't appear/disappear abruptly.
 *
 * @param hookText - The attention-grabbing phrase (truncated to 60 chars)
 * @param displayDuration - How long to show the hook in seconds (default: 4s)
 * @param _style - Caption style (currently only 'portrait' uses hooks)
 * @returns A single ASS Dialogue line to append to the Events section
 */
export function generateHookOverlay(
  hookText: string,
  displayDuration: number = 4.0,
  _style: CaptionStyle = 'portrait',
): string {
  const text =
    hookText.length > HOOK_TEXT_MAX_LENGTH
      ? hookText.slice(0, HOOK_TEXT_MAX_LENGTH - 3) + '...'
      : hookText

  return `Dialogue: 1,${toASS(0)},${toASS(displayDuration)},Hook,,0,0,0,,{\\fad(300,500)}${text}`
}

/**
 * Generate a complete portrait ASS file with captions AND hook text overlay.
 */
export function generatePortraitASSWithHook(
  transcript: Transcript,
  hookText: string,
  startTime: number,
  endTime: number,
  buffer?: number,
): string {
  const baseASS = generateStyledASSForSegment(transcript, startTime, endTime, buffer, 'portrait')
  const hookLine = generateHookOverlay(hookText, 4.0, 'portrait')
  return baseASS + hookLine + '\n'
}

/**
 * Generate a complete portrait ASS file for a composite clip with captions AND hook text overlay.
 */
export function generatePortraitASSWithHookComposite(
  transcript: Transcript,
  segments: { start: number; end: number }[],
  hookText: string,
  buffer?: number,
): string {
  const baseASS = generateStyledASSForComposite(transcript, segments, buffer, 'portrait')
  const hookLine = generateHookOverlay(hookText, 4.0, 'portrait')
  return baseASS + hookLine + '\n'
}

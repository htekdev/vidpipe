import { describe, it, expect } from 'vitest';
import {
  generateSRT,
  generateVTT,
  generateStyledASS,
  generateStyledASSForSegment,
  generateStyledASSForComposite,
} from '../tools/captions/captionGenerator.js';
import type { Transcript, Word, Segment } from '../types/index.js';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

function makeSegment(id: number, text: string, start: number, end: number, words: Word[] = []): Segment {
  return { id, text, start, end, words };
}

/** Simple transcript with two segments, no word-level data needed for SRT/VTT. */
const basicTranscript: Transcript = {
  text: 'Hello world. This is a test.',
  segments: [
    makeSegment(0, ' Hello world.', 0.0, 1.5),
    makeSegment(1, ' This is a test.', 2.0, 4.0),
  ],
  words: [],
  language: 'en',
  duration: 4.0,
};

const emptyTranscript: Transcript = {
  text: '',
  segments: [],
  words: [],
  language: 'en',
  duration: 0,
};

/** Words with a silence gap > 0.8s between "world" and "next". */
const wordsWithGap: Word[] = [
  { word: 'Hello', start: 0.0, end: 0.5 },
  { word: 'world', start: 0.6, end: 1.0 },
  { word: 'this', start: 1.1, end: 1.3 },
  { word: 'is', start: 1.4, end: 1.6 },
  // gap of 1.4s (1.6 → 3.0)
  { word: 'next', start: 3.0, end: 3.3 },
  { word: 'sentence', start: 3.4, end: 3.8 },
];

const transcriptWithWords: Transcript = {
  text: 'Hello world this is next sentence',
  segments: [],
  words: wordsWithGap,
  language: 'en',
  duration: 3.8,
};

/** 10 words to verify max-group splitting (MAX_WORDS_PER_GROUP = 8). */
const manyWords: Word[] = Array.from({ length: 10 }, (_, i) => ({
  word: `w${i}`,
  start: i * 0.3,
  end: i * 0.3 + 0.2,
}));

const manyWordsTranscript: Transcript = {
  text: manyWords.map((w) => w.word).join(' '),
  segments: [],
  words: manyWords,
  language: 'en',
  duration: 3.0,
};

// ---------------------------------------------------------------------------
// SRT
// ---------------------------------------------------------------------------

describe('generateSRT', () => {
  it('produces valid SRT with sequential numbering', () => {
    const srt = generateSRT(basicTranscript);
    const blocks = srt.trim().split('\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatch(/^1\n/);
    expect(blocks[1]).toMatch(/^2\n/);
  });

  it('formats timestamps as HH:MM:SS,mmm', () => {
    const srt = generateSRT(basicTranscript);
    // Expect "00:00:00,000 --> 00:00:01,500"
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('00:00:02,000 --> 00:00:04,000');
  });

  it('returns only a newline for an empty transcript', () => {
    const srt = generateSRT(emptyTranscript);
    expect(srt).toBe('\n');
  });

  it('trims segment text', () => {
    const srt = generateSRT(basicTranscript);
    expect(srt).toContain('Hello world.');
    expect(srt).not.toContain(' Hello world.');
  });
});

// ---------------------------------------------------------------------------
// VTT
// ---------------------------------------------------------------------------

describe('generateVTT', () => {
  it('starts with WEBVTT header', () => {
    const vtt = generateVTT(basicTranscript);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
  });

  it('uses dot separator in timestamps (HH:MM:SS.mmm)', () => {
    const vtt = generateVTT(basicTranscript);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.500');
  });

  it('returns header only for empty transcript', () => {
    const vtt = generateVTT(emptyTranscript);
    expect(vtt).toBe('WEBVTT\n\n\n');
  });
});

// ---------------------------------------------------------------------------
// ASS – generateStyledASS
// ---------------------------------------------------------------------------

describe('generateStyledASS', () => {
  it('contains [Script Info] header', () => {
    const ass = generateStyledASS(transcriptWithWords);
    expect(ass).toContain('[Script Info]');
  });

  it('references Montserrat font', () => {
    const ass = generateStyledASS(transcriptWithWords);
    expect(ass).toContain('Montserrat');
  });

  it('returns header only for empty transcript', () => {
    const ass = generateStyledASS(emptyTranscript);
    expect(ass).toContain('[Script Info]');
    expect(ass).not.toContain('Dialogue:');
  });

  it('highlights only the active word with yellow color', () => {
    const ass = generateStyledASS(transcriptWithWords);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // Each dialogue line should have exactly one active-color tag
    for (const line of dialogueLines) {
      const activeMatches = line.match(/\\c&H00FFFF&/g) || [];
      expect(activeMatches).toHaveLength(1);
    }
  });

  it('inactive words use white color', () => {
    const ass = generateStyledASS(transcriptWithWords);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // Lines with multiple words should have white-colored inactive words
    const multiWordLine = dialogueLines.find((l) => (l.match(/\\c&HFFFFFF&/g) || []).length > 0);
    expect(multiWordLine).toBeDefined();
  });

  it('splits words into multi-line groups with \\N', () => {
    // manyWords has 10 words; first group of 8 should split into 2 lines
    const ass = generateStyledASS(manyWordsTranscript);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    const hasMultiline = dialogueLines.some((l) => l.includes('\\N'));
    expect(hasMultiline).toBe(true);
  });

  it('creates separate groups when silence gap > 0.8s', () => {
    const ass = generateStyledASS(transcriptWithWords);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // Extract ASS timestamps from dialogue lines
    const timestamps = dialogueLines.map((l) => {
      const match = l.match(/Dialogue: 0,([^,]+),([^,]+),/);
      return match ? { start: match[1], end: match[2] } : null;
    }).filter(Boolean) as { start: string; end: string }[];

    // There should be a discontinuity – no dialogue line bridges the gap (1.6 → 3.0)
    // Words before gap end at ~1.6s, words after gap start at ~3.0s
    const beforeGap = timestamps.filter((t) => {
      const s = parseASSTimestamp(t.start);
      return s < 2.0;
    });
    const afterGap = timestamps.filter((t) => {
      const s = parseASSTimestamp(t.start);
      return s >= 2.5;
    });
    expect(beforeGap.length).toBeGreaterThan(0);
    expect(afterGap.length).toBeGreaterThan(0);
  });

  it('shorts style uses larger font sizes', () => {
    const ass = generateStyledASS(transcriptWithWords, 'shorts');
    expect(ass).toContain('\\fs54');  // active font size
    expect(ass).toContain('\\fs42');  // base font size
  });

  it('medium style uses smaller font sizes', () => {
    const ass = generateStyledASS(transcriptWithWords, 'medium');
    expect(ass).toContain('\\fs40');  // medium active font size
    expect(ass).toContain('\\fs32');  // medium base font size
  });

  it('medium style uses different header with smaller default font', () => {
    const ass = generateStyledASS(transcriptWithWords, 'medium');
    // Medium header has Fontsize 32 in style line
    const styleLine = ass.split('\n').find((l) => l.startsWith('Style: Default'));
    expect(styleLine).toContain('Montserrat,32');
  });
});

// ---------------------------------------------------------------------------
// ASS – generateStyledASSForSegment
// ---------------------------------------------------------------------------

describe('generateStyledASSForSegment', () => {
  const fullTranscript: Transcript = {
    text: '',
    segments: [],
    words: [
      { word: 'before', start: 0.0, end: 0.5 },
      { word: 'Hello', start: 5.0, end: 5.5 },
      { word: 'world', start: 5.6, end: 6.0 },
      { word: 'after', start: 15.0, end: 15.5 },
    ],
    language: 'en',
    duration: 16.0,
  };

  it('generates captions only for words within the segment range', () => {
    const ass = generateStyledASSForSegment(fullTranscript, 5.0, 6.0, 0.5);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogueLines.length).toBeGreaterThan(0);
    // Should include "Hello" and "world" but not "before" or "after"
    expect(ass).toContain('Hello');
    expect(ass).toContain('world');
    expect(ass).not.toContain('before');
    expect(ass).not.toContain('after');
  });

  it('adjusts timestamps relative to the buffered start', () => {
    const ass = generateStyledASSForSegment(fullTranscript, 5.0, 6.0, 0.5);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // bufferedStart = 5.0 - 0.5 = 4.5, so "Hello" at 5.0 maps to 0.5
    const firstLine = dialogueLines[0];
    const match = firstLine.match(/Dialogue: 0,([^,]+),/);
    expect(match).toBeTruthy();
    const startSec = parseASSTimestamp(match![1]);
    // "Hello" starts at 5.0, bufferedStart=4.5, so adjusted start = 0.5
    expect(startSec).toBeCloseTo(0.5, 1);
  });

  it('returns only header when no words match the range', () => {
    const ass = generateStyledASSForSegment(fullTranscript, 20.0, 25.0);
    expect(ass).toContain('[Script Info]');
    expect(ass).not.toContain('Dialogue:');
  });

  it('respects the style parameter', () => {
    const ass = generateStyledASSForSegment(fullTranscript, 5.0, 6.0, 0.5, 'medium');
    expect(ass).toContain('\\fs40');
  });
});

// ---------------------------------------------------------------------------
// ASS – generateStyledASSForComposite
// ---------------------------------------------------------------------------

describe('generateStyledASSForComposite', () => {
  const compositeTranscript: Transcript = {
    text: '',
    segments: [],
    words: [
      { word: 'intro', start: 1.0, end: 1.5 },
      { word: 'middle', start: 10.0, end: 10.5 },
      { word: 'end', start: 20.0, end: 20.5 },
    ],
    language: 'en',
    duration: 21.0,
  };

  it('remaps words from multiple segments onto a continuous timeline', () => {
    const segments = [
      { start: 1.0, end: 1.5 },
      { start: 10.0, end: 10.5 },
    ];
    const ass = generateStyledASSForComposite(compositeTranscript, segments, 0.5);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    expect(dialogueLines.length).toBeGreaterThan(0);
    expect(ass).toContain('intro');
    expect(ass).toContain('middle');
    expect(ass).not.toContain('end');
  });

  it('returns header only when no words match any segment', () => {
    const segments = [{ start: 50.0, end: 55.0 }];
    const ass = generateStyledASSForComposite(compositeTranscript, segments);
    expect(ass).toContain('[Script Info]');
    expect(ass).not.toContain('Dialogue:');
  });
});

// ---------------------------------------------------------------------------
// Word grouping logic (verified via ASS output)
// ---------------------------------------------------------------------------

describe('word grouping logic', () => {
  it('groups do not exceed MAX_GROUP_WORDS (8)', () => {
    const ass = generateStyledASS(manyWordsTranscript);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // Count words per dialogue group by checking how many words appear in a single line
    for (const line of dialogueLines) {
      const wordTokens = line.match(/\\fs\d+\}[^{]+/g) || [];
      expect(wordTokens.length).toBeLessThanOrEqual(8);
    }
  });

  it('silence gaps > 0.8s split groups', () => {
    // wordsWithGap: 4 words, gap, 2 words → should produce 2 groups
    const ass = generateStyledASS(transcriptWithWords);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // Group1: Hello, world, this, is (4 dialogue lines per word)
    // Group2: next, sentence (2 dialogue lines per word)
    expect(dialogueLines).toHaveLength(6);
  });

  it('lines within a group do not exceed WORDS_PER_LINE (4) per display line', () => {
    const ass = generateStyledASS(manyWordsTranscript);
    const dialogueLines = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    for (const line of dialogueLines) {
      // Split on \N to get individual display lines
      const textPart = line.split(',').slice(9).join(',');
      const displayLines = textPart.split('\\N');
      for (const dLine of displayLines) {
        const wordCount = (dLine.match(/\\fs\d+\}/g) || []).length;
        expect(wordCount).toBeLessThanOrEqual(4);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse an ASS timestamp "H:MM:SS.cc" to seconds. */
function parseASSTimestamp(ts: string): number {
  const [h, m, rest] = ts.split(':');
  const [s, cs] = rest.split('.');
  return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(cs) / 100;
}

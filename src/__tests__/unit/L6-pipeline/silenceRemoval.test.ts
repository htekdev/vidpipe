import { describe, it, expect } from 'vitest';
import { adjustTranscript } from '../../../L6-pipeline/pipeline.js';
import type { Transcript } from '../../../L0-pure/types/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTranscript(
  words: { word: string; start: number; end: number }[],
  duration: number,
): Transcript {
  return {
    text: words.map(w => w.word).join(' '),
    segments: words.length
      ? [{ id: 0, text: words.map(w => w.word).join(' '), start: words[0].start, end: words[words.length - 1].end, words }]
      : [],
    words,
    language: 'en',
    duration,
  };
}

function makeSegmentTranscript(
  segments: { id: number; text: string; start: number; end: number; words: { word: string; start: number; end: number }[] }[],
  duration: number,
): Transcript {
  return {
    text: segments.map(s => s.text).join(' '),
    segments,
    words: segments.flatMap(s => s.words),
    language: 'en',
    duration,
  };
}

// ── adjustTranscript ─────────────────────────────────────────────────────────

describe('adjustTranscript', () => {
  it('returns unchanged transcript when removals is empty', () => {
    const t = makeTranscript(
      [{ word: 'hello', start: 5, end: 6 }],
      30,
    );
    const result = adjustTranscript(t, []);
    expect(result.words[0].start).toBe(5);
    expect(result.words[0].end).toBe(6);
    expect(result.duration).toBe(30);
  });

  it('shifts word after a single removal', () => {
    // Silence removed from 10-15s → word at 20s becomes 15s
    const t = makeTranscript(
      [
        { word: 'before', start: 2, end: 3 },
        { word: 'after', start: 20, end: 21 },
      ],
      30,
    );
    const result = adjustTranscript(t, [{ start: 10, end: 15 }]);
    expect(result.words[0]).toMatchObject({ word: 'before', start: 2, end: 3 });
    expect(result.words[1]).toMatchObject({ word: 'after', start: 15, end: 16 });
    expect(result.duration).toBe(25);
  });

  it('accumulates multiple removals correctly', () => {
    // Remove 10-12 (2s) and 20-25 (5s) → word at 30s shifts by 7s total
    const t = makeTranscript(
      [
        { word: 'early', start: 5, end: 6 },
        { word: 'mid', start: 15, end: 16 },
        { word: 'late', start: 30, end: 31 },
      ],
      40,
    );
    const result = adjustTranscript(t, [
      { start: 10, end: 12 },
      { start: 20, end: 25 },
    ]);
    // 'early' at 5 → no removal before it → still 5
    expect(result.words[0].start).toBe(5);
    // 'mid' at 15 → after first removal (2s) → 13
    expect(result.words[1].start).toBe(13);
    // 'late' at 30 → after both removals (2+5=7s) → 23
    expect(result.words[2].start).toBe(23);
    expect(result.duration).toBe(33);
  });

  it('handles unsorted removals (sorts internally)', () => {
    const t = makeTranscript(
      [{ word: 'end', start: 30, end: 31 }],
      40,
    );
    // Provide removals in reverse order
    const result = adjustTranscript(t, [
      { start: 20, end: 25 },
      { start: 5, end: 10 },
    ]);
    // Total removal = 10s → 30 - 10 = 20
    expect(result.words[0].start).toBe(20);
    expect(result.duration).toBe(30);
  });

  it('snaps word inside a removed region to removal start', () => {
    // Word at 12s is inside removal 10-15s → snaps to 10s (adjusted)
    const t = makeTranscript(
      [{ word: 'inside', start: 12, end: 14 }],
      30,
    );
    // Word is entirely within removal → it gets filtered out
    const result = adjustTranscript(t, [{ start: 10, end: 15 }]);
    expect(result.words).toHaveLength(0);
  });

  it('filters out segments fully inside a removal', () => {
    const t = makeSegmentTranscript(
      [
        { id: 0, text: 'hello', start: 2, end: 4, words: [{ word: 'hello', start: 2, end: 4 }] },
        { id: 1, text: 'removed', start: 10, end: 14, words: [{ word: 'removed', start: 10, end: 14 }] },
        { id: 2, text: 'world', start: 20, end: 22, words: [{ word: 'world', start: 20, end: 22 }] },
      ],
      30,
    );
    const result = adjustTranscript(t, [{ start: 10, end: 15 }]);
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].text).toBe('hello');
    expect(result.segments[1].text).toBe('world');
    // 'world' segment shifted: 20 - 5 = 15
    expect(result.segments[1].start).toBe(15);
  });

  it('adjusts duration correctly', () => {
    const t = makeTranscript([], 60);
    const result = adjustTranscript(t, [
      { start: 10, end: 20 },
      { start: 30, end: 40 },
    ]);
    // 60 - 10 - 10 = 40
    expect(result.duration).toBe(40);
  });

  it('preserves words at exact removal boundary (start)', () => {
    // Word ending exactly at removal start should NOT be shifted
    const t = makeTranscript(
      [{ word: 'boundary', start: 8, end: 10 }],
      30,
    );
    const result = adjustTranscript(t, [{ start: 10, end: 15 }]);
    expect(result.words[0]).toMatchObject({ word: 'boundary', start: 8, end: 10 });
  });
});

// ── Keep segments logic ──────────────────────────────────────────────────────

describe('keep segments from removals', () => {
  // Reimplements the keep-segment logic from ProducerAgent.ts/SilenceRemovalAgent.ts
  function computeKeepSegments(
    removals: { start: number; end: number }[],
    videoDuration: number,
  ): { start: number; end: number }[] {
    const sorted = [...removals].sort((a, b) => a.start - b.start);
    const keepSegments: { start: number; end: number }[] = [];
    let cursor = 0;
    for (const removal of sorted) {
      if (removal.start > cursor) {
        keepSegments.push({ start: cursor, end: removal.start });
      }
      cursor = Math.max(cursor, removal.end);
    }
    if (cursor < videoDuration) {
      keepSegments.push({ start: cursor, end: videoDuration });
    }
    return keepSegments;
  }

  it('covers entire video when no removals', () => {
    const keeps = computeKeepSegments([], 60);
    expect(keeps).toEqual([{ start: 0, end: 60 }]);
  });

  it('first segment starts at 0 and last ends at duration', () => {
    const keeps = computeKeepSegments(
      [{ start: 10, end: 20 }],
      60,
    );
    expect(keeps[0].start).toBe(0);
    expect(keeps[keeps.length - 1].end).toBe(60);
  });

  it('produces complementary segments to removals', () => {
    const removals = [
      { start: 10, end: 15 },
      { start: 30, end: 35 },
    ];
    const keeps = computeKeepSegments(removals, 60);
    expect(keeps).toEqual([
      { start: 0, end: 10 },
      { start: 15, end: 30 },
      { start: 35, end: 60 },
    ]);
  });

  it('handles removal at start of video', () => {
    const keeps = computeKeepSegments(
      [{ start: 0, end: 5 }],
      60,
    );
    expect(keeps).toEqual([{ start: 5, end: 60 }]);
  });

  it('handles removal at end of video', () => {
    const keeps = computeKeepSegments(
      [{ start: 55, end: 60 }],
      60,
    );
    expect(keeps).toEqual([{ start: 0, end: 55 }]);
  });

  it('has no gaps between keep segments and removals', () => {
    const removals = [
      { start: 5, end: 10 },
      { start: 20, end: 30 },
      { start: 45, end: 50 },
    ];
    const duration = 60;
    const keeps = computeKeepSegments(removals, duration);

    // Merge keeps + removals and sort — should cover [0, duration] continuously
    const all = [...keeps, ...removals].sort((a, b) => a.start - b.start);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].start).toBe(all[i - 1].end);
    }
    expect(all[0].start).toBe(0);
    expect(all[all.length - 1].end).toBe(duration);
  });
});

// ── Effective removals from keep segments ────────────────────────────────────

describe('effective removals from keep segments', () => {
  function computeEffectiveRemovals(
    keepSegments: { start: number; end: number }[],
  ): { start: number; end: number }[] {
    const effectiveRemovals: { start: number; end: number }[] = [];
    let prevEnd = 0;
    for (const seg of keepSegments) {
      if (seg.start > prevEnd) {
        effectiveRemovals.push({ start: prevEnd, end: seg.start });
      }
      prevEnd = seg.end;
    }
    return effectiveRemovals;
  }

  it('returns empty for a single full-coverage keep segment', () => {
    const result = computeEffectiveRemovals([{ start: 0, end: 60 }]);
    expect(result).toEqual([]);
  });

  it('returns gaps between keep segments', () => {
    const result = computeEffectiveRemovals([
      { start: 0, end: 10 },
      { start: 15, end: 30 },
      { start: 35, end: 60 },
    ]);
    expect(result).toEqual([
      { start: 10, end: 15 },
      { start: 30, end: 35 },
    ]);
  });

  it('detects removal at start when first keep does not start at 0', () => {
    const result = computeEffectiveRemovals([
      { start: 5, end: 60 },
    ]);
    expect(result).toEqual([{ start: 0, end: 5 }]);
  });
});

// ── 20% safety cap (removed) ────────────────────────────────────────────────
// The 20% safety cap was removed because it prevented the producer from
// applying editorial direction that recommended cutting more than 20% of
// the video (e.g., dead air, filler words, meta-commentary). The agent
// is trusted to make good editorial decisions based on Gemini's direction.

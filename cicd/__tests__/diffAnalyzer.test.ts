import { describe, test, expect } from 'vitest';
import { parseChangedLines } from '../lib/diffAnalyzer.js';

describe('parseChangedLines', () => {
  test('parses single hunk with multiple added lines', () => {
    const diff = `diff --git a/src/L2-clients/ffmpeg/ffmpegClient.ts b/src/L2-clients/ffmpeg/ffmpegClient.ts
index abc123..def456 100644
--- a/src/L2-clients/ffmpeg/ffmpegClient.ts
+++ b/src/L2-clients/ffmpeg/ffmpegClient.ts
@@ -10,0 +11,3 @@ function foo() {
+  const x = 1;
+  const y = 2;
+  return x + y;`;

    const result = parseChangedLines(diff);
    expect(result.get('src/L2-clients/ffmpeg/ffmpegClient.ts')).toEqual([
      { start: 11, end: 13 },
    ]);
  });

  test('parses single-line modification', () => {
    const diff = `diff --git a/src/L3-services/video/clipExtractor.ts b/src/L3-services/video/clipExtractor.ts
index abc123..def456 100644
--- a/src/L3-services/video/clipExtractor.ts
+++ b/src/L3-services/video/clipExtractor.ts
@@ -25 +25 @@ function bar() {
-  old line
+  new line`;

    const result = parseChangedLines(diff);
    expect(result.get('src/L3-services/video/clipExtractor.ts')).toEqual([
      { start: 25, end: 25 },
    ]);
  });

  test('parses multiple hunks in one file', () => {
    const diff = `diff --git a/src/L0-pure/captions/captionGenerator.ts b/src/L0-pure/captions/captionGenerator.ts
index abc..def 100644
--- a/src/L0-pure/captions/captionGenerator.ts
+++ b/src/L0-pure/captions/captionGenerator.ts
@@ -5,0 +6,2 @@
+line1
+line2
@@ -20 +22 @@
-old
+new`;

    const result = parseChangedLines(diff);
    expect(result.get('src/L0-pure/captions/captionGenerator.ts')).toEqual([
      { start: 6, end: 7 },
      { start: 22, end: 22 },
    ]);
  });

  test('parses multiple files', () => {
    const diff = `diff --git a/src/L2-clients/a.ts b/src/L2-clients/a.ts
index abc..def 100644
--- a/src/L2-clients/a.ts
+++ b/src/L2-clients/a.ts
@@ -1,0 +2,1 @@
+added
diff --git a/src/L3-services/b.ts b/src/L3-services/b.ts
index abc..def 100644
--- a/src/L3-services/b.ts
+++ b/src/L3-services/b.ts
@@ -10,0 +11,1 @@
+another`;

    const result = parseChangedLines(diff);
    expect(result.size).toBe(2);
    expect(result.get('src/L2-clients/a.ts')).toEqual([{ start: 2, end: 2 }]);
    expect(result.get('src/L3-services/b.ts')).toEqual([{ start: 11, end: 11 }]);
  });

  test('handles deletion-only hunks (count=0)', () => {
    const diff = `diff --git a/src/L1-infra/config.ts b/src/L1-infra/config.ts
index abc..def 100644
--- a/src/L1-infra/config.ts
+++ b/src/L1-infra/config.ts
@@ -5,3 +5,0 @@
-deleted line 1
-deleted line 2
-deleted line 3`;

    const result = parseChangedLines(diff);
    // Deletion-only: +5,0 means no new lines added
    expect(result.get('src/L1-infra/config.ts')).toEqual([]);
  });

  test('returns empty map for empty diff', () => {
    const result = parseChangedLines('');
    expect(result.size).toBe(0);
  });
});

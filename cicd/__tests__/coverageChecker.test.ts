import { describe, test, expect } from 'vitest';
import { checkChangedLineCoverage, formatCoverageReport } from '../lib/coverageChecker.js';
import type { CodeChange } from '../lib/diffAnalyzer.js';

function makeCoverageEntry(statements: Record<number, { lines: [number, number]; count: number }>) {
  const statementMap: Record<string, any> = {};
  const s: Record<string, number> = {};

  let idx = 0;
  for (const [, { lines, count }] of Object.entries(statements)) {
    const id = String(idx++);
    statementMap[id] = {
      start: { line: lines[0], column: 0 },
      end: { line: lines[1], column: null },
    };
    s[id] = count;
  }

  return { statementMap, s };
}

describe('checkChangedLineCoverage', () => {
  test('100% coverage when all changed lines are covered', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L2-clients/ffmpeg/ffmpegClient.ts',
      layer: 2,
      changedLines: [{ start: 10, end: 12 }],
    }];

    const coverageData: Record<string, any> = {};
    const absPath = `${process.cwd().replace(/\\/g, '/')}/src/L2-clients/ffmpeg/ffmpegClient.ts`;
    coverageData[absPath] = makeCoverageEntry({
      0: { lines: [10, 10], count: 5 },
      1: { lines: [11, 11], count: 3 },
      2: { lines: [12, 12], count: 1 },
    });

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    expect(result.allPassing).toBe(true);
    expect(result.results[0].percentage).toBe(100);
    expect(result.results[0].uncoveredLines).toEqual([]);
  });

  test('partial coverage below threshold fails', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L3-services/video/videoOps.ts',
      layer: 3,
      changedLines: [{ start: 10, end: 14 }],
    }];

    const absPath = `${process.cwd().replace(/\\/g, '/')}/src/L3-services/video/videoOps.ts`;
    const coverageData: Record<string, any> = {
      [absPath]: makeCoverageEntry({
        0: { lines: [10, 10], count: 5 },
        1: { lines: [11, 11], count: 0 },
        2: { lines: [12, 12], count: 0 },
        3: { lines: [13, 13], count: 0 },
        4: { lines: [14, 14], count: 0 },
      }),
    };

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    expect(result.allPassing).toBe(false);
    expect(result.results[0].percentage).toBe(20);
    expect(result.results[0].uncoveredLines).toEqual([11, 12, 13, 14]);
  });

  test('non-executable lines are excluded from measurement', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L0-pure/utils.ts',
      layer: 0,
      changedLines: [{ start: 1, end: 5 }],
    }];

    const absPath = `${process.cwd().replace(/\\/g, '/')}/src/L0-pure/utils.ts`;
    const coverageData: Record<string, any> = {
      [absPath]: makeCoverageEntry({
        // Only lines 2 and 4 have statements; 1, 3, 5 are comments/blanks
        0: { lines: [2, 2], count: 10 },
        1: { lines: [4, 4], count: 10 },
      }),
    };

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    expect(result.allPassing).toBe(true);
    expect(result.results[0].percentage).toBe(100);
    expect(result.results[0].totalChangedLines).toBe(2); // only measurable lines
  });

  test('file not in coverage data reports 0% coverage', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L4-agents/NewAgent.ts',
      layer: 4,
      changedLines: [{ start: 1, end: 10 }],
    }];

    const result = checkChangedLineCoverage(codeChanges, {}, 80);
    expect(result.allPassing).toBe(false);
    expect(result.results[0].percentage).toBe(0);
    expect(result.results[0].uncoveredLines).toHaveLength(10);
  });

  test('empty changed lines means 100% by default', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L1-infra/config/logger.ts',
      layer: 1,
      changedLines: [],
    }];

    const result = checkChangedLineCoverage(codeChanges, {}, 80);
    expect(result.allPassing).toBe(true);
    expect(result.results[0].percentage).toBe(100);
  });

  test('Windows backslash paths are matched', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L2-clients/ffmpeg/ffmpegClient.ts',
      layer: 2,
      changedLines: [{ start: 5, end: 5 }],
    }];

    const absPath = `${process.cwd()}\\src\\L2-clients\\ffmpeg\\ffmpegClient.ts`;
    const coverageData: Record<string, any> = {
      [absPath]: makeCoverageEntry({
        0: { lines: [5, 5], count: 1 },
      }),
    };

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    expect(result.allPassing).toBe(true);
  });

  test('threshold of 0 passes even with no coverage', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L1-infra/config.ts',
      layer: 1,
      changedLines: [{ start: 1, end: 1 }],
    }];

    const result = checkChangedLineCoverage(codeChanges, {}, 0);
    expect(result.allPassing).toBe(true);
  });

  test('multiple files checked independently', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L2-clients/a.ts', layer: 2, changedLines: [{ start: 1, end: 2 }] },
      { file: 'src/L3-services/b.ts', layer: 3, changedLines: [{ start: 5, end: 5 }] },
    ];

    const coverageData: Record<string, any> = {
      [`${process.cwd().replace(/\\/g, '/')}/src/L2-clients/a.ts`]: makeCoverageEntry({
        0: { lines: [1, 1], count: 1 },
        1: { lines: [2, 2], count: 1 },
      }),
      // b.ts not in coverage
    };

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    expect(result.allPassing).toBe(false);
    expect(result.results[0].passing).toBe(true);
    expect(result.results[1].passing).toBe(false);
  });
});

describe('formatCoverageReport', () => {
  test('formats passing result', () => {
    const result = checkChangedLineCoverage(
      [{ file: 'src/L0-pure/utils.ts', layer: 0, changedLines: [] }],
      {},
      80
    );
    const report = formatCoverageReport(result);
    expect(report).toContain('threshold: 80%');
    expect(report).toContain('No measurable changes');
  });

  test('formats failing result with uncovered lines', () => {
    const codeChanges: CodeChange[] = [{
      file: 'src/L2-clients/client.ts',
      layer: 2,
      changedLines: [{ start: 10, end: 12 }],
    }];

    const absPath = `${process.cwd().replace(/\\/g, '/')}/src/L2-clients/client.ts`;
    const coverageData: Record<string, any> = {
      [absPath]: makeCoverageEntry({
        0: { lines: [10, 10], count: 0 },
        1: { lines: [11, 11], count: 0 },
        2: { lines: [12, 12], count: 0 },
      }),
    };

    const result = checkChangedLineCoverage(codeChanges, coverageData, 80);
    const report = formatCoverageReport(result);
    expect(report).toContain('❌');
    expect(report).toContain('Uncovered lines: 10, 11, 12');
  });
});

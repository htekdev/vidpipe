import { describe, test, expect, vi } from 'vitest';
import { buildFileArgs } from '../lib/testRunner.js';
import type { TestChange } from '../lib/diffAnalyzer.js';
import { readFileSync } from 'fs';

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const mockReadFileSync = vi.mocked(readFileSync);

/** Helper to set up a fake test file with given content lines */
function mockTestFile(content: string) {
  mockReadFileSync.mockReturnValue(content);
}

describe('buildFileArgs', () => {
  test('uses line numbers when changedLines are inside test blocks', () => {
    mockTestFile([
      'import { describe, test } from "vitest"',
      '',
      'describe("suite", () => {',
      '  test("first", () => {',
      '    expect(true).toBe(true)',
      '  })',
      '',
      '  test("second", () => {',
      '    expect(1).toBe(1)',
      '  })',
      '})',
    ].join('\n'));

    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L2-clients/ffmpeg.test.ts',
      tier: 'unit',
      layer: 2,
      changedLines: [{ start: 5, end: 5 }, { start: 9, end: 9 }],
    }];

    const args = buildFileArgs(testChanges);
    // Line 5 is inside test at line 4, line 9 is inside test at line 8
    expect(args).toEqual([
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:4',
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:8',
    ]);
  });

  test('uses whole file when changedLines is empty (new file)', () => {
    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L0-pure/newUtil.test.ts',
      tier: 'unit',
      layer: 0,
      changedLines: [],
    }];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual(['src/__tests__/unit/L0-pure/newUtil.test.ts']);
  });

  test('falls back to whole file when changes are in mock/import region', () => {
    mockTestFile([
      'import { vi } from "vitest"',
      'vi.mock("something", () => ({}))',
      '',
      'describe("suite", () => {',
      '  test("first", () => {})',
      '})',
    ].join('\n'));

    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L4-agents/agents.test.ts',
      tier: 'unit',
      layer: 4,
      changedLines: [{ start: 2, end: 2 }],
    }];

    const args = buildFileArgs(testChanges);
    // Line 2 is before any test block → whole file
    expect(args).toEqual(['src/__tests__/unit/L4-agents/agents.test.ts']);
  });

  test('mixes line-targeted and whole-file for multiple tests', () => {
    mockTestFile([
      'describe("suite", () => {',
      '  test("a", () => {',
      '    const x = 1',
      '  })',
      '})',
    ].join('\n'));

    const testChanges: TestChange[] = [
      {
        file: 'src/__tests__/unit/L2-clients/ffmpeg.test.ts',
        tier: 'unit',
        layer: 2,
        changedLines: [{ start: 3, end: 3 }],
      },
      {
        file: 'src/__tests__/e2e/pipeline.test.ts',
        tier: 'e2e',
        layer: -1,
        changedLines: [],
      },
    ];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual([
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:2',
      'src/__tests__/e2e/pipeline.test.ts',
    ]);
  });

  test('deduplicates when multiple hunks map to the same test block', () => {
    mockTestFile([
      'describe("suite", () => {',
      '  test("big test", () => {',
      '    const a = 1',
      '    const b = 2',
      '    const c = 3',
      '    expect(a + b).toBe(c)',
      '  })',
      '})',
    ].join('\n'));

    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L3-services/video.test.ts',
      tier: 'unit',
      layer: 3,
      changedLines: [{ start: 3, end: 3 }, { start: 5, end: 6 }],
    }];

    const args = buildFileArgs(testChanges);
    // Both hunks are inside the same test block at line 2
    expect(args).toEqual(['src/__tests__/unit/L3-services/video.test.ts:2']);
  });

  test('returns empty array for no test changes', () => {
    const args = buildFileArgs([]);
    expect(args).toEqual([]);
  });

  test('uses whole file when first hunk starts at line 1', () => {
    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L0-pure/newUtil.test.ts',
      tier: 'unit',
      layer: 0,
      changedLines: [{ start: 1, end: 10 }],
    }];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual(['src/__tests__/unit/L0-pure/newUtil.test.ts']);
  });

  test('handles describe.skipIf and test.each variants', () => {
    mockTestFile([
      'import { describe, test } from "vitest"',
      '',
      'describe.skipIf(!ffmpegOk)("ffmpeg", () => {',
      '  test.each([1,2])("case %i", () => {',
      '    expect(true).toBe(true)',
      '  })',
      '})',
    ].join('\n'));

    const testChanges: TestChange[] = [{
      file: 'src/__tests__/e2e/ffmpeg.test.ts',
      tier: 'e2e',
      layer: -1,
      changedLines: [{ start: 5, end: 5 }],
    }];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual(['src/__tests__/e2e/ffmpeg.test.ts:4']);
  });
});

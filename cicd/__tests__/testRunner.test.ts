import { describe, test, expect } from 'vitest';
import { buildFileArgs } from '../lib/testRunner.js';
import type { TestChange } from '../lib/diffAnalyzer.js';

describe('buildFileArgs', () => {
  test('uses line numbers when changedLines are present', () => {
    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L2-clients/ffmpeg.test.ts',
      tier: 'unit',
      layer: 2,
      changedLines: [{ start: 45, end: 50 }, { start: 80, end: 85 }],
    }];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual([
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:45',
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:80',
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

  test('mixes line-targeted and whole-file for multiple tests', () => {
    const testChanges: TestChange[] = [
      {
        file: 'src/__tests__/unit/L2-clients/ffmpeg.test.ts',
        tier: 'unit',
        layer: 2,
        changedLines: [{ start: 10, end: 15 }],
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
      'src/__tests__/unit/L2-clients/ffmpeg.test.ts:10',
      'src/__tests__/e2e/pipeline.test.ts',
    ]);
  });

  test('single-line change produces single line target', () => {
    const testChanges: TestChange[] = [{
      file: 'src/__tests__/unit/L3-services/video.test.ts',
      tier: 'unit',
      layer: 3,
      changedLines: [{ start: 232, end: 232 }],
    }];

    const args = buildFileArgs(testChanges);
    expect(args).toEqual(['src/__tests__/unit/L3-services/video.test.ts:232']);
  });

  test('returns empty array for no test changes', () => {
    const args = buildFileArgs([]);
    expect(args).toEqual([]);
  });
});

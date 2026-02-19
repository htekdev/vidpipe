import { describe, test, expect } from 'vitest';
import { validateTestTiers, formatMissingTiers } from '../lib/layerTestMapper.js';
import type { CodeChange, TestChange } from '../lib/diffAnalyzer.js';

describe('validateTestTiers', () => {
  test('L0 requires unit + e2e', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L0-pure/captions/captionGenerator.ts', layer: 0, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L0-pure/captions/captionGenerator.test.ts', tier: 'unit', layer: 0 },
      { file: 'src/__tests__/e2e/captions.test.ts', tier: 'e2e', layer: -1 },
    ];

    const result = validateTestTiers(codeChanges, testChanges);
    expect(result).toHaveLength(1);
    expect(result[0].allSatisfied).toBe(true);
    expect(result[0].requiredTiers).toHaveLength(2);
  });

  test('L2 requires unit + integration-L3 + e2e', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L2-clients/ffmpeg/ffmpegClient.ts', layer: 2, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L2-clients/ffmpeg/ffmpegClient.test.ts', tier: 'unit', layer: 2 },
    ];

    const result = validateTestTiers(codeChanges, testChanges);
    expect(result[0].allSatisfied).toBe(false);

    const missing = result[0].requiredTiers.filter(t => !t.satisfied);
    expect(missing.map(t => t.tier)).toContain('integration-L3');
    expect(missing.map(t => t.tier)).toContain('e2e');
  });

  test('L4 requires unit + integration-L4-L6 + e2e', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L4-agents/ShortsAgent.ts', layer: 4, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L4-agents/ShortsAgent.test.ts', tier: 'unit', layer: 4 },
      { file: 'src/__tests__/integration/L4-L6/shorts.test.ts', tier: 'integration-L4-L6', layer: 4 },
      { file: 'src/__tests__/e2e/pipeline.test.ts', tier: 'e2e', layer: -1 },
    ];

    const result = validateTestTiers(codeChanges, testChanges);
    expect(result[0].allSatisfied).toBe(true);
  });

  test('L7 requires unit + integration-L7 + e2e', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L7-app/cli.ts', layer: 7, changedLines: [] },
    ];
    const testChanges: TestChange[] = [];

    const result = validateTestTiers(codeChanges, testChanges);
    expect(result[0].allSatisfied).toBe(false);
    expect(result[0].requiredTiers.every(t => !t.satisfied)).toBe(true);
  });

  test('multiple layers aggregate requirements', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L2-clients/ffmpeg/ffmpegClient.ts', layer: 2, changedLines: [] },
      { file: 'src/L3-services/video/clipExtractor.ts', layer: 3, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L2-clients/ffmpeg/ffmpegClient.test.ts', tier: 'unit', layer: 2 },
      { file: 'src/__tests__/unit/L3-services/video/clipExtractor.test.ts', tier: 'unit', layer: 3 },
      { file: 'src/__tests__/integration/L3/video.test.ts', tier: 'integration-L3', layer: 3 },
      { file: 'src/__tests__/e2e/pipeline.test.ts', tier: 'e2e', layer: -1 },
    ];

    const result = validateTestTiers(codeChanges, testChanges);
    expect(result).toHaveLength(2);
    // Both L2 and L3 should have all tiers satisfied
    expect(result.every(r => r.allSatisfied)).toBe(true);
  });

  test('returns empty for no code changes', () => {
    const result = validateTestTiers([], []);
    expect(result).toHaveLength(0);
  });
});

describe('formatMissingTiers', () => {
  test('reports missing tiers', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L2-clients/ffmpeg/ffmpegClient.ts', layer: 2, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L2-clients/ffmpeg/ffmpegClient.test.ts', tier: 'unit', layer: 2 },
    ];

    const requirements = validateTestTiers(codeChanges, testChanges);
    const report = formatMissingTiers(requirements);

    expect(report).toContain('L2 changes require');
    expect(report).toContain('integration-L3');
    expect(report).toContain('e2e');
  });

  test('returns empty string when all satisfied', () => {
    const codeChanges: CodeChange[] = [
      { file: 'src/L0-pure/utils.ts', layer: 0, changedLines: [] },
    ];
    const testChanges: TestChange[] = [
      { file: 'src/__tests__/unit/L0-pure/utils.test.ts', tier: 'unit', layer: 0 },
      { file: 'src/__tests__/e2e/utils.test.ts', tier: 'e2e', layer: -1 },
    ];

    const requirements = validateTestTiers(codeChanges, testChanges);
    const report = formatMissingTiers(requirements);

    expect(report).toBe('');
  });
});

import { describe, test, expect } from 'vitest';
import { checkImportBoundaries, checkMockBoundaries, validateBoundaries, formatBoundaryReport } from '../lib/boundaryValidator.js';
import type { BoundaryResult } from '../lib/boundaryValidator.js';

// ── Import boundary tests ───────────────────────────────────────────────────

describe('checkImportBoundaries', () => {
  test('L0 cannot import any layer', () => {
    const content = `import { foo } from '../../L1-infra/config/logger.js'`;
    const violations = checkImportBoundaries('src/L0-pure/utils/format.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].sourceLayer).toBe(0);
    expect(violations[0].targetLayer).toBe(1);
    expect(violations[0].message).toContain('L0 cannot import L1');
  });

  test('L0 cannot import Node.js builtins', () => {
    const content = `import { readFileSync } from 'node:fs'`;
    const violations = checkImportBoundaries('src/L0-pure/utils/file.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L0 cannot import Node.js builtins');
  });

  test('L0 allows self-imports', () => {
    const content = `import { formatTime } from '../formatting/time.js'`;
    const violations = checkImportBoundaries('src/L0-pure/utils/format.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L1 can import L0', () => {
    const content = `import { formatTimestamp } from '../../L0-pure/formatting/time.js'`;
    const violations = checkImportBoundaries('src/L1-infra/config/environment.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L1 cannot import L2+', () => {
    const content = `import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'`;
    const violations = checkImportBoundaries('src/L1-infra/config/environment.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L1 cannot import L2');
  });

  test('L2 can import L0 and L1', () => {
    const content = [
      `import { formatTimestamp } from '../../L0-pure/formatting/time.js'`,
      `import logger from '../../L1-infra/config/logger.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L2-clients/ffmpeg/ffmpegClient.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L2 cannot import L3+', () => {
    const content = `import { costTracker } from '../../L3-services/costTracking/costTracker.js'`;
    const violations = checkImportBoundaries('src/L2-clients/ffmpeg/ffmpegClient.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L2 cannot import L3');
  });

  test('L3 can import L0, L1, L2', () => {
    const content = [
      `import { formatTimestamp } from '../../L0-pure/formatting/time.js'`,
      `import logger from '../../L1-infra/config/logger.js'`,
      `import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L3-services/transcription/transcription.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L3 cannot import L4+', () => {
    const content = `import { SummaryAgent } from '../../L4-agents/SummaryAgent.js'`;
    const violations = checkImportBoundaries('src/L3-services/transcription/transcription.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L3 cannot import L4');
  });

  test('L4 can import L0, L1, L3 (skips L2)', () => {
    const content = [
      `import { formatTimestamp } from '../../L0-pure/formatting/time.js'`,
      `import logger from '../../L1-infra/config/logger.js'`,
      `import { extractClip } from '../../L3-services/video/clipExtractor.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L4-agents/ShortsAgent.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L4 cannot import L2', () => {
    const content = `import { runFFmpeg } from '../../L2-clients/ffmpeg/ffmpegClient.js'`;
    const violations = checkImportBoundaries('src/L4-agents/ShortsAgent.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L4 cannot import L2');
  });

  test('L4 cannot import L5+', () => {
    const content = `import { VideoAsset } from '../../L5-assets/VideoAsset.js'`;
    const violations = checkImportBoundaries('src/L4-agents/ShortsAgent.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('L4 cannot import L5');
  });

  test('L5 can import L0, L1, L4', () => {
    const content = [
      `import type { Transcript } from '../../L0-pure/types/index.js'`,
      `import { SilenceAgent } from '../../L4-agents/SilenceAgent.js'`,
    ].join('\n');
    // Only the L4 import is runtime; the L0 is type-only (exempt)
    const violations = checkImportBoundaries('src/L5-assets/MainVideoAsset.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L5 cannot import L2 or L3', () => {
    const content = [
      `import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'`,
      `import { transcribeVideo } from '../../L3-services/transcription/transcription.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L5-assets/MainVideoAsset.ts', content);
    expect(violations).toHaveLength(2);
  });

  test('L6 can import L0, L1, L5', () => {
    const content = `import { MainVideoAsset } from '../../L5-assets/MainVideoAsset.js'`;
    const violations = checkImportBoundaries('src/L6-pipeline/pipeline.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L6 cannot import L2, L3, L4', () => {
    const content = [
      `import { runFFmpeg } from '../../L2-clients/ffmpeg/ffmpegClient.js'`,
      `import { costTracker } from '../../L3-services/costTracking/costTracker.js'`,
      `import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L6-pipeline/pipeline.ts', content);
    expect(violations).toHaveLength(3);
  });

  test('L7 can import L0, L1, L3, L6', () => {
    const content = [
      `import { formatTimestamp } from '../../L0-pure/formatting/time.js'`,
      `import logger from '../../L1-infra/config/logger.js'`,
      `import { costTracker } from '../../L3-services/costTracking/costTracker.js'`,
      `import { processVideo } from '../../L6-pipeline/processVideo.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L7-app/cli.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L7 cannot import L2, L4, L5', () => {
    const content = [
      `import { lateApi } from '../../L2-clients/late/lateApi.js'`,
      `import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'`,
      `import { MainVideoAsset } from '../../L5-assets/MainVideoAsset.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L7-app/cli.ts', content);
    expect(violations).toHaveLength(3);
  });

  test('import type is exempt from all rules', () => {
    const content = `import type { Transcript } from '../../L7-app/cli.js'`;
    const violations = checkImportBoundaries('src/L0-pure/types/index.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('non-layer imports are ignored', () => {
    const content = [
      `import { join } from 'node:path'`,
      `import { Command } from 'commander'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L7-app/cli.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('non-src files are ignored', () => {
    const content = `import { foo } from '../../L7-app/cli.js'`;
    const violations = checkImportBoundaries('cicd/lib/something.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('reports correct line numbers', () => {
    const content = [
      `import logger from '../../L1-infra/config/logger.js'`,
      `import { join } from 'node:path'`,
      `import { costTracker } from '../../L3-services/costTracking/costTracker.js'`,
    ].join('\n');
    const violations = checkImportBoundaries('src/L1-infra/config/environment.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].targetLayer).toBe(3);
  });
});

// ── Mock boundary tests ─────────────────────────────────────────────────────

describe('checkMockBoundaries', () => {
  test('L0 unit tests cannot use vi.mock() at all', () => {
    const content = `vi.mock('../../L1-infra/config/logger.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L0-pure/format.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('cannot use vi.mock()');
  });

  test('L1 unit tests can mock node:* builtins and L1 peers', () => {
    const content = [
      `vi.mock('node:fs', () => ({}))`,
      `vi.mock('../../L1-infra/config/globalConfig.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L1-infra/configResolver.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L1 unit tests cannot mock L2+ paths', () => {
    const content = `vi.mock('../../L2-clients/whisper/whisperClient.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L1-infra/configResolver.test.ts', content);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L1 paths');
  });

  test('L2 unit tests can mock L0, L1, L2 peers and externals', () => {
    const content = [
      `vi.mock('openai', () => ({}))`,
      `vi.mock('node:child_process', () => ({}))`,
      `vi.mock('../../L1-infra/config/logger.js', () => ({}))`,
      `vi.mock('../../L2-clients/ffmpeg/ffmpeg.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L2-clients/whisper.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L2 unit tests cannot mock L3+ paths', () => {
    const content = `vi.mock('../../L3-services/costTracking/costTracker.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L2-clients/whisper.test.ts', content);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L0, L1, L2 paths');
  });

  test('L3 unit tests can mock L0, L1, L2, and L3 peers', () => {
    const content = [
      `vi.mock('../../L2-clients/whisper/whisperClient.js', () => ({}))`,
      `vi.mock('../../L1-infra/config/logger.js', () => ({}))`,
      `vi.mock('../../L3-services/postStore/postStore.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L3-services/transcription.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L3 unit tests cannot mock L4+ paths', () => {
    const content = `vi.mock('../../L4-agents/ShortsAgent.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L3-services/transcription.test.ts', content);
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L0, L1, L2, L3 paths');
  });

  test('L4 unit tests can mock L0, L1, L3, L4 peers', () => {
    const content = [
      `vi.mock('../../L3-services/costTracking/costTracker.js', () => ({}))`,
      `vi.mock('../../L1-infra/config/logger.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L4-agents/ShortsAgent.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L4 unit tests cannot mock L2 or L5+ paths', () => {
    const content = `vi.mock('../../L2-clients/ffmpeg/ffmpegClient.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L4-agents/ShortsAgent.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L0, L1, L3, L4 paths');
  });

  test('L5 unit tests can mock L0, L1, L4, L5 peers', () => {
    const content = [
      `vi.mock('../../L4-agents/ShortsAgent.js', () => ({}))`,
      `vi.mock('../../L1-infra/config/logger.js', () => ({}))`,
      `vi.mock('../../L5-assets/visualEnhancement.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L5-assets/VideoAsset.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L5 unit tests cannot mock L2, L3, L6+ paths', () => {
    const content = `vi.mock('../../L3-services/costTracking/costTracker.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L5-assets/VideoAsset.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L0, L1, L4, L5 paths');
  });

  test('L6 unit tests can mock L0, L1, L5, L6 peers', () => {
    const content = [
      `vi.mock('../../L5-assets/MainVideoAsset.js', () => ({}))`,
      `vi.mock('../../L1-infra/config/logger.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L6-pipeline/pipeline.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L6 unit tests cannot mock L2, L3, L4 paths', () => {
    const content = `vi.mock('../../L4-agents/ShortsAgent.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L6-pipeline/pipeline.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain('can only mock L0, L1, L5, L6 paths');
  });

  test('L7 unit tests can mock L0, L1, L3, L6, L7 paths', () => {
    const content = [
      `vi.mock('../../L0-pure/types/index.js', () => ({}))`,
      `vi.mock('../../L1-infra/config/environment.js', () => ({}))`,
      `vi.mock('../../L3-services/scheduler/scheduler.js', () => ({}))`,
      `vi.mock('../../L6-pipeline/pipeline.js', () => ({}))`,
      `vi.mock('../../L7-app/commands/process.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L7-app/cli.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('L7 unit tests cannot mock L2, L4, L5 paths', () => {
    const content = [
      `vi.mock('../../L2-clients/late/lateApi.js', () => ({}))`,
      `vi.mock('../../L4-agents/ShortsAgent.js', () => ({}))`,
      `vi.mock('../../L5-assets/MainVideoAsset.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L7-app/cli.test.ts', content);
    expect(violations).toHaveLength(3);
  });

  test('integration/L3 can only mock L1 paths', () => {
    const content = [
      `vi.mock('../../L1-infra/fileSystem/fileSystem.js', () => ({}))`,
      `vi.mock('../../L2-clients/whisper/whisperClient.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/integration/L3/transcription.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].mockPath).toBe('../../L2-clients/whisper/whisperClient.js');
  });

  test('integration/L4-L6 can only mock L2 paths', () => {
    const content = [
      `vi.mock('../../L2-clients/gemini/geminiClient.js', () => ({}))`,
      `vi.mock('../../L3-services/costTracking/costTracker.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/integration/L4-L6/pipeline.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].mockPath).toBe('../../L3-services/costTracking/costTracker.js');
  });

  test('integration/L7 can only mock L1 and L3 paths', () => {
    const content = [
      `vi.mock('../../L1-infra/config/environment.js', () => ({}))`,
      `vi.mock('../../L3-services/ideaService/ideaService.js', () => ({}))`,
      `vi.mock('../../L6-pipeline/pipeline.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/integration/L7/VidPipeSDK.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].mockPath).toBe('../../L6-pipeline/pipeline.js');
    expect(violations[0].message).toContain('can only mock L1, L3 paths');
  });

  test('e2e tests are not checked (no tier rule matches)', () => {
    const content = `vi.mock('../../L6-pipeline/pipeline.js', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/e2e/pipeline.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('node:* builtins are allowed in layer-based mock rules', () => {
    const content = `vi.mock('node:fs', () => ({}))`;
    const violations = checkMockBoundaries('src/__tests__/unit/L3-services/transcription.test.ts', content);
    expect(violations).toHaveLength(0);
  });

  test('reports correct line numbers', () => {
    const content = [
      `import { vi } from 'vitest'`,
      ``,
      `vi.mock('node:fs', () => ({}))`,
      `vi.mock('../../L3-services/costTracking/costTracker.js', () => ({}))`,
    ].join('\n');
    const violations = checkMockBoundaries('src/__tests__/unit/L1-infra/configResolver.test.ts', content);

    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(4);
  });
});

// ── Batch validation ────────────────────────────────────────────────────────

describe('validateBoundaries', () => {
  test('returns allPassing=true when no violations', () => {
    // Use an empty array — no files to check
    const result = validateBoundaries([]);
    expect(result.allPassing).toBe(true);
    expect(result.importViolations).toHaveLength(0);
    expect(result.mockViolations).toHaveLength(0);
  });

  test('ignores non-.ts files', () => {
    const result = validateBoundaries(['README.md', 'package.json']);
    expect(result.allPassing).toBe(true);
  });

  test('ignores missing files gracefully', () => {
    const result = validateBoundaries(['src/L0-pure/nonexistent.ts']);
    expect(result.allPassing).toBe(true);
  });
});

// ── Format report ───────────────────────────────────────────────────────────

describe('formatBoundaryReport', () => {
  test('formats import violations', () => {
    const result: BoundaryResult = {
      importViolations: [{
        file: 'src/L4-agents/ShortsAgent.ts',
        line: 5,
        sourceLayer: 4,
        targetLayer: 2,
        importPath: '../../L2-clients/ffmpeg/ffmpegClient.js',
        message: 'L4 cannot import L2 (allowed: L0, L1, L3)',
      }],
      mockViolations: [],
      allPassing: false,
    };

    const report = formatBoundaryReport(result);
    expect(report).toContain('Import boundary violations');
    expect(report).toContain('ShortsAgent.ts:5');
    expect(report).toContain('L4 cannot import L2');
  });

  test('formats mock violations', () => {
    const result: BoundaryResult = {
      importViolations: [],
      mockViolations: [{
        file: 'src/__tests__/unit/L5-assets/MediumClipAsset.test.ts',
        line: 18,
        tier: 'unit/L5',
        mockPath: '../../L3-services/videoOperations/videoOperations.js',
        message: 'unit/L5 tests can only mock L0, L1, L4, L5 paths, not L3 ("../../L3-services/videoOperations/videoOperations.js")',
      }],
      allPassing: false,
    };

    const report = formatBoundaryReport(result);
    expect(report).toContain('Mock boundary violations');
    expect(report).toContain('MediumClipAsset.test.ts:18');
    expect(report).toContain('can only mock L0, L1, L4, L5 paths');
  });

  test('returns empty string when no violations', () => {
    const result: BoundaryResult = {
      importViolations: [],
      mockViolations: [],
      allPassing: true,
    };

    const report = formatBoundaryReport(result);
    expect(report).toBe('');
  });
});

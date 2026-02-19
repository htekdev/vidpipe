/**
 * Runs changed test files with vitest coverage and collects results.
 */

import { execSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { TestChange, ChangedLineRange } from './diffAnalyzer.js';

export interface TestRunResult {
  success: boolean;
  coverageDir: string;
  coverageData: Record<string, unknown> | null;
  output: string;
  error?: string;
}

const TIER_TO_PROJECT: Record<string, string> = {
  'unit': 'unit',
  'integration-L3': 'integration-L3',
  'integration-L4-L6': 'integration-L4-L6',
  'integration-L7': 'integration-L7',
  'e2e': 'e2e',
};

/**
 * Group test changes by their vitest project.
 */
function groupByProject(testChanges: readonly TestChange[]): Map<string, TestChange[]> {
  const groups = new Map<string, TestChange[]>();

  for (const test of testChanges) {
    const project = TIER_TO_PROJECT[test.tier];
    if (!project) continue;

    const entries = groups.get(project) ?? [];
    entries.push(test);
    groups.set(project, entries);
  }

  return groups;
}

/**
 * Build vitest file arguments with line-number targeting.
 * Uses `file.test.ts:line` syntax to run only the specific changed tests.
 * Falls back to whole-file when no line data is available.
 */
export function buildFileArgs(testChanges: readonly TestChange[]): string[] {
  const args: string[] = [];

  for (const test of testChanges) {
    if (test.changedLines.length === 0) {
      // New file or no line data — run entire file
      args.push(test.file);
      continue;
    }

    // Use the start line of each changed hunk as a vitest line filter
    for (const range of test.changedLines) {
      args.push(`${test.file}:${range.start}`);
    }
  }

  return args;
}

/**
 * Run tests for a specific vitest project with coverage.
 */
function runProjectTests(
  project: string,
  testChanges: readonly TestChange[],
  coverageDir: string
): { success: boolean; output: string } {
  const fileArgs = buildFileArgs(testChanges);
  const cmd = [
    'npx vitest run',
    `--project ${project}`,
    '--coverage',
    `--coverage.reportsDirectory=${coverageDir}`,
    '--coverage.reporter=json',
    '--coverage.thresholds.100=false',
    ...fileArgs,
  ].join(' ');

  try {
    const output = execSync(cmd, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return { success: true, output };
  } catch (err: any) {
    const output = (err.stdout ?? '') + '\n' + (err.stderr ?? '');
    // Tests passed but coverage thresholds failed — still count as success
    if (output.includes('Tests  ') && !output.includes('failed')) {
      return { success: true, output };
    }
    return { success: false, output };
  }
}

/**
 * Merge multiple coverage-final.json files.
 * For overlapping files, takes the max execution count per statement.
 */
function mergeCoverage(coverageDirs: string[]): Record<string, any> {
  const merged: Record<string, any> = {};

  for (const dir of coverageDirs) {
    const jsonPath = join(dir, 'coverage-final.json');
    if (!existsSync(jsonPath)) continue;

    const data = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    for (const [filePath, fileCoverage] of Object.entries(data) as [string, any][]) {
      if (!merged[filePath]) {
        merged[filePath] = fileCoverage;
        continue;
      }

      // Merge: take max execution count per statement
      const existing = merged[filePath];
      for (const [stmtId, count] of Object.entries(fileCoverage.s as Record<string, number>)) {
        if (existing.s[stmtId] !== undefined) {
          existing.s[stmtId] = Math.max(existing.s[stmtId], count);
        } else {
          existing.s[stmtId] = count;
          existing.statementMap[stmtId] = fileCoverage.statementMap[stmtId];
        }
      }
    }
  }

  return merged;
}

/**
 * Run all changed test files with coverage and return merged results.
 */
export function runTestsWithCoverage(testChanges: readonly TestChange[]): TestRunResult {
  const groups = groupByProject(testChanges);

  if (groups.size === 0) {
    return {
      success: true,
      coverageDir: '',
      coverageData: null,
      output: 'No test files to run.',
    };
  }

  const tempBase = mkdtempSync(join(tmpdir(), 'vidpipe-commit-gate-'));
  const coverageDirs: string[] = [];
  const outputs: string[] = [];
  let allSuccess = true;

  try {
    for (const [project, changes] of groups) {
      const projectCoverageDir = join(tempBase, project);
      const testCount = changes.reduce((sum, t) => sum + Math.max(t.changedLines.length, 1), 0);
      console.log(`  🧪 Running ${testCount} test target(s) in ${project}...`);

      const result = runProjectTests(project, changes, projectCoverageDir);
      outputs.push(`--- ${project} ---\n${result.output}`);
      coverageDirs.push(projectCoverageDir);

      if (!result.success) {
        allSuccess = false;
        console.log(`  ❌ ${project}: Tests failed`);
      } else {
        console.log(`  ✅ ${project}: Tests passed`);
      }
    }

    const coverageData = mergeCoverage(coverageDirs);
    const combinedOutput = outputs.join('\n\n');

    return {
      success: allSuccess,
      coverageDir: tempBase,
      coverageData: Object.keys(coverageData).length > 0 ? coverageData : null,
      output: combinedOutput,
      error: allSuccess ? undefined : 'Some tests failed. See output above.',
    };
  } catch (err: any) {
    return {
      success: false,
      coverageDir: tempBase,
      coverageData: null,
      output: '',
      error: err.message,
    };
  }
}

/**
 * Clean up temporary coverage directory.
 */
export function cleanupCoverage(coverageDir: string): void {
  if (coverageDir && existsSync(coverageDir)) {
    rmSync(coverageDir, { recursive: true, force: true });
  }
}

/**
 * Analyzes staged git changes and classifies them by type and layer.
 */

import { execSync } from 'child_process';

export interface ChangedLineRange {
  start: number;
  end: number;
}

export interface CodeChange {
  file: string;
  layer: number;
  changedLines: ChangedLineRange[];
}

export interface TestChange {
  file: string;
  tier: string;
  layer: number;
  changedLines: ChangedLineRange[];
}

export interface DiffAnalysis {
  codeChanges: CodeChange[];
  typeOnlyChanges: string[];
  testChanges: TestChange[];
  exempt: string[];
}

const LAYER_PATTERN = /^src\/L(\d)-/;
const TEST_PATTERN = /^src\/__tests__\//;
const TYPE_ONLY_PATTERNS = [
  /\/types\//,
  /\.d\.ts$/,
];

function extractLayer(filePath: string): number | null {
  const match = filePath.match(LAYER_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

function isTypeOnlyFile(filePath: string): boolean {
  return TYPE_ONLY_PATTERNS.some(p => p.test(filePath));
}

function isTestFile(filePath: string): boolean {
  return TEST_PATTERN.test(filePath);
}

function isSourceFile(filePath: string): boolean {
  return filePath.startsWith('src/') && filePath.endsWith('.ts') && !isTestFile(filePath);
}

/**
 * Parse the tier and layer from a test file path.
 */
function parseTestTier(filePath: string): { tier: string; layer: number } | null {
  const unitMatch = filePath.match(/^src\/__tests__\/unit\/L(\d)-/);
  if (unitMatch) {
    return { tier: 'unit', layer: parseInt(unitMatch[1], 10) };
  }

  if (filePath.startsWith('src/__tests__/integration/L3/')) {
    return { tier: 'integration-L3', layer: 3 };
  }

  if (filePath.startsWith('src/__tests__/integration/L4-L6/')) {
    return { tier: 'integration-L4-L6', layer: 4 };
  }

  if (filePath.startsWith('src/__tests__/integration/L7/')) {
    return { tier: 'integration-L7', layer: 7 };
  }

  if (filePath.startsWith('src/__tests__/e2e/')) {
    return { tier: 'e2e', layer: -1 };
  }

  return null;
}

/**
 * Parse `git diff --cached -U0` output to extract changed line ranges per file.
 */
export function parseChangedLines(diffOutput: string): Map<string, ChangedLineRange[]> {
  const result = new Map<string, ChangedLineRange[]>();
  let currentFile: string | null = null;

  for (const line of diffOutput.split('\n')) {
    const fileMatch = line.match(/^diff --git a\/(.*) b\/(.*)$/);
    if (fileMatch) {
      currentFile = fileMatch[2].replace(/\\/g, '/');
      if (!result.has(currentFile)) {
        result.set(currentFile, []);
      }
      continue;
    }

    // @@ -oldStart,oldCount +newStart,newCount @@
    if (currentFile && line.startsWith('@@')) {
      const hunkMatch = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        const start = parseInt(hunkMatch[1], 10);
        const count = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        if (count > 0) {
          result.get(currentFile)!.push({ start, end: start + count - 1 });
        }
      }
    }
  }

  return result;
}

/**
 * Analyze staged changes and return classified results.
 */
export function analyzeStagedChanges(): DiffAnalysis {
  const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  if (stagedFiles.length === 0) {
    return { codeChanges: [], typeOnlyChanges: [], testChanges: [], exempt: [] };
  }

  const diffOutput = execSync('git diff --cached -U0', { encoding: 'utf-8' });
  const changedLinesMap = parseChangedLines(diffOutput);

  const codeChanges: CodeChange[] = [];
  const typeOnlyChanges: string[] = [];
  const testChanges: TestChange[] = [];
  const exempt: string[] = [];

  for (const file of stagedFiles) {
    const normalizedFile = file.replace(/\\/g, '/');

    if (isTestFile(normalizedFile)) {
      const parsed = parseTestTier(normalizedFile);
      if (parsed) {
        const changedLines = changedLinesMap.get(normalizedFile) ?? changedLinesMap.get(file) ?? [];
        testChanges.push({ file: normalizedFile, ...parsed, changedLines });
      } else {
        exempt.push(normalizedFile);
      }
      continue;
    }

    if (!isSourceFile(normalizedFile)) {
      exempt.push(normalizedFile);
      continue;
    }

    const layer = extractLayer(normalizedFile);
    if (layer === null) {
      exempt.push(normalizedFile);
      continue;
    }

    if (isTypeOnlyFile(normalizedFile)) {
      typeOnlyChanges.push(normalizedFile);
      continue;
    }

    const changedLines = changedLinesMap.get(normalizedFile) ?? changedLinesMap.get(file) ?? [];
    codeChanges.push({ file: normalizedFile, layer, changedLines });
  }

  return { codeChanges, typeOnlyChanges, testChanges, exempt };
}

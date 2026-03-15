/**
 * Validates layer import boundaries in source files and mock boundaries in test files.
 *
 * Source rules (L0–L7):
 *   L0: nothing (self only)
 *   L1: L0
 *   L2: L0, L1
 *   L3: L0, L1, L2
 *   L4: L0, L1, L3       (skips L2)
 *   L5: L0, L1, L4       (skips L2, L3)
 *   L6: L0, L1, L5       (skips L2, L3, L4)
 *   L7: L0, L1, L3, L6   (skips L2, L4, L5)
 *
 * Test mock rules (vi.mock paths):
 *   unit/L0-*:     NO vi.mock() allowed
 *   unit/L1-*:     node:* builtins only
 *   unit/L2-*:     external packages only (no /L\d-/ paths)
 *   unit/L3-*:     /L2-/ paths only
 *   unit/L4-*:     /L3-/ paths only
 *   unit/L5-*:     /L4-/ paths only
 *   unit/L6-*:     /L5-/ paths only
 *   unit/L7-*:     /L0-/, /L1-/, /L3-/, /L6-/ paths only
 *   integration/L3/:       /L1-/ paths only
 *   integration/L4-L6/:    /L2-/ paths only
 *   integration/L7/:       /L1-/, /L3-/ paths only
 *
 * `import type` is exempt from all source import rules.
 */

import { readFileSync } from 'node:fs';

// ── Layer import rules ──────────────────────────────────────────────────────

const ALLOWED_IMPORTS: Record<number, number[]> = {
  0: [],
  1: [0],
  2: [0, 1],
  3: [0, 1, 2],
  4: [0, 1, 3],
  5: [0, 1, 4],
  6: [0, 1, 5],
  7: [0, 1, 3, 6],
};

// ── Test mock rules ──────────────────────────────────────────────────────────

type MockRule =
  | { kind: 'none' }
  | { kind: 'builtins-only' }
  | { kind: 'externals-only' }
  | { kind: 'layers'; allowed: number[] };

interface TestTierMockRule {
  pattern: RegExp;
  label: string;
  rule: MockRule;
}

const TEST_MOCK_RULES: TestTierMockRule[] = [
  { pattern: /\bunit\/L0-/,             label: 'unit/L0',             rule: { kind: 'none' } },
  { pattern: /\bunit\/L1-/,             label: 'unit/L1',             rule: { kind: 'builtins-only' } },
  { pattern: /\bunit\/L2-/,             label: 'unit/L2',             rule: { kind: 'externals-only' } },
  { pattern: /\bunit\/L3-/,             label: 'unit/L3',             rule: { kind: 'layers', allowed: [2] } },
  { pattern: /\bunit\/L4-/,             label: 'unit/L4',             rule: { kind: 'layers', allowed: [3] } },
  { pattern: /\bunit\/L5-/,             label: 'unit/L5',             rule: { kind: 'layers', allowed: [4] } },
  { pattern: /\bunit\/L6-/,             label: 'unit/L6',             rule: { kind: 'layers', allowed: [5] } },
  { pattern: /\bunit\/L7-/,             label: 'unit/L7',             rule: { kind: 'layers', allowed: [0, 1, 3, 6] } },
  { pattern: /\bintegration\/L3\//,      label: 'integration/L3',      rule: { kind: 'layers', allowed: [1] } },
  { pattern: /\bintegration\/L4-L6\//,   label: 'integration/L4-L6',   rule: { kind: 'layers', allowed: [2] } },
  { pattern: /\bintegration\/L7\//,      label: 'integration/L7',      rule: { kind: 'layers', allowed: [1, 3] } },
];

// ── Regex patterns ──────────────────────────────────────────────────────────

const LAYER_PATTERN = /^src\/L(\d)-/;

// Matches runtime imports (not `import type`).
// Groups: (1) = imported path
const IMPORT_REGEX = /^\s*import\s+(?!type\s).*?from\s+['"]([^'"]+)['"]/gm;

// Matches `vi.mock('...')` calls. Group (1) = mocked path
const VI_MOCK_REGEX = /vi\.mock\(\s*['"]([^'"]+)['"]/g;

// Detects layer references in mock paths
const MOCK_LAYER_REGEX = /\/L(\d)-/;

// ── Public types ─────────────────────────────────────────────────────────────

export interface ImportViolation {
  file: string;
  line: number;
  sourceLayer: number;
  targetLayer: number;
  importPath: string;
  message: string;
}

export interface MockViolation {
  file: string;
  line: number;
  tier: string;
  mockPath: string;
  message: string;
}

export interface BoundaryResult {
  importViolations: ImportViolation[];
  mockViolations: MockViolation[];
  allPassing: boolean;
}

// ── Core logic ───────────────────────────────────────────────────────────────

function extractSourceLayer(filePath: string): number | null {
  const match = filePath.match(LAYER_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

function findTestTier(filePath: string): TestTierMockRule | null {
  for (const rule of TEST_MOCK_RULES) {
    if (rule.pattern.test(filePath)) {
      return rule;
    }
  }
  return null;
}

function findLineNumber(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/**
 * Check source file imports for layer boundary violations.
 */
export function checkImportBoundaries(filePath: string, content: string): ImportViolation[] {
  const sourceLayer = extractSourceLayer(filePath);
  if (sourceLayer === null) return [];

  const allowed = ALLOWED_IMPORTS[sourceLayer];
  if (allowed === undefined) return [];

  const violations: ImportViolation[] = [];
  let match: RegExpExecArray | null;

  IMPORT_REGEX.lastIndex = 0;
  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const importPath = match[1];

    // Check for layer references in the import path
    const layerMatch = importPath.match(MOCK_LAYER_REGEX);
    if (!layerMatch) continue; // non-layer import (node:*, packages, etc.)

    const targetLayer = parseInt(layerMatch[1], 10);
    if (targetLayer === sourceLayer) continue; // self-imports are fine

    if (!allowed.includes(targetLayer)) {
      violations.push({
        file: filePath,
        line: findLineNumber(content, match.index),
        sourceLayer,
        targetLayer,
        importPath,
        message: `L${sourceLayer} cannot import L${targetLayer} (allowed: ${allowed.map(l => `L${l}`).join(', ') || 'none'})`,
      });
    }
  }

  // L0 also cannot import Node.js builtins (no I/O)
  if (sourceLayer === 0) {
    IMPORT_REGEX.lastIndex = 0;
    while ((match = IMPORT_REGEX.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('node:')) {
        violations.push({
          file: filePath,
          line: findLineNumber(content, match.index),
          sourceLayer: 0,
          targetLayer: -1,
          importPath,
          message: 'L0 cannot import Node.js builtins (no I/O allowed)',
        });
      }
    }
  }

  return violations;
}

/**
 * Check test file vi.mock() calls for mock boundary violations.
 */
export function checkMockBoundaries(filePath: string, content: string): MockViolation[] {
  const tierRule = findTestTier(filePath);
  if (!tierRule) return []; // not a recognized test tier

  const violations: MockViolation[] = [];
  let match: RegExpExecArray | null;

  VI_MOCK_REGEX.lastIndex = 0;
  while ((match = VI_MOCK_REGEX.exec(content)) !== null) {
    const mockPath = match[1];
    const line = findLineNumber(content, match.index);

    const violation = checkSingleMock(tierRule, mockPath, filePath, line);
    if (violation) {
      violations.push(violation);
    }
  }

  return violations;
}

function checkSingleMock(
  tierRule: TestTierMockRule,
  mockPath: string,
  filePath: string,
  line: number,
): MockViolation | null {
  const { rule, label } = tierRule;

  switch (rule.kind) {
    case 'none':
      return {
        file: filePath,
        line,
        tier: label,
        mockPath,
        message: `${label} tests cannot use vi.mock() (L0 is pure functions)`,
      };

    case 'builtins-only':
      if (!mockPath.startsWith('node:')) {
        return {
          file: filePath,
          line,
          tier: label,
          mockPath,
          message: `${label} tests can only mock node:* builtins, not "${mockPath}"`,
        };
      }
      return null;

    case 'externals-only': {
      const layerMatch = mockPath.match(MOCK_LAYER_REGEX);
      if (layerMatch) {
        return {
          file: filePath,
          line,
          tier: label,
          mockPath,
          message: `${label} tests can only mock external packages, not layer paths like "${mockPath}"`,
        };
      }
      return null;
    }

    case 'layers': {
      // node:* builtins are always allowed in layer-based mock rules
      if (mockPath.startsWith('node:')) return null;

      const layerMatch = mockPath.match(MOCK_LAYER_REGEX);
      if (!layerMatch) return null; // external package — allowed

      const mockedLayer = parseInt(layerMatch[1], 10);
      if (!rule.allowed.includes(mockedLayer)) {
        return {
          file: filePath,
          line,
          tier: label,
          mockPath,
          message: `${label} tests can only mock ${rule.allowed.map(l => `L${l}`).join(', ')} paths, not L${mockedLayer} ("${mockPath}")`,
        };
      }
      return null;
    }
  }
}

// ── Batch validation ─────────────────────────────────────────────────────────

/**
 * Validate import and mock boundaries for a set of files.
 * Reads file content from disk.
 */
export function validateBoundaries(files: readonly string[]): BoundaryResult {
  const importViolations: ImportViolation[] = [];
  const mockViolations: MockViolation[] = [];

  for (const file of files) {
    if (!file.endsWith('.ts')) continue;

    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // file might not exist (e.g., deleted)
    }

    const normalizedPath = file.replace(/\\/g, '/');

    if (normalizedPath.includes('__tests__/')) {
      mockViolations.push(...checkMockBoundaries(normalizedPath, content));
    } else if (normalizedPath.startsWith('src/')) {
      importViolations.push(...checkImportBoundaries(normalizedPath, content));
    }
  }

  return {
    importViolations,
    mockViolations,
    allPassing: importViolations.length === 0 && mockViolations.length === 0,
  };
}

/**
 * Format violations for console display.
 */
export function formatBoundaryReport(result: BoundaryResult): string {
  const lines: string[] = [];

  if (result.importViolations.length > 0) {
    lines.push('  Import boundary violations:');
    for (const v of result.importViolations) {
      lines.push(`    ${v.file}:${v.line}: ${v.message}`);
    }
  }

  if (result.mockViolations.length > 0) {
    lines.push('  Mock boundary violations:');
    for (const v of result.mockViolations) {
      lines.push(`    ${v.file}:${v.line}: ${v.message}`);
    }
  }

  return lines.join('\n');
}

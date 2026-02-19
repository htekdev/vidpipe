/**
 * Verifies that changed source lines are covered by test execution.
 */

import { resolve } from 'path';
import type { CodeChange, ChangedLineRange } from './diffAnalyzer.js';

export interface LineCoverageResult {
  file: string;
  totalChangedLines: number;
  coveredLines: number[];
  uncoveredLines: number[];
  percentage: number;
  passing: boolean;
}

export interface CoverageCheckResult {
  results: LineCoverageResult[];
  allPassing: boolean;
  threshold: number;
}

interface StatementLocation {
  start: { line: number; column: number };
  end: { line: number; column: number | null };
}

/**
 * Expand line ranges into individual line numbers.
 */
function expandLineRanges(ranges: readonly ChangedLineRange[]): number[] {
  const lines: number[] = [];
  for (const range of ranges) {
    for (let i = range.start; i <= range.end; i++) {
      lines.push(i);
    }
  }
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Classify statement lines as covered or uncovered from coverage data.
 */
function getStatementLines(
  statementMap: Record<string, StatementLocation>,
  s: Record<string, number>
): { covered: Set<number>; all: Set<number> } {
  const covered = new Set<number>();
  const all = new Set<number>();

  for (const [stmtId, loc] of Object.entries(statementMap)) {
    const startLine = loc.start.line;
    const endLine = loc.end?.line ?? startLine;
    for (let line = startLine; line <= endLine; line++) {
      all.add(line);
      if (s[stmtId] > 0) {
        covered.add(line);
      }
    }
  }

  return { covered, all };
}

/**
 * Find a file's coverage entry by matching relative path to absolute coverage keys.
 */
function findCoverageEntry(
  coverageData: Record<string, any>,
  relativePath: string
): any | null {
  const cwd = process.cwd();
  const absolutePath = resolve(cwd, relativePath);

  // Try exact match with forward slashes
  const forwardSlash = absolutePath.replace(/\\/g, '/');
  if (coverageData[forwardSlash]) return coverageData[forwardSlash];

  // Try with backslashes (Windows)
  const backSlash = absolutePath.replace(/\//g, '\\');
  if (coverageData[backSlash]) return coverageData[backSlash];

  // Try as-is
  if (coverageData[absolutePath]) return coverageData[absolutePath];

  // Fuzzy match: find key ending with the relative path
  const normalizedRelative = relativePath.replace(/\\/g, '/');
  for (const key of Object.keys(coverageData)) {
    const normalizedKey = key.replace(/\\/g, '/');
    if (normalizedKey.endsWith('/' + normalizedRelative) || normalizedKey.endsWith(normalizedRelative)) {
      return coverageData[key];
    }
  }

  return null;
}

/**
 * Check coverage for changed lines across all changed source files.
 */
export function checkChangedLineCoverage(
  codeChanges: readonly CodeChange[],
  coverageData: Record<string, any>,
  threshold: number = 80
): CoverageCheckResult {
  const results: LineCoverageResult[] = [];

  for (const change of codeChanges) {
    const changedLineNumbers = expandLineRanges(change.changedLines);

    if (changedLineNumbers.length === 0) {
      results.push({
        file: change.file,
        totalChangedLines: 0,
        coveredLines: [],
        uncoveredLines: [],
        percentage: 100,
        passing: true,
      });
      continue;
    }

    const fileCoverage = findCoverageEntry(coverageData, change.file);
    if (!fileCoverage) {
      results.push({
        file: change.file,
        totalChangedLines: changedLineNumbers.length,
        coveredLines: [],
        uncoveredLines: changedLineNumbers,
        percentage: 0,
        passing: threshold === 0,
      });
      continue;
    }

    const { covered, all } = getStatementLines(fileCoverage.statementMap, fileCoverage.s);

    // Only consider changed lines that have executable statements
    const measurableChangedLines = changedLineNumbers.filter(line => all.has(line));

    if (measurableChangedLines.length === 0) {
      // All changed lines are non-executable (comments, blanks, type-only)
      results.push({
        file: change.file,
        totalChangedLines: changedLineNumbers.length,
        coveredLines: [],
        uncoveredLines: [],
        percentage: 100,
        passing: true,
      });
      continue;
    }

    const coveredChangedLines = measurableChangedLines.filter(line => covered.has(line));
    const uncoveredChangedLines = measurableChangedLines.filter(line => !covered.has(line));
    const percentage = (coveredChangedLines.length / measurableChangedLines.length) * 100;

    results.push({
      file: change.file,
      totalChangedLines: measurableChangedLines.length,
      coveredLines: coveredChangedLines,
      uncoveredLines: uncoveredChangedLines,
      percentage: Math.round(percentage * 100) / 100,
      passing: percentage >= threshold,
    });
  }

  return {
    results,
    allPassing: results.every(r => r.passing),
    threshold,
  };
}

/**
 * Format coverage check results for console display.
 */
export function formatCoverageReport(result: CoverageCheckResult): string {
  const lines: string[] = [];
  lines.push(`📈 Changed-Line Coverage (threshold: ${result.threshold}%)`);

  for (const r of result.results) {
    if (r.totalChangedLines === 0) {
      lines.push(`  ${r.file}: No measurable changes`);
      continue;
    }

    const icon = r.passing ? '✅' : '❌';
    lines.push(
      `  ${r.file}: ${r.percentage}% (${r.coveredLines.length}/${r.totalChangedLines} lines) ${icon}`
    );

    if (!r.passing && r.uncoveredLines.length > 0) {
      lines.push(`    Uncovered lines: ${r.uncoveredLines.join(', ')}`);
    }
  }

  return lines.join('\n');
}

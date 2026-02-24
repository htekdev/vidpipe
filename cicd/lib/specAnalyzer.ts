/**
 * Analyzes spec files and test files for REQ-XXX traceability.
 *
 * Spec files (specs/**\/*.md) contain requirements like "| REQ-001 | ..."
 * Test files reference them as "{SpecName}.REQ-XXX" in test names.
 */

import { execSync } from 'child_process';

export interface SpecChange {
  file: string;
  specName: string;
  changedReqs: string[];
}

export interface SpecTestMapping {
  specName: string;
  reqId: string;
  fullId: string; // e.g., "CLI.REQ-001"
}

/**
 * Parse REQ-XXX IDs from spec file content.
 * Looks for patterns like "| REQ-001 |" in markdown tables.
 */
export function parseSpecReqs(content: string): string[] {
  const reqPattern = /\|\s*(REQ-\d+)\s*\|/g;
  const reqs = new Set<string>();

  let match;
  while ((match = reqPattern.exec(content)) !== null) {
    reqs.add(match[1]);
  }

  return [...reqs].sort();
}

/**
 * Parse {SpecName}.REQ-XXX references from test file content.
 * Looks for patterns like "CLI.REQ-001" in test names/descriptions.
 */
export function parseTestSpecRefs(content: string): SpecTestMapping[] {
  // Match patterns like: 'CLI.REQ-001', "CLI.REQ-001", CLI.REQ-001
  const refPattern = /['"`]?([A-Z][A-Za-z]+)\.REQ-(\d+)['"`]?/g;
  const refs: SpecTestMapping[] = [];
  const seen = new Set<string>();

  let match;
  while ((match = refPattern.exec(content)) !== null) {
    const specName = match[1];
    const reqNum = match[2];
    const reqId = `REQ-${reqNum}`;
    const fullId = `${specName}.${reqId}`;

    if (!seen.has(fullId)) {
      seen.add(fullId);
      refs.push({ specName, reqId, fullId });
    }
  }

  return refs;
}

/**
 * Extract the spec name from a spec file path.
 * e.g., "specs/L7-app/CLI.md" -> "CLI"
 */
export function extractSpecName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const match = normalized.match(/specs\/.*\/([^/]+)\.md$/);
  return match ? match[1] : '';
}

/**
 * Get changed REQ-XXX IDs from a staged spec file.
 * Returns only the REQs that appear in the changed lines.
 */
export function getChangedReqsFromDiff(filePath: string): string[] {
  try {
    // Get the diff for this specific file
    const diff = execSync(`git diff --cached -U0 -- "${filePath}"`, {
      encoding: 'utf-8',
    });

    // Extract only added/modified lines (lines starting with +, not ++)
    const addedLines = diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');

    return parseSpecReqs(addedLines);
  } catch {
    return [];
  }
}

/**
 * Get REQ references from changed test file lines.
 */
export function getChangedTestRefsFromDiff(filePath: string): SpecTestMapping[] {
  try {
    const diff = execSync(`git diff --cached -U0 -- "${filePath}"`, {
      encoding: 'utf-8',
    });

    const addedLines = diff
      .split('\n')
      .filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');

    return parseTestSpecRefs(addedLines);
  } catch {
    return [];
  }
}

export interface SpecTraceabilityResult {
  specChanges: SpecChange[];
  missingTestRefs: string[];
  satisfied: boolean;
}

/**
 * Analyze spec-test traceability for staged changes.
 *
 * @param specFiles - List of changed spec file paths
 * @param testFiles - List of changed test file paths
 * @returns Result indicating which spec REQs are missing test coverage
 */
export function analyzeSpecTestTraceability(
  specFiles: string[],
  testFiles: string[]
): SpecTraceabilityResult {
  // Collect all changed REQs from spec files
  const specChanges: SpecChange[] = [];

  for (const file of specFiles) {
    const specName = extractSpecName(file);
    if (!specName) continue;

    const changedReqs = getChangedReqsFromDiff(file);
    if (changedReqs.length > 0) {
      specChanges.push({ file, specName, changedReqs });
    }
  }

  // Collect all REQ references from changed test files
  const testRefs = new Set<string>();

  for (const file of testFiles) {
    const refs = getChangedTestRefsFromDiff(file);
    for (const ref of refs) {
      testRefs.add(ref.fullId);
    }
  }

  // Find missing test references
  const missingTestRefs: string[] = [];

  for (const spec of specChanges) {
    for (const reqId of spec.changedReqs) {
      const fullId = `${spec.specName}.${reqId}`;
      if (!testRefs.has(fullId)) {
        missingTestRefs.push(fullId);
      }
    }
  }

  return {
    specChanges,
    missingTestRefs,
    satisfied: missingTestRefs.length === 0,
  };
}

/**
 * Format a human-readable report of missing spec-test traceability.
 */
export function formatTraceabilityReport(result: SpecTraceabilityResult): string {
  if (result.satisfied) {
    return '✅ All spec changes have corresponding test references.';
  }

  const lines = ['Missing test coverage for spec requirements:\n'];

  // Group by spec file
  const bySpec = new Map<string, string[]>();
  for (const fullId of result.missingTestRefs) {
    const [specName] = fullId.split('.');
    if (!bySpec.has(specName)) {
      bySpec.set(specName, []);
    }
    bySpec.get(specName)!.push(fullId);
  }

  for (const [specName, reqs] of bySpec) {
    lines.push(`  ${specName}:`);
    for (const req of reqs) {
      lines.push(`    ❌ ${req} — add test with this ID in test name`);
    }
  }

  lines.push('\nAdd or update tests in src/__tests__/ that reference the changed requirements.');
  lines.push('Example: test(\'CLI.REQ-001: description\', () => { ... })');

  return lines.join('\n');
}

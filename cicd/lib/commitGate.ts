/**
 * Orchestrates the commit gate: analyze → validate → run tests → check coverage → commit.
 */

import { execSync } from 'child_process';
import { analyzeStagedChanges } from './diffAnalyzer.js';
import { validateTestTiers, formatMissingTiers } from './layerTestMapper.js';
import { runTestsWithCoverage, cleanupCoverage } from './testRunner.js';
import { checkChangedLineCoverage, formatCoverageReport } from './coverageChecker.js';
import { analyzeSpecTestTraceability, formatTraceabilityReport } from './specAnalyzer.js';
import { validateBoundaries, formatBoundaryReport } from './boundaryValidator.js';

export interface CommitGateOptions {
  threshold: number;
  skipCoverage: boolean;
  dryRun: boolean;
  commitArgs: string[];
}

function executeCommit(commitArgs: string[], dryRun: boolean): boolean {
  if (dryRun) {
    console.log('🔍 Dry run -- would commit with:', `git commit ${commitArgs.join(' ')}`);
    return true;
  }

  console.log('✅ All checks passed -- committing...\n');
  try {
    const escapedArgs = commitArgs.map(a => a.includes(' ') ? `"${a}"` : a);
    const output = execSync(`git commit ${escapedArgs.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    console.log(output);
    return true;
  } catch (err: any) {
    console.error('❌ git commit failed:', err.stderr?.trim() || err.message);
    return false;
  }
}

/**
 * Run the full commit gate flow.
 */
export async function runCommitGate(options: CommitGateOptions): Promise<boolean> {
  const { threshold, skipCoverage, dryRun, commitArgs } = options;

  if (skipCoverage) {
    console.log('⚠️  --skip-coverage: Skipping test and coverage checks.');
    console.log('    This should only be used for emergencies.\n');
  }

  // ── Step 1: Analyze staged changes ─────────────────────────────────────────

  console.log('📋 Step 1: Analyzing staged changes\n');

  const analysis = analyzeStagedChanges();
  const layerList = [...new Set(analysis.codeChanges.map(c => `L${c.layer}`))].join(', ');
  const tierList = [...new Set(analysis.testChanges.map(t => t.tier))].join(', ');

  console.log(`  Code files:  ${analysis.codeChanges.length} file(s)${layerList ? ` across ${layerList}` : ''}`);
  console.log(`  Type files:  ${analysis.typeOnlyChanges.length} file(s)${analysis.typeOnlyChanges.length > 0 ? ' (typecheck only)' : ''}`);
  console.log(`  Test files:  ${analysis.testChanges.length} file(s)${tierList ? ` across ${tierList}` : ''}`);
  console.log(`  Spec files:  ${analysis.specChanges.length} file(s)`);
  console.log(`  Exempt:      ${analysis.exempt.length} file(s)`);
  console.log('');

  // No code, type, or spec changes → just commit
  if (analysis.codeChanges.length === 0 && analysis.typeOnlyChanges.length === 0 && analysis.specChanges.length === 0) {
    console.log('✅ No source code or spec changes detected -- skipping test requirements.\n');
    return executeCommit(commitArgs, dryRun);
  }

  // ── Step 2: Type check (for type-only files) ──────────────────────────────

  if (analysis.typeOnlyChanges.length > 0) {
    console.log('🔍 Step 2: Type checking\n');
    try {
      execSync('npx tsc --noEmit', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log('  ✅ Type check passed\n');
    } catch (err: any) {
      const stderr = err.stderr?.trim() || err.stdout?.trim() || '';
      console.log('  ❌ Type check failed:\n');
      console.log(stderr);
      return false;
    }
  }

  // Only type changes → commit after typecheck
  if (analysis.codeChanges.length === 0 && analysis.specChanges.length === 0) {
    console.log('✅ Only type changes -- typecheck passed, skipping test requirements.\n');
    return executeCommit(commitArgs, dryRun);
  }

  if (skipCoverage) {
    return executeCommit(commitArgs, dryRun);
  }

  // ── Step 3: Validate layer boundaries ────────────────────────────────────

  console.log('🔒 Step 3: Validating layer boundaries\n');

  const allChangedFiles = [
    ...analysis.codeChanges.map(c => c.file),
    ...analysis.testChanges.map(t => t.file),
  ];

  const boundaryResult = validateBoundaries(allChangedFiles);

  if (!boundaryResult.allPassing) {
    console.log('❌ Commit blocked: Layer boundary violations detected.\n');
    console.log(formatBoundaryReport(boundaryResult));
    console.log('\nFix the violations above before committing.');
    return false;
  }

  console.log(`  ✅ ${allChangedFiles.length} file(s) checked -- no boundary violations\n`);

  // ── Step 4: Validate spec-test traceability ─────────────────────────────────

  if (analysis.specChanges.length > 0) {
    console.log('📝 Step 4: Validating spec-test traceability\n');

    // ALL test files can reference specs (unit, integration, e2e)
    const allTestFiles = analysis.testChanges.map(t => t.file);

    const traceability = analyzeSpecTestTraceability(analysis.specChanges, allTestFiles);

    if (traceability.specChanges.length > 0) {
      const totalReqs = traceability.specChanges.reduce((sum, s) => sum + s.changedReqs.length, 0);
      console.log(`  Spec changes: ${traceability.specChanges.length} file(s), ${totalReqs} REQ(s) added/modified`);
      console.log(`  Test refs:    ${totalReqs - traceability.missingTestRefs.length} covered, ${traceability.missingTestRefs.length} missing`);
      console.log('');

      if (!traceability.satisfied) {
        console.log('❌ Commit blocked: Spec changes missing test coverage.\n');
        console.log(formatTraceabilityReport(traceability));
        return false;
      }

      console.log('  ✅ All spec requirements have corresponding tests\n');
    }
  }

  // ── Step 5: Validate test tiers ────────────────────────────────────────────

  console.log('📊 Step 5: Validating test tier coverage\n');

  const requirements = validateTestTiers(analysis.codeChanges, analysis.testChanges);
  const allTiersSatisfied = requirements.every(r => r.allSatisfied);

  for (const req of requirements) {
    const tiers = req.requiredTiers
      .map(t => `${t.tier} ${t.satisfied ? '✅' : '❌'}`)
      .join(', ');
    console.log(`  L${req.layer} changes require: ${tiers}`);
  }
  console.log('');

  if (!allTiersSatisfied) {
    console.log('❌ Commit blocked: Missing test changes in required tiers.\n');
    console.log(formatMissingTiers(requirements));
    console.log('\nAdd tests in the missing tiers and stage them before committing.');
    return false;
  }

  // ── Step 6: Run tests ──────────────────────────────────────────────────────

  console.log('🧪 Step 6: Running changed tests with coverage\n');

  const testResult = runTestsWithCoverage(analysis.testChanges);

  try {
    if (!testResult.success) {
      console.log('\n❌ Commit blocked: Tests failed.\n');
      console.log(testResult.output);
      return false;
    }

    if (!testResult.coverageData) {
      console.log('  ⚠️  No coverage data produced. Skipping line coverage check.\n');
      return executeCommit(commitArgs, dryRun);
    }

    // ── Step 7: Verify changed-line coverage ─────────────────────────────────

    console.log('\n📈 Step 7: Checking changed-line coverage\n');

    // Derive active coverage scopes from the test tiers that ran
    const activeScopes = [...new Set(analysis.testChanges.map(t => t.tier))];

    const coverageResult = checkChangedLineCoverage(
      analysis.codeChanges,
      testResult.coverageData as Record<string, any>,
      threshold,
      activeScopes
    );

    console.log(formatCoverageReport(coverageResult));
    console.log('');

    if (!coverageResult.allPassing) {
      const failing = coverageResult.results.filter(r => !r.passing);
      console.log(`❌ Commit blocked: ${failing.length} file(s) below ${threshold}% threshold.`);
      console.log('   Add more test coverage for the uncovered lines.\n');
      return false;
    }

    return executeCommit(commitArgs, dryRun);
  } finally {
    cleanupCoverage(testResult.coverageDir);
  }
}

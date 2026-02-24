#!/usr/bin/env tsx
/**
 * Commit gate -- enforces test requirements before allowing commits.
 * Run via: npm run commit -- -m "commit message"
 *
 * Flow: analyze staged changes → validate test tiers → run tests → check coverage → commit
 */

import { runCommitGate } from './lib/commitGate.js';

// ── Parse arguments ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let threshold = 80;
let skipCoverage = false;
let dryRun = false;
const commitArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === '--threshold' && i + 1 < args.length) {
    threshold = parseInt(args[++i], 10);
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
      console.error('❌ --threshold must be a number between 0 and 100');
      process.exit(1);
    }
  } else if (arg === '--skip-coverage') {
    skipCoverage = true;
  } else if (arg === '--dry-run') {
    dryRun = true;
  } else {
    commitArgs.push(arg);
  }
}

if (commitArgs.length === 0 && !dryRun) {
  console.error('❌ No commit arguments provided. Usage: npm run commit -- -m "message"');
  process.exit(1);
}

// ── Run gate ─────────────────────────────────────────────────────────────────

console.log('\n🔒 Commit Gate\n');

const passed = await runCommitGate({ threshold, skipCoverage, dryRun, commitArgs });
process.exit(passed ? 0 : 1);

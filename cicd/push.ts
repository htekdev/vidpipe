#!/usr/bin/env tsx
/**
 * Unified smart push script — replaces fragmented hook scripts.
 * Run via: tsx cicd/push.ts
 *
 * Flow: pre-flight checks → push → find PR → poll gates → report results
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────

function run(cmd: string, label?: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err: any) {
    const stderr = err.stderr?.trim() || err.stdout?.trim() || err.message;
    console.error(`❌ ${label ?? cmd} failed:\n${stderr}`);
    process.exit(1);
  }
}

function tryRun(cmd: string): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { ok: true, stdout, stderr: '' };
  } catch (err: any) {
    return { ok: false, stdout: err.stdout?.trim() ?? '', stderr: err.stderr?.trim() ?? err.message };
  }
}

function parseOwnerRepo(remoteUrl: string): { owner: string; repo: string } {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/[:\/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  console.error(`❌ Could not parse owner/repo from remote URL: ${remoteUrl}`);
  process.exit(1);
}

// ── Step 1: Pre-flight checks ───────────────────────────────────────────────

console.log('\n📋 Step 1: Pre-flight checks\n');

// reviewed.md
if (!existsSync(resolve('.github', 'reviewed.md'))) {
  console.error('❌ Code review required. Run the code-reviewer agent before pushing. (.github/reviewed.md not found)');
  process.exit(1);
}
console.log('  ✓ .github/reviewed.md exists');

// gh auth
const ghAuth = tryRun('gh auth status');
if (!ghAuth.ok) {
  console.error(`❌ GitHub CLI not authenticated. Run \`gh auth login\` first.\n${ghAuth.stderr}`);
  process.exit(1);
}
console.log('  ✓ gh auth status OK');

// typecheck
console.log('  ⏳ Running type check...');
run('npx tsc --noEmit', 'Type check');
console.log('  ✓ Type check passed');

// tests
console.log('  ⏳ Running tests...');
run('npm run test:coverage', 'Tests');
console.log('  ✓ Tests passed');

// build
console.log('  ⏳ Building...');
run('npm run build', 'Build');
console.log('  ✓ Build passed');

// ── Step 2: Push ─────────────────────────────────────────────────────────────

console.log('\n🚀 Step 2: Pushing...\n');

const branch = run('git rev-parse --abbrev-ref HEAD', 'Get branch');
console.log(`  Branch: ${branch}`);

const unpushed = tryRun(`git log origin/${branch}..HEAD --oneline`);
if (unpushed.ok && unpushed.stdout.length === 0) {
  console.log('  ✓ HEAD already pushed — skipping push');
} else {
  run(`git push origin ${branch}`, 'Push');
  console.log('  ✓ Pushed successfully');
}

// ── Step 3: Find PR ──────────────────────────────────────────────────────────

console.log('\n🔍 Step 3: Finding PR...\n');

const prJson = run(`gh pr list --head ${branch} --state open --json number`, 'Find PR');
const prs: { number: number }[] = JSON.parse(prJson);

if (prs.length === 0) {
  console.log('✅ Push complete. No PR found — skipping gate checks.');
  process.exit(0);
}

const prNumber = prs[0].number;
console.log(`  Found PR #${prNumber}`);

// ── Step 4: Poll PR gates ────────────────────────────────────────────────────

console.log('\n⏳ Step 4: Polling PR gates...\n');

const sha = run('git rev-parse HEAD', 'Get HEAD sha');
const remoteUrl = run('git remote get-url origin', 'Get remote URL');
const { owner, repo } = parseOwnerRepo(remoteUrl);

console.log(`  Owner: ${owner}, Repo: ${repo}`);
console.log(`  SHA: ${sha}`);
console.log(`  Polling every 15s, max 20 attempts (5 min)...\n`);

const MAX_ATTEMPTS = 20;
const POLL_INTERVAL = 15_000;

let codeqlCompleted = false;
let codeqlConclusion = '';
let copilotReviewFound = false;
let copilotReviewCommit = '';

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const done = codeqlCompleted && copilotReviewFound;
  if (done) break;

  if (attempt > 1) await sleep(POLL_INTERVAL);

  const pending: string[] = [];
  if (!codeqlCompleted) pending.push('CodeQL');
  if (!copilotReviewFound) pending.push('Copilot Review');
  console.log(`⏳ Still waiting for ${pending.join(', ')}... (attempt ${attempt}/${MAX_ATTEMPTS})`);

  // Check CodeQL
  if (!codeqlCompleted) {
    const checksResult = tryRun(
      `gh api repos/${owner}/${repo}/commits/${sha}/check-runs --jq ".check_runs[]"`
    );
    if (checksResult.ok && checksResult.stdout) {
      // Parse the full JSON response instead of using jq array expansion
      const fullResult = tryRun(
        `gh api repos/${owner}/${repo}/commits/${sha}/check-runs`
      );
      if (fullResult.ok) {
        try {
          const checksData = JSON.parse(fullResult.stdout);
          const checkRuns: any[] = checksData.check_runs ?? [];
          const codeql = checkRuns.find((c: any) => c.name === 'CodeQL');
          if (codeql && codeql.status === 'completed') {
            codeqlCompleted = true;
            codeqlConclusion = codeql.conclusion;
          }
        } catch { /* parse error — retry next attempt */ }
      }
    }
  }

  // Check Copilot Review — accept latest review (threads are cumulative across PR)
  if (!copilotReviewFound) {
    const reviewsResult = tryRun(
      `gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews`
    );
    if (reviewsResult.ok && reviewsResult.stdout) {
      try {
        const reviews: any[] = JSON.parse(reviewsResult.stdout);
        const copilotReviews = reviews.filter(
          (r: any) => r.user?.login?.startsWith('copilot-pull-request-reviewer')
        );
        if (copilotReviews.length > 0) {
          copilotReviewFound = true;
          const latest = copilotReviews[copilotReviews.length - 1];
          copilotReviewCommit = latest.commit_id ?? '';
        }
      } catch { /* parse error — retry next attempt */ }
    }
  }
}

// ── Step 5: Report results ───────────────────────────────────────────────────

console.log('\n📊 Step 5: Results\n');

let allPassed = true;

// CodeQL result
if (!codeqlCompleted) {
  console.log('⏰ CodeQL did not complete within 5 minutes. Re-run `npm run push` later to check.');
  allPassed = false;
} else if (codeqlConclusion === 'success') {
  console.log('✅ CodeQL: No security issues found');
} else {
  // Fetch alerts
  const alertsResult = tryRun(
    `gh api "repos/${owner}/${repo}/code-scanning/alerts?ref=refs/pull/${prNumber}/head&state=open"`
  );
  if (alertsResult.ok && alertsResult.stdout) {
    try {
      const alerts: any[] = JSON.parse(alertsResult.stdout);
      if (alerts.length === 0) {
        console.log('✅ CodeQL: No security alerts on this branch');
      } else {
        allPassed = false;
        const severityCounts: Record<string, number> = {};
        alerts.forEach((a: any) => {
          const sev = a.rule?.security_severity_level || a.rule?.severity || 'unknown';
          severityCounts[sev] = (severityCounts[sev] || 0) + 1;
        });

        const sevSummary = Object.entries(severityCounts)
          .map(([s, c]) => `${c} ${s}`)
          .join(', ');

        // Write security-alerts.md
        const alertRows = alerts.map((a: any, i: number) => {
          const num = a.number ?? i + 1;
          const severity = a.rule?.security_severity_level || a.rule?.severity || 'unknown';
          const rule = a.rule?.id || 'unknown';
          const file = a.most_recent_instance?.location?.path || 'unknown';
          const line = a.most_recent_instance?.location?.start_line || '?';
          const message = a.most_recent_instance?.message?.text || a.rule?.description || '';
          return `| ${num} | ${severity} | ${rule} | ${file} | ${line} | ${message} |`;
        });

        const timestamp = new Date().toISOString();
        const md = `# Security Alerts

> Generated by \`npm run push\` — ${timestamp}
> Branch: ${branch} | PR: #${prNumber} | Commit: ${sha}

## Alerts

| # | Severity | Rule | File | Line | Message |
|---|----------|------|------|------|---------|
${alertRows.join('\n')}

## Instructions

Run the **security-fixer** agent to remediate these alerts, then run \`npm run push\` again.
`;
        mkdirSync(resolve('.github'), { recursive: true });
        writeFileSync(resolve('.github', 'security-alerts.md'), md, 'utf-8');
        console.log(`❌ CodeQL: ${alerts.length} security alerts found (${sevSummary}). Run the security-fixer agent to remediate.`);
      }
    } catch {
      console.log('❌ CodeQL: Failed — could not parse security alerts.');
    }
  } else {
    console.log('❌ CodeQL: Check failed. Could not fetch security alerts.');
  }
}

// Copilot Review result
if (!copilotReviewFound) {
  console.log('⏰ Copilot Review: No reviews found. Re-run `npm run push` later to check.');
  allPassed = false;
} else {
  if (copilotReviewCommit === sha) {
    console.log(`✅ Copilot Review: Reviewed commit ${sha.slice(0, 7)}`);
  } else {
    console.log(`ℹ️  Copilot Review: Latest review is for ${copilotReviewCommit.slice(0, 7)} (HEAD: ${sha.slice(0, 7)})`);
  }
  // Check for unresolved threads
  const graphql = `{ repository(owner:\\"${owner}\\",name:\\"${repo}\\") { pullRequest(number:${prNumber}) { reviewThreads(first:100) { nodes { isResolved } } } } }`;
  const threadsResult = tryRun(
    `gh api graphql -f query="${graphql}"`
  );
  if (threadsResult.ok && threadsResult.stdout) {
    try {
      const data = JSON.parse(threadsResult.stdout);
      const threads: any[] = data.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
      const unresolved = threads.filter((t: any) => !t.isResolved).length;
      if (unresolved > 0) {
        console.log(`⚠️ Copilot Code Review: ${unresolved} unresolved threads on PR #${prNumber}. Run the review-triage agent.`);
        allPassed = false;
      } else {
        console.log('✅ Copilot Review: All threads resolved');
      }
    } catch {
      console.log('⚠️ Copilot Review: Could not parse review threads.');
      allPassed = false;
    }
  } else {
    console.log('⚠️ Copilot Review: Could not fetch review threads.');
    allPassed = false;
  }
}

// Final summary
console.log('');
if (allPassed) {
  console.log('🎉 All PR gates passed! Push is complete.');
} else {
  console.log('⚠️ Some gates did not pass. See details above.');
}

process.exit(allPassed ? 0 : 1);

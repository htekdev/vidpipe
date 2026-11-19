# testEnforcer Specification

Source: `.github/extensions/test-enforcer/extension.mjs`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Before either Bash or PowerShell executes a commit command (`git commit` or `npm run commit`), inspect the current staged files and deny source-only changes without staged regression tests. Explain that staging in the same shell command has not run yet; require staging in a separate tool call before running `npm run commit`, without relaxing enforcement for combined commands. | P0 |
| REQ-002 | Both shells must allow commits with staged source and regression tests, or with no staged TypeScript source changes. Non-commit commands and other tools must not inspect staged files. | P1 |
| REQ-003 | Hook regression tests must resolve and import the extension from their own worktree using a file URL anchored to the test file, without relying on test-runner root fallback or an ancestor worktree. | P0 |

# testEnforcer Specification

Source: `.github/extensions/test-enforcer/extension.mjs`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Both Bash and PowerShell commit commands (`git commit` or `npm run commit`) must inspect staged files and deny source-only changes without staged regression tests. | P0 |
| REQ-002 | Both shells must allow commits with staged source and regression tests, or with no staged TypeScript source changes. Non-commit commands and other tools must not inspect staged files. | P1 |

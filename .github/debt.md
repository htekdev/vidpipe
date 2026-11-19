# Tech Debt Backlog

> Auto-maintained by code-reviewer agent. Do not delete.

## Active Items

| Date | File | Severity | Description | Status |
|------|------|----------|-------------|--------|
| 2026-11-19 | .github/extensions/test-enforcer/extension.mjs:8-11 | high | PR #182 scoped review: standalone allowlist rejects `npm run commit -- -F "C:\Temp\commit-message.txt"` and standard `-m` plus repeated `-m`/`--trailer`, preventing the required message-file/trailer workflow even with staged regression tests. Add narrow literal message-file and trailer support and regression tests without allowing staging or target overrides. | open |
| 2026-02-22 | src/L4-agents/BlogAgent.ts:330 | medium | BlogAgent return type changed from file path to markdown content - semantic breaking change that may affect callers | open |
| 2026-02-22 | specs/L4-agents/VisualEnhancement.md | low | Spec file exists but no corresponding test file in specs/__tests__/ | open |
| 2026-02-22 | specs/L7-app/CLI.md | low | Spec file exists but no corresponding test file in specs/__tests__/ | open |
| 2026-02-11 | src/L3-services/postStore/postStore.ts:205 | medium | CodeQL js/http-to-file-access: Writing API-sourced metadata to queue. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/L3-services/postStore/postStore.ts:220 | medium | CodeQL js/http-to-file-access: Writing user post content to queue. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/L3-services/postStore/postStore.ts:280 | medium | CodeQL js/http-to-file-access: Writing sanitized metadata on approval. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/L3-services/socialPosting/accountMapping.ts:82 | medium | CodeQL js/http-to-file-access: Caching API account responses. Legitimate caching with path validation and data sanitization. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-10 | .github/hooks/post-push-review.ps1 | low | PS 5.1 compatibility issues — ConvertFrom-Json may fail on some inputs | open |

> **Note (2026-02-19):** File paths updated due to L0-L7 layer restructuring in commit 10b2783.

## Resolved

| Date Found | Date Resolved | File | Description |
|------------|--------------|------|-------------|

# Tech Debt Backlog

> Auto-maintained by code-reviewer agent. Do not delete.

## Active Items

| Date | File | Severity | Description | Status |
|------|------|----------|-------------|--------|
| 2026-02-11 | src/services/postStore.ts:205 | medium | CodeQL js/http-to-file-access: Writing API-sourced metadata to queue. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/services/postStore.ts:220 | medium | CodeQL js/http-to-file-access: Writing user post content to queue. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/services/postStore.ts:280 | medium | CodeQL js/http-to-file-access: Writing sanitized metadata on approval. Legitimate app functionality with path validation. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-11 | src/services/accountMapping.ts:82 | medium | CodeQL js/http-to-file-access: Caching API account responses. Legitimate caching with path validation and data sanitization. CodeQL taint tracking doesn't recognize sanitization pattern. | deferred |
| 2026-02-10 | .github/hooks/post-push-review.ps1 | low | PS 5.1 compatibility issues — ConvertFrom-Json may fail on some inputs | open |

## Resolved

| Date Found | Date Resolved | File | Description |
|------------|--------------|------|-------------|

---
applyTo: "src/L7-app/**/*.ts"
---

# L7 — App Layer

## Purpose

CLI entry points, review server, and file watcher — the application shell. Wires together lower layers but contains no business logic itself.

## Import Rules

- ✅ Can import: L0, L1, L3, L6
- ❌ Cannot import: L2, L4, L5
- ✅ `import type` from any layer is exempt
- If L7 needs L2 functionality, create an L3 service wrapper.

```typescript
// ✅ Allowed — pipeline from L6
import { processVideo } from '../../L6-pipeline/processVideo.js'

// ✅ Allowed — service from L3
import { costTracker } from '../../L3-services/costTracking/costTracker.js'

// ✅ Allowed — config from L1 (foundation layer)
import { getConfig } from '../../L1-infra/config/environment.js'

// ❌ Blocked — L2 client (use L3 service wrapper instead)
import { lateApi } from '../../L2-clients/late/lateApi.js'

// ❌ Blocked — L4 agent (access through L6 pipeline)
import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'

// ❌ Blocked — L5 asset (access through L6 pipeline)
import { MainVideoAsset } from '../../L5-assets/MainVideoAsset.js'
```

## Key Patterns

- **CLI:** Commander (`commander` package) — entry point is `cli.ts`, builds to `dist/cli.js`
- **Review server:** Express with `createRouter()` pattern for modular route registration
- **File watcher:** Chokidar watches for new `.mp4` files, triggers pipeline
- **No business logic here** — delegate to L3 services and L6 pipeline
- Singletons are allowed at this layer (server instance, watcher instance)
- Handle process signals (SIGINT, SIGTERM) for graceful shutdown
- Parse CLI args and environment, then hand off to lower layers

```typescript
// CLI command pattern
program
  .command('process <file>')
  .description('Process a video file')
  .action(async (file) => {
    await processVideo(file)
  })
```

## Testing

- Location: `__tests__/unit/L7-app/`
- Mock L6 pipeline and L3 services only — never mock L0 or L1
- Test CLI argument parsing, route registration, watcher setup
- E2E tests (if any) go in `__tests__/e2e/` with no mocks

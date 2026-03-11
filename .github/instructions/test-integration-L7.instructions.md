---
applyTo: "src/__tests__/integration/L7/**/*.ts"
---

# L7 Integration Tests — App Layer with Mocked Infrastructure and Services

## Purpose

Test L7 app layer (CLI commands, review server routes, file watcher) with mocked L1 infrastructure and L3 services. L7 cannot import L2 directly — if L7 needs L2 functionality, create an L3 service wrapper.

## Coverage Scope: L7

## Mocking Rules

| Layer | Mock? | Why |
|-------|-------|-----|
| L0-pure | ❌ Real | Pure functions run as-is |
| L1-infra | ✅ Mock | Control config, logger, file system |
| L2-clients | ❌ N/A | L7 cannot import L2 — not in its dependency graph |
| L3-services | ✅ Mock | Control service responses for app behavior |
| L4–L5 | ❌ N/A | L7 cannot import L4 or L5 |
| L6-pipeline | ❌ Real | Real pipeline orchestration under test |

## Pattern

Mock L1 infrastructure and L3 services. Use `supertest` for HTTP route testing.

```typescript
vi.mock('../../../L1-infra/config/environment.js', () => ({
  getConfig: () => ({ /* controlled config */ }),
}))
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({
  findNextSlot: async () => '2026-02-15T19:00:00-06:00',
}))
import { createRouter } from '../../../L7-app/review/routes.js'
```

## What to Test

- HTTP API routes return correct status codes and response bodies
- CLI command handlers parse args and call correct services
- File watcher triggers pipeline on new `.mp4` files
- Error responses when services throw or return unexpected data

## Rules

- Use `vi.hoisted()` for mock variables referenced in `vi.mock()` factories
- For HTTP tests, create the Express app in `beforeAll` and use `supertest`
- Never start real servers on ports — use `supertest(app)` without `.listen()`
- Only mock L1 and L3 paths — L7 cannot import L2, L4, or L5 so they don't need mocking
- Test both success and error paths for every route/command
- Verify correct service function is called with expected arguments

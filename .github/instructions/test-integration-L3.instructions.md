---
applyTo: "src/__tests__/integration/L3/**/*.ts"
---

# L3 Integration Tests — Services with Real Clients, Mocked Infrastructure

## Purpose

Test L2 + L3 together (real clients + real services) with mocked L1 infrastructure (file I/O, config, logger, paths). L0 pure functions run real.

## Coverage Scope: L2 + L3

## Mocking Rules

| Layer | Mock? | Why |
|-------|-------|-----|
| L0-pure | ❌ Real | Pure functions — no side effects, test real behavior |
| L1-infra | ✅ Mock | Control file I/O, config values, path resolution |
| L2-clients | ❌ Real | Real external clients are tested alongside L3 |
| L3-services | ❌ Real | These are the layers under test |
| L4+ | ❌ Never | Not in scope |

## Pattern

Mock `fileSystem.js`, `paths.js`, `environment.js` to control infrastructure inputs/outputs. Let L0 pure functions (formatting, parsing, validation) run real.

```typescript
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({
  readJsonFile: vi.fn(async () => mockData),
  writeJsonFile: vi.fn(),
}))
import { markPending } from '../../../L3-services/processingState/processingState.js'
```

## What to Test

- Service orchestration logic with controlled file system state
- Correct data transformations (L0 functions run real)
- Error handling when infrastructure calls fail
- Config-dependent behavior with injected config values

## Rules

- Use `vi.hoisted()` for mock variables referenced in `vi.mock()` factories
- Never mock L0 — if a pure function is wrong, fix it in L0 tests
- L2 clients run REAL — this is what makes these integration tests (L2 + L3 tested together)
- One `describe` block per service function under test
- Keep test data minimal — only fields the service actually reads

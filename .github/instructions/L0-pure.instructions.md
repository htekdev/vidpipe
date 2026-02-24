---
applyTo: "src/L0-pure/**/*.ts"
---

# L0 — Pure Layer

## Purpose

Pure functions with zero I/O, zero imports from upper layers.

## Import Rules

- ✅ Can import: Other L0 modules only
- ❌ Cannot import: L1–L7, Node.js builtins (`fs`, `path`, `child_process`, etc.), third-party packages with I/O
- `import type` from any layer is OK

```typescript
// ✅ OK
import { formatTimestamp } from '../formatting/time.js'
import type { Transcript } from '../../L3-services/transcription/types.js'

// ❌ BLOCKED
import { readFileSync } from 'node:fs'
import logger from '../../L1-infra/config/logger.js'
```

## Key Patterns

- No side effects, no I/O, no singletons
- Functions must be deterministic — same input → same output
- All domain types live in `L0-pure/types/index.ts` — import from there, don't redeclare
- Use `as const` objects or string literal unions, no enums (except existing `PipelineStage`)
- Use `readonly` arrays in parameter types when the function doesn't mutate them
- Use `interface` for extensible object shapes, `type` for unions/intersections

## Testing

- Unit tests in `__tests__/unit/L0-pure/`
- **NO `vi.mock()` allowed at all** — these are pure functions, test them directly
- No mocking needed because there is no I/O to mock

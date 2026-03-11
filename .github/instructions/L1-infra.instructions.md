---
applyTo: "src/L1-infra/**/*.ts"
---

# L1 — Infra Layer

## Purpose

Infrastructure adapters wrapping Node.js built-ins (config, logger, fileSystem, paths).

## Import Rules

- ✅ Can import: L0, Node.js builtins
- ❌ Cannot import: L2–L7
- `import type` from any layer is OK

```typescript
// ✅ OK
import { formatTimestamp } from '../../L0-pure/formatting/time.js'
import { readFile } from 'node:fs/promises'

// ❌ BLOCKED
import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'
import { costTracker } from '../../L3-services/costTracking/costTracker.js'
```

## Key Patterns

- Singletons allowed (logger, config)
- Wraps Node.js APIs (`fs`, `path`, `child_process`) behind clean interfaces
- `getConfig()` is lazy-loaded from `environment.ts`
- Logger singleton: `import logger from './config/logger.js'`
- Use `execFile()` not `exec()` when wrapping child processes (no shell injection)
- Use `import.meta.dirname` instead of `__dirname`

## Testing

- Unit tests in `__tests__/unit/L1-infra/`
- Mock Node.js builtins only (`fs`, `child_process`, etc.)
- No layer-path mocks — don't mock L0 modules

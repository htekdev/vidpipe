---
applyTo: "src/__tests__/unit/L1-*/**/*.ts"
---
# Unit Tests — L1 (Infra)

## Mocking Rules

- ✅ Can mock **Node.js builtins only** (`node:fs`, `node:path`, `node:child_process`, `node:crypto`).
- ❌ Cannot mock any `/L0-`, `/L1-`, `/L2-`, … layer paths.
- Logger is auto-mocked by global `setup.ts` — do NOT mock it manually.

## What to Test

- Config loading and environment variable parsing
- File system wrapper behavior (read, write, mkdir, exists)
- Path resolution utilities
- Logger formatting and level filtering

## Pattern

Mock the Node.js builtin, then verify the L1 wrapper handles it correctly.

```typescript
import { vi, describe, test, expect } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{"key": "value"}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { readJsonFile } from '../../../../src/L1-infra/fileSystem/jsonReader.js'

describe('readJsonFile', () => {
  test('parses JSON from file', async () => {
    const result = await readJsonFile('/tmp/config.json')
    expect(result).toEqual({ key: 'value' })
  })
})
```

## Checklist

- [ ] Only `node:*` modules appear in `vi.mock()` calls
- [ ] No layer paths (`/L0-`, `/L2-`, etc.) in `vi.mock()`
- [ ] Logger is NOT manually mocked (global setup handles it)

---
applyTo: "src/__tests__/unit/L0-*/**/*.ts"
---
# Unit Tests — L0 (Pure)

## Mocking Rules

- ❌ **NO `vi.mock()` allowed** — L0 is pure functions with zero I/O.
- ❌ No mocking Node.js builtins, no mocking layer paths.
- If you need `vi.mock()`, the code under test doesn't belong in L0.

## What to Test

- Caption generators (SRT, VTT, ASS formatting)
- Timestamp math (formatting, parsing, arithmetic)
- Text formatters and string utilities
- Type guard functions and discriminated union helpers
- Pure data transformations

## Pattern

Direct function calls with assertions. No setup/teardown needed.

```typescript
import { generateSRT } from '../../../../src/L0-pure/captions/captionGenerator.js'

describe('generateSRT', () => {
  test('formats timestamps with arrows', () => {
    const result = generateSRT(transcript)
    expect(result).toContain('-->')
  })

  test('numbers entries sequentially', () => {
    const result = generateSRT(twoSegments)
    expect(result).toMatch(/^1\r?\n/)
  })
})
```

## Checklist

- [ ] Zero `vi.mock()` calls in the file
- [ ] Zero imports from `node:fs`, `node:child_process`, or any I/O module
- [ ] Every test is synchronous (no `async` needed for pure functions)

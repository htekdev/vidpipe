---
applyTo: "src/__tests__/unit/L6-*/**/*.ts"
---
# Unit Tests — L6 (Pipeline)

## Mocking Rules

- ✅ Can mock **L0, L1, and L5** (aligns with L6 import rules: foundation layers + layer below).
- ❌ Cannot mock L2, L3, L4, L6, or L7 paths.
- L0 pure functions rarely need mocking (they have no side effects), but it's allowed.
- L1 infrastructure (fileSystem, config, paths) can be mocked to control I/O.
- L5 assets are the primary mock target for testing pipeline orchestration.

## What to Test

- `runStage()` wrapper — error catching, timing, stage skipping
- `processVideo()` orchestration — stage ordering, data passing between stages
- Stage-level retry and skip logic
- Pipeline context construction

## Pattern

Mock L5 assets to provide controlled video data, verify pipeline orchestration.

```typescript
import { vi, describe, test, expect } from 'vitest'

const mockVideoAsset = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue({ duration: 120, path: '/tmp/v.mp4' }),
}))
vi.mock('../../../../src/L5-assets/VideoAsset.js', () => ({
  VideoAsset: vi.fn(() => mockVideoAsset),
}))

import { runStage } from '../../../../src/L6-pipeline/runStage.js'

describe('runStage', () => {
  test('catches stage errors without aborting', async () => {
    const result = await runStage('ingestion', async () => {
      throw new Error('disk full')
    })
    expect(result.error).toBeDefined()
    expect(result.skipped).toBe(false)
  })
})
```

## Checklist

- [ ] Every `vi.mock()` path contains `/L0-`, `/L1-`, or `/L5-` — nothing else
- [ ] Stage failure does NOT throw — verify `runStage` catches and records
- [ ] Stage timing is recorded (check `result.durationMs`)

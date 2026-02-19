---
applyTo: "src/__tests__/unit/L6-*/**/*.ts"
---
# Unit Tests — L6 (Pipeline)

## Mocking Rules

- ✅ Can mock **L5 asset paths only** (`vi.mock('../../../../src/L5-assets/...')`).
- ❌ Cannot mock L0-L4 or L6+ paths.

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

- [ ] Every `vi.mock()` path contains `/L5-assets/` — nothing else
- [ ] Stage failure does NOT throw — verify `runStage` catches and records
- [ ] Stage timing is recorded (check `result.durationMs`)

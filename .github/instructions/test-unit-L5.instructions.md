---
applyTo: "src/__tests__/unit/L5-*/**/*.ts"
---
# Unit Tests — L5 (Assets)

## Mocking Rules

- ✅ Can mock **L4 agent paths only** (`vi.mock('../../../../src/L4-agents/...')`).
- ❌ Cannot mock L0-L3 or L5+ paths.

## What to Test

- VideoAsset lazy-loading behavior (properties loaded on first access)
- Asset loader functions (metadata extraction, thumbnail generation)
- Asset metadata shape and defaults
- Cache invalidation logic

## Pattern

Mock the L4 agent that the asset delegates to, verify lazy-load triggers correctly.

```typescript
import { vi, describe, test, expect } from 'vitest'

const mockAgent = vi.hoisted(() => ({
  analyze: vi.fn().mockResolvedValue({ scenes: [] }),
}))
vi.mock('../../../../src/L4-agents/AnalysisAgent.js', () => ({
  AnalysisAgent: vi.fn(() => mockAgent),
}))

import { VideoAsset } from '../../../../src/L5-assets/VideoAsset.js'

describe('VideoAsset', () => {
  test('lazy-loads analysis on first access', async () => {
    const asset = new VideoAsset('/tmp/video.mp4')
    await asset.getAnalysis()
    expect(mockAgent.analyze).toHaveBeenCalledOnce()
  })
})
```

## Checklist

- [ ] Every `vi.mock()` path contains `/L4-agents/` — nothing else
- [ ] Lazy-loading tested: first access triggers load, second access uses cache

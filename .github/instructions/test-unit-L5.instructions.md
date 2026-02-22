---
applyTo: "src/__tests__/unit/L5-*/**/*.ts"
---
# Unit Tests — L5 (Assets)

## Mocking Rules

- ✅ Can mock **L0, L1, and L4** (aligns with L5 import rules: foundation layers + layer below).
- ❌ Cannot mock L2, L3, L5, L6, or L7 paths.
- L0 pure functions rarely need mocking (they have no side effects), but it's allowed.
- L1 infrastructure (fileSystem, config, paths) can be mocked to control I/O.
- L4 agents/bridges are the primary mock target for testing asset behavior.

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

- [ ] Every `vi.mock()` path contains `/L0-`, `/L1-`, or `/L4-` — nothing else
- [ ] Lazy-loading tested: first access triggers load, second access uses cache
- [ ] L0 mocks are rare (pure functions usually run real)
- [ ] L1 mocks control file I/O and config for deterministic tests

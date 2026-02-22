---
applyTo: "src/__tests__/unit/L7-*/**/*.ts"
---
# Unit Tests — L7 (App)

## Mocking Rules

- ✅ Can mock **L0, L1, and L6** (aligns with L7 import rules: foundation layers + layer below).
- ❌ Cannot mock L2, L3, L4, L5, or L7 paths.
- L0 pure functions rarely need mocking (they have no side effects), but it's allowed.
- L1 infrastructure (fileSystem, config, paths) can be mocked to control I/O.
- L6 pipeline is the primary mock target for testing app behavior.
- Note: L7 can also import L3 for services, but to mock L3, use the integration/L7/ test tier.

## What to Test

- CLI command parsing (Commander option handling, argument validation)
- Review server route handlers (request/response shapes)
- File watcher triggers (Chokidar event handling, debouncing)
- Entry-point configuration and startup logic

## Pattern

Mock the L6 pipeline to verify the app layer dispatches correctly.

```typescript
import { vi, describe, test, expect } from 'vitest'

const mockProcessVideo = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../../../../src/L6-pipeline/processVideo.js', () => ({
  processVideo: mockProcessVideo,
}))

import { handleNewRecording } from '../../../../src/L7-app/watcher/handler.js'

describe('handleNewRecording', () => {
  test('triggers pipeline for mp4 files', async () => {
    await handleNewRecording('/watch/recording.mp4')
    expect(mockProcessVideo).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: '/watch/recording.mp4' })
    )
  })

  test('ignores non-mp4 files', async () => {
    await handleNewRecording('/watch/notes.txt')
    expect(mockProcessVideo).not.toHaveBeenCalled()
  })
})
```

## Checklist

- [ ] Every `vi.mock()` path contains `/L0-`, `/L1-`, or `/L6-` — nothing else
- [ ] CLI tests verify parsed options, not stdout formatting
- [ ] Watcher tests verify debounce and file-type filtering

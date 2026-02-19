---
applyTo: "src/__tests__/unit/L7-*/**/*.ts"
---
# Unit Tests — L7 (App)

## Mocking Rules

- ✅ Can mock **L6 pipeline paths only** (`vi.mock('../../../../src/L6-pipeline/...')`).
- ❌ Cannot mock L0-L5 or L7 paths.

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

- [ ] Every `vi.mock()` path contains `/L6-pipeline/` — nothing else
- [ ] CLI tests verify parsed options, not stdout formatting
- [ ] Watcher tests verify debounce and file-type filtering

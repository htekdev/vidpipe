---
applyTo: "src/__tests__/unit/L2-*/**/*.ts"
---
# Unit Tests — L2 (Clients)

## Mocking Rules

- ✅ Can mock **external APIs and processes** (`openai`, `@anthropic-ai/sdk`, `child_process`, `exa-js`).
- ❌ Cannot mock any `/L0-`, `/L1-`, `/L2-`, … layer paths.
- Use `vi.hoisted()` for mock variables referenced inside `vi.mock()` factories (Vitest ESM requirement).

## What to Test

- FFmpeg/FFprobe wrappers — correct arguments, stderr parsing, error handling
- Whisper client — chunking, API call construction, response merging
- Gemini client — prompt construction, response parsing
- LateApi client — HTTP request formation, error handling
- LLM providers — session management, token counting

## Pattern

Mock the external dependency, verify the client passes correct arguments.

```typescript
import { vi, describe, test, expect } from 'vitest'

const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

import { getVideoDuration } from '../../../../src/L2-clients/ffmpeg/ffprobe.js'

describe('getVideoDuration', () => {
  test('passes correct ffprobe args', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '42.5', '')
    })
    const duration = await getVideoDuration('/tmp/video.mp4')
    expect(duration).toBe(42.5)
    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['-show_entries', 'format=duration']),
      expect.any(Object),
      expect.any(Function)
    )
  })
})
```

## Checklist

- [ ] Only external packages/builtins appear in `vi.mock()` calls
- [ ] `vi.hoisted()` used for any mock variable referenced in `vi.mock()` factory
- [ ] No layer paths in `vi.mock()`

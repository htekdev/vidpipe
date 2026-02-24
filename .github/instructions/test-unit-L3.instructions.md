---
applyTo: "src/__tests__/unit/L3-*/**/*.ts"
---
# Unit Tests — L3 (Services)

## Mocking Rules

- ✅ Can mock **L2 client paths only** (`vi.mock('../../../../src/L2-clients/...')`).
- ❌ Cannot mock L0, L1, or L3+ paths — those are real dependencies.
- Use `vi.hoisted()` for mock variables referenced inside `vi.mock()` factories.

## What to Test

- Transcription service — audio extraction, chunk logic, result merging
- Cost tracking — accumulation, formatting, per-agent breakdown
- Video operations — silence detection, edit planning, clip extraction
- Caption generation service — format conversion, timing adjustment
- Scheduler — queue building, post scheduling logic

## Pattern

Mock L2 clients to return controlled data, then verify L3 business logic.

```typescript
import { vi, describe, test, expect } from 'vitest'

const mockWhisperTranscribe = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/L2-clients/whisper/whisperClient.js', () => ({
  transcribe: mockWhisperTranscribe,
}))

import { transcribeVideo } from '../../../../src/L3-services/transcription/transcription.js'

describe('transcribeVideo', () => {
  test('merges chunked transcription results', async () => {
    mockWhisperTranscribe
      .mockResolvedValueOnce({ text: 'Hello', segments: [seg1] })
      .mockResolvedValueOnce({ text: 'World', segments: [seg2] })
    const result = await transcribeVideo('/tmp/audio.mp3', { chunks: 2 })
    expect(result.text).toBe('Hello World')
    expect(result.segments).toHaveLength(2)
  })
})
```

## Checklist

- [ ] Every `vi.mock()` path contains `/L2-clients/` — nothing else
- [ ] L0 pure functions are called directly (not mocked)
- [ ] L1 infra (logger, config) runs as-is (logger auto-mocked by setup.ts)

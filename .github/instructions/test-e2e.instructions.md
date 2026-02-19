---
applyTo: "src/__tests__/e2e/**/*.ts"
---

# E2E Tests — Real External Processes, No Mocks

## Purpose

End-to-end tests with real FFmpeg operations, real file I/O, real caption burning, and real clip extraction. No mocking allowed.

## Mocking Rules

❌ **NO `vi.mock()` allowed.** Everything runs real — real FFmpeg, real file system, real config.

## Pattern

Use `describe.skipIf()` to skip when external dependencies are unavailable. Create temp directories for artifacts and clean up after.

```typescript
import { setupFixtures, cleanupFixtures, isFFmpegAvailable } from './fixture.js'

const ffmpegOk = await isFFmpegAvailable()

describe.skipIf(!ffmpegOk)('FFmpeg pipeline', () => {
  let fixtures: Awaited<ReturnType<typeof setupFixtures>>

  beforeAll(async () => { fixtures = await setupFixtures() })
  afterAll(async () => { await cleanupFixtures(fixtures) })

  test('burns captions onto video', async () => {
    // ... test with real FFmpeg
  })
})
```

## What to Test

- Real FFmpeg operations produce valid output files
- File I/O reads/writes correct formats (JSON, SRT, VTT, ASS)
- Caption burning produces video with embedded subtitles
- Clip extraction outputs correct duration and format
- Pipeline stages produce expected file artifacts

## Rules

- Always gate on `isFFmpegAvailable()` with `describe.skipIf`
- Use the shared `fixture.ts` helper for test video generation
- Create temp directories via `mkdtemp` — never write to source tree
- Clean up all temp files/directories in `afterAll`
- Verify actual file output: size > 0, correct format, correct duration
- Use generous timeouts — FFmpeg operations can take 10–30 seconds
- Set test timeout with `test('name', async () => { ... }, 30_000)`
- Never hardcode absolute paths — resolve relative to temp directory

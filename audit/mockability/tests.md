# Mockability Audit: Existing Test Patterns

> `src/__tests__/` — Unit tests, integration tests, and mocking conventions.

## Test File Inventory

| File | What it tests | Mocking approach |
|------|--------------|-----------------|
| `pipeline.test.ts` | `runStage()`, `processVideo()` | Heavy `vi.hoisted()` + `vi.mock()` for all 15+ deps |
| `captionGenerator.test.ts` | Caption text generation | **No mocks** — pure function testing |
| `costTracker.test.ts` | Cost tracking singleton | **No mocks** — uses `reset()` between tests |
| `agents.test.ts` | Agent tool registration | Mocks Copilot SDK, captures tool schemas |
| `silenceRemoval.test.ts` | `adjustTranscript()` | **No mocks** — pure function testing |
| `ffmpegTools.test.ts` | FFmpeg tool functions | Mocks `core/process.js`, `core/fileSystem.js`, fluent-ffmpeg |
| `providers.test.ts` | Pricing, PRU calc, provider factory | Minimal mocks (only `initConfig`) |
| `faceDetection.test.ts` | Webcam detection | Mocks FFmpeg, Sharp, ONNX |
| `lateApi.test.ts` | Late API client | Mocks `fetch` globally |
| `postStore.test.ts` | Queue item CRUD | Mocks `core/fileSystem.js` |
| `environment.test.ts` | Config initialization | Direct `initConfig()` calls |
| `logger.test.ts` | Logger formatting | Direct import, tests sanitization |
| `modelConfig.test.ts` | Model selection logic | Minimal env var setup |

## Pattern 1: `vi.hoisted()` + `vi.mock()` (Most Common)

Used in ~90% of test files that require mocking:

```typescript
// Step 1: Hoist mock variables (required for ESM vi.mock factories)
const { mockExecFile, mockMkdir, ... } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockMkdir: vi.fn().mockResolvedValue(undefined),
  // ... 15-20 more mock functions
}))

// Step 2: Module-level vi.mock() with factory returning hoisted mocks
vi.mock('../core/process.js', () => ({
  execFileRaw: mockExecFile,
}))
vi.mock('../core/fileSystem.js', () => ({
  ensureDirectory: mockMkdir,
  writeTextFile: mockWriteFile,
  // ... 8-10 more functions
}))

// Step 3: Reset in beforeEach
beforeEach(() => {
  vi.clearAllMocks()
})
```

### Observations

- **Verbose but correct** — ESM modules require `vi.hoisted()` for mock variables used in `vi.mock()` factories.
- **pipeline.test.ts is the extreme case** — 60+ lines of mock setup for 34 mock functions.
- **Mock drift risk** — if a source function signature changes, the mock factory won't type-check it.
- **No type safety on mocks** — mock factories return plain objects, not typed implementations.

## Pattern 2: No Mocks (Pure Functions)

Used for `captionGenerator.test.ts`, `silenceRemoval.test.ts`, `providers.test.ts` (pricing):

```typescript
// captionGenerator.test.ts — zero mocks
import { generateSRT, generateVTT, generateStyledASS } from '../tools/captions/captionGenerator.js'

it('generates valid SRT', () => {
  const srt = generateSRT(basicTranscript)
  expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,500')
})
```

**Best testing pattern in the codebase.** No mocking boilerplate, fast execution, high confidence.

## Pattern 3: Real Singleton with Reset

Used for `costTracker.test.ts`:

```typescript
import { costTracker } from '../services/costTracker.js'

beforeEach(() => {
  costTracker.reset()  // built-in reset method
})

it('records service usage', () => {
  costTracker.setStage('transcription')
  costTracker.recordServiceUsage('whisper', 0.0252)
  expect(costTracker.getReport().totalServiceCostUSD).toBe(0.0252)
})
```

Clean and reliable — the singleton is used as-is because it has no external I/O.

## Pattern 4: Agent Tool Capture

Used in `agents.test.ts`:

```typescript
// Mock the Copilot SDK to capture registered tools
const mockState = vi.hoisted(() => ({
  capturedTools: [] as any[],
  mockSession: {
    sendAndWait: async () => ({ data: { content: '' } }),
    on: () => {},
    destroy: async () => {},
  },
}))

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: function() {
    return {
      createSession: async (opts) => {
        mockState.capturedTools.push(...(opts.tools || []))
        return mockState.mockSession
      },
    }
  },
}))
```

Tests verify tool schemas are registered correctly but don't execute tool handlers.

## Pattern 5: Integration Tests with `describe.skipIf`

Used in `src/__tests__/integration/`:

```typescript
const ffmpegOk = await isFFmpegAvailable()

describe.skipIf(!ffmpegOk)('Test Fixtures', () => {
  let fix: TestFixtures
  beforeAll(async () => { fix = await setupFixtures() }, 30000)
  afterAll(async () => { await cleanupFixtures() })
  // ... tests use real FFmpeg
})
```

Properly gated — tests skip gracefully when FFmpeg isn't installed. Shared `fixture.ts` generates test assets.

## Universal Logger Mock

Every test file that imports anything using logger includes:

```typescript
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  pushPipe: vi.fn(),
  popPipe: vi.fn(),
}))
```

This appears in 15+ test files. A shared setup file could eliminate this repetition.

## Key Findings

1. **~90% of tests use module-level `vi.mock()`** with `vi.hoisted()` variables. This is the correct ESM pattern but creates verbose boilerplate (10-60 lines per test file).

2. **Pure function tests are the best tests** — `captionGenerator.test.ts` and `silenceRemoval.test.ts` have zero mocks, fast execution, and high reliability. More pipeline logic should be extracted into pure functions.

3. **Mock drift is a real risk.** Mock factories don't type-check against source modules. If `core/fileSystem.js` adds a required parameter to `writeTextFile()`, mock factories won't catch it at compile time.

4. **FFmpeg mock patterns are well-established** but complex. `ffmpegTools.test.ts` mocks `core/process.js` and `core/fileSystem.js` with 20+ functions. The fluent-ffmpeg chainable mock is particularly verbose.

5. **Integration tests are properly gated** with `describe.skipIf()` for FFmpeg dependency. They use real fixtures (`fixture.ts`) and real FFmpeg execution.

6. **costTracker's `reset()` pattern** avoids mocking entirely — a model for other singletons.

## Mockability Scorecard (Test Infrastructure)

| Pattern | Prevalence | Quality |
|---------|-----------|---------|
| Pure function tests | ~15% | 10/10 — gold standard |
| Singleton with reset | ~5% | 9/10 — clean, no mock drift |
| vi.hoisted + vi.mock | ~70% | 6/10 — correct but verbose, mock drift risk |
| Agent tool capture | ~5% | 7/10 — tests schemas, not behavior |
| Integration with skipIf | ~5% | 8/10 — properly gated |

## Recommendations

1. **Centralize logger mock** in a Vitest setup file to eliminate 15+ duplicate mock blocks.
2. **Add type-safe mock helpers** — factory functions that produce correctly typed mocks from module exports, reducing drift risk.
3. **Extract more pure functions** from impure modules — every pure function extracted is a test that needs zero mocking.
4. **Add `reset()` methods** to `brand.ts` and other cached singletons, following costTracker's pattern.
5. **Consider a `createMockProvider()` helper** that returns a typed `LLMProvider` test double with configurable responses, reducing agent test boilerplate.

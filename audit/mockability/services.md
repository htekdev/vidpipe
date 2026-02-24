# Mockability Audit: Services Layer

> `src/services/` and `src/core/` — Singletons, file I/O, HTTP clients, process execution.

## Services (`src/services/`)

### costTracker.ts

```typescript
class CostTracker {
  private records: UsageRecord[] = []
  private serviceRecords: ServiceUsageRecord[] = []
  private currentAgent = 'unknown'
  private currentStage = 'unknown'
  // ...
}
export const costTracker = new CostTracker()  // module-level singleton
```

| Aspect | Detail |
|--------|--------|
| Pattern | Class with module-level singleton export |
| State | Mutable — accumulates records across pipeline |
| External I/O | None — pure in-memory tracking |
| Reset | `costTracker.reset()` clears all state |
| Consumers | BaseAgent (via direct import), pipeline.ts |
| Mockability | **7/10** — No I/O, but singleton import requires `vi.mock()` or `reset()` in tests |

The existing test (`costTracker.test.ts`) uses the real singleton with `reset()` in `beforeEach` — no mocking needed. This is a good pattern because costTracker has no external dependencies.

### postStore.ts

| Aspect | Detail |
|--------|--------|
| Pattern | Exported async functions (no class) |
| State | Stateless — all state lives on disk |
| External I/O | Heavy file I/O via `core/fileSystem.js` |
| Dependencies | `getConfig()`, `logger`, `core/fileSystem.js`, `core/paths.js` |
| Mockability | **5/10** — Every function reads/writes files; must mock `fileSystem.js` |

Key functions: `getPendingItems()`, `createItem()`, `updateItem()`, `approveItem()`, `rejectItem()`. All delegate to `readTextFile`, `writeTextFile`, `writeJsonFile`, `ensureDirectory`, `fileExists`, `renameFile`, etc.

### lateApi.ts

| Aspect | Detail |
|--------|--------|
| Pattern | Exported async functions wrapping HTTP calls |
| External I/O | HTTP to `https://api.getlate.dev/` via fetch |
| Auth | `getConfig().LATE_API_KEY` header |
| Dependencies | `getConfig()`, `logger`, `core/fileSystem.js` (for media upload) |
| Mockability | **4/10** — Direct fetch calls with no HTTP client injection |

Functions: `getAccounts()`, `getScheduledPosts()`, `createPost()`, `deletePost()`, `uploadMedia()`. Each constructs fetch calls internally — must mock `fetch` globally or mock the module.

### transcription.ts

| Aspect | Detail |
|--------|--------|
| Pattern | Single exported function `transcribeVideo()` |
| External I/O | FFmpeg (audio extraction), OpenAI Whisper API (transcription), file I/O |
| Dependencies | `extractAudio()`, `splitAudioIntoChunks()`, `transcribeAudio()`, `getConfig()`, `core/fileSystem.js` |
| Mockability | **4/10** — Orchestrates multiple I/O-heavy operations |

### Other Services

| Service | Pattern | I/O | Mockability |
|---------|---------|-----|-------------|
| captionGeneration.ts | Function | File I/O (write SRT/VTT/ASS) | 6/10 |
| fileWatcher.ts | Chokidar wrapper | FS watch events | 3/10 |
| gitOperations.ts | Functions | `execCommandSync` (git) | 5/10 |
| queueBuilder.ts | Function | File I/O (copy + metadata) | 5/10 |
| scheduleConfig.ts | Functions | JSON file read | 7/10 |
| processingState.ts | Functions | JSON file read/write | 6/10 |
| socialPosting.ts | Functions | HTTP (Late API) + file I/O | 4/10 |
| accountMapping.ts | Functions | Config + Late API | 5/10 |

## Core Modules (`src/core/`)

### fileSystem.ts

```typescript
// ~30 exported functions wrapping Node.js fs/promises
export async function readJsonFile<T>(filePath: string, defaultValue?: T): Promise<T> { ... }
export async function writeTextFile(filePath: string, content: string): Promise<void> { ... }
export async function ensureDirectory(dirPath: string): Promise<void> { ... }
```

| Aspect | Detail |
|--------|--------|
| Pattern | Exported functions (no class, no singleton) |
| State | Stateless — pure wrappers around `fs.promises` |
| Mockability | **6/10** — Must use `vi.mock('../core/fileSystem.js')` but predictable API surface |

Most heavily mocked module in the test suite. Every test that touches file I/O mocks this.

### process.ts

```typescript
export function execCommand(cmd, args, opts): Promise<ExecResult> { ... }
export function execFileRaw(cmd, args, opts, callback): void { ... }
```

| Aspect | Detail |
|--------|--------|
| Pattern | Exported functions wrapping `child_process` |
| State | Stateless |
| Mockability | **6/10** — Clean API, but callback-based `execFileRaw` is slightly harder to mock |

### ffmpeg.ts (core)

```typescript
export function getFFmpegPath(): string { ... }  // reads config, requires() ffmpeg-static
export function ffprobe(filePath: string): Promise<FfprobeData> { ... }
export function createFFmpeg(input?: string): FfmpegCommand { ... }
```

| Aspect | Detail |
|--------|--------|
| Pattern | Exported functions + fluent-ffmpeg wrapper |
| Side effects | `createRequire()` at module level, path resolution |
| Mockability | **5/10** — fluent-ffmpeg chainable API is verbose to mock |

### logger.ts (core)

```typescript
const logger = winston.createLogger({ ... })
export default logger
```

| Aspect | Detail |
|--------|--------|
| Pattern | Module-level singleton (created on import) |
| Side effects | Winston transport initialization on import |
| Mockability | **4/10** — Must mock at module level; created eagerly |

Every test file mocks logger: `vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), ... } }))`

## Key Findings

1. **Services are function-based modules, not classes with interfaces.** There's no `IPostStore` or `ITranscriptionService` to implement a test double against. The only path is `vi.mock()`.

2. **costTracker is the exception** — it's a class singleton with a `reset()` method, so tests can use the real instance without mocking. Good pattern.

3. **File I/O flows through `core/fileSystem.ts`**, which serves as a natural mock boundary. Mocking this single module covers most service-level I/O.

4. **HTTP calls (lateApi, socialPosting) use raw `fetch`** with no HTTP client abstraction. Must mock `fetch` globally or mock the entire module.

5. **Logger is universally mocked** — every test file includes `vi.mock('../config/logger.js')`. This is boilerplate that could be centralized in a test setup file.

## Mockability Scorecard

| Module | Score | Reason |
|--------|-------|--------|
| costTracker.ts | 7/10 | No I/O, reset() method, testable as-is |
| scheduleConfig.ts | 7/10 | Simple JSON read |
| processingState.ts | 6/10 | File I/O via fileSystem.ts |
| captionGeneration.ts | 6/10 | File writes only |
| core/fileSystem.ts | 6/10 | Clean API, heavily mocked already |
| core/process.ts | 6/10 | Clean wrappers |
| postStore.ts | 5/10 | Heavy file I/O |
| core/ffmpeg.ts | 5/10 | fluent-ffmpeg chain mocking |
| gitOperations.ts | 5/10 | Shell commands |
| queueBuilder.ts | 5/10 | File copy + metadata |
| lateApi.ts | 4/10 | Raw fetch, no client injection |
| transcription.ts | 4/10 | Multi-step I/O orchestration |
| core/logger.ts | 4/10 | Eager singleton, universally mocked |
| fileWatcher.ts | 3/10 | Chokidar event stream |

## Recommendation

Consider extracting an HTTP client wrapper for Late API calls (similar to how `core/fileSystem.ts` wraps `fs`). This would create a single mock point for all HTTP I/O. For logger, create a shared test setup that auto-mocks it to eliminate per-file boilerplate.

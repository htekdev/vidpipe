# Mockability Architecture Audit — Synthesis

> Central analysis of how testable each layer of the vidpipe codebase is,
> where the mock boundaries live, and what patterns already work well.

---

## 1. Architecture Hierarchy Diagram

```
CLI Entry (src/index.ts)
  └── Pipeline Orchestrator (src/pipeline.ts)
       │
       ├── Agents (src/agents/*)
       │    ├── BaseAgent ← LLMProvider (constructor-injected)
       │    ├── ShortsAgent, MediumVideoAgent, SummaryAgent, BlogAgent, …
       │    └── ProducerAgent (extends BaseAgent + uses tools)
       │         └── LLM Providers (src/providers/*)
       │              ├── CopilotProvider  ── @github/copilot-sdk
       │              ├── OpenAIProvider   ── openai SDK
       │              └── ClaudeProvider   ── @anthropic-ai/sdk
       │
       ├── Stages (src/stages/*)
       │    └── visualEnhancement.ts → Gemini + GraphicsAgent + FFmpeg
       │
       ├── Tools (src/tools/*)
       │    ├── FFmpeg Operations (src/tools/ffmpeg/*)
       │    │    ├── silenceDetection    ── fluent-ffmpeg
       │    │    ├── singlePassEdit      ── execFileRaw (pure buildFilterComplex)
       │    │    ├── captionBurning      ── execFileRaw + temp dirs
       │    │    ├── clipExtraction      ── execFileRaw + ffprobe
       │    │    ├── aspectRatio         ── execFileRaw + face detection
       │    │    ├── audioExtraction     ── fluent-ffmpeg
       │    │    ├── frameCapture        ── fluent-ffmpeg
       │    │    ├── faceDetection       ── ONNX + sharp + ffmpeg
       │    │    └── overlayCompositing  ── execFileRaw
       │    ├── Gemini Client (src/tools/gemini/geminiClient.ts)
       │    │    └── @google/genai SDK
       │    ├── Whisper Client (src/tools/whisper/whisperClient.ts)
       │    │    └── openai SDK (audio transcription)
       │    ├── Caption Generator (src/tools/captions/captionGenerator.ts)
       │    │    └── Pure functions — no I/O
       │    ├── Image Generation (src/tools/imageGeneration.ts)
       │    │    └── OpenAI DALL-E API + sharp
       │    └── Agent Tools (src/tools/agentTools.ts)
       │         └── ffprobe + fs + DALL-E
       │
       ├── Services (src/services/*)
       │    ├── transcription       ── Whisper client + FFmpeg audio extraction
       │    ├── captionGeneration    ── captionGenerator (pure) + fs writes
       │    ├── costTracker          ── singleton, in-memory accumulator
       │    ├── postStore            ── fs-backed queue (JSON + files)
       │    ├── processingState      ── fs-backed state machine (JSON)
       │    ├── queueBuilder         ── postStore + platformContentStrategy
       │    ├── fileWatcher          ── chokidar (EventEmitter)
       │    ├── gitOperations        ── execCommandSync (shell)
       │    ├── lateApi              ── HTTP client (Late.co API)
       │    ├── scheduler            ── lateApi + scheduleConfig + postStore
       │    ├── scheduleConfig       ── fs read/write (schedule.json)
       │    ├── accountMapping       ── lateApi + fs cache
       │    ├── socialPosting        ── placeholder client (interface-ready)
       │    └── platformContentStrategy ── pure data lookup, no I/O
       │
       └── Config (src/config/*)
            ├── environment.ts   ── getConfig() singleton, reads process.env
            ├── logger.ts        ── re-exports from core/logger.ts
            ├── pricing.ts       ── pure functions + const data
            ├── modelConfig.ts   ── reads process.env + const map
            ├── brand.ts         ── cached JSON read (getBrandConfig singleton)
            └── ffmpegResolver.ts ── re-exports from core/ffmpeg.ts
                 └── Core (src/core/*)
                      ├── fileSystem.ts  ── thin wrappers around Node fs
                      ├── ffmpeg.ts      ── path resolution + fluent-ffmpeg factory
                      ├── logger.ts      ── Winston singleton
                      ├── process.ts     ── execFile / execCommand wrappers
                      ├── paths.ts       ── path helpers (projectRoot, fontsDir, etc.)
                      ├── ai.ts          ── OpenAI client re-export
                      ├── media.ts       ── sharp + onnxruntime re-exports
                      ├── network.ts     ── Readable/fetch re-exports
                      ├── env.ts         ── dotenv loader
                      ├── cli.ts         ── Commander re-export
                      ├── text.ts        ── text helpers
                      └── watcher.ts     ── chokidar re-export
```

---

## 2. Mockability Tier System

### Tier 1 — Pure Functions (Score 9–10)

No mocking needed. These take inputs and return outputs with zero side effects.

| Module | Score | Notes |
|--------|-------|-------|
| `tools/captions/captionGenerator.ts` | **9/10** | Generates SRT/VTT/ASS strings from Transcript. Only import is types. Tests call directly. |
| `config/pricing.ts` | **10/10** | `calculateTokenCost()`, `calculatePRUCost()`, `getModelPricing()` — pure math on const data. |
| `pipeline.ts → adjustTranscript()` | **10/10** | Pure timestamp remapping. Tested directly without any mocks. |
| `tools/ffmpeg/singlePassEdit.ts → buildFilterComplex()` | **10/10** | Pure string builder for FFmpeg filter graphs. Exported and tested in isolation. |
| `tools/ffmpeg/overlayCompositing.ts → getOverlayPosition()` | **10/10** | Pure expression builder. No I/O. |
| `services/platformContentStrategy.ts` | **9/10** | Pure data lookup (`getMediaRule`, `platformAcceptsMedia`). Only imports types. |

### Tier 2 — Interface-Injectable (Score 7–8)

Mock via constructor injection; the code explicitly accepts abstractions.

| Module | Score | Notes |
|--------|-------|-------|
| `agents/BaseAgent.ts` | **7/10** | Accepts `LLMProvider` via constructor (`provider ?? getProvider()`). Tests can inject a mock provider. Tool handlers are subclass methods — side-effectful, but isolated per agent. |
| `providers/CopilotProvider.ts` | **7/10** | Implements `LLMProvider` interface. Sessions are created per-call, testable with mock SDK. |
| `providers/OpenAIProvider.ts` | **7/10** | Same `LLMProvider` contract. Wraps OpenAI SDK — `vi.mock('openai')` at module level. |
| `providers/ClaudeProvider.ts` | **7/10** | Same pattern. `vi.mock('@anthropic-ai/sdk')`. |
| `services/socialPosting.ts` | **8/10** | Defines `SocialPlatformClient` interface with `post()` and `validate()`. `PlaceholderPlatformClient` is a test-friendly no-op. |

### Tier 3 — Module-Mockable (Score 4–6)

Requires `vi.mock()` at module level. Functions read config, call external processes, or hit APIs, but can be fully mocked with Vitest's ESM mock system.

| Module | Score | Notes |
|--------|-------|-------|
| `pipeline.ts → processVideo()` | **5/10** | Orchestrates 15 stages. Tests use `vi.hoisted()` + `vi.mock()` for every imported agent/service/tool. Heavy mock setup (~30 mock variables) but fully tested. |
| `services/transcription.ts` | **5/10** | Calls Whisper client + FFmpeg audio extraction + fs writes. All mockable via module boundaries. |
| `services/captionGeneration.ts` | **6/10** | Thin wrapper — calls pure captionGenerator functions + `writeTextFile`. Easy to mock at fs level. |
| `services/costTracker.ts` | **5/10** | Singleton class exported as `const costTracker = new CostTracker()`. Tests call `.reset()` before each test — works, but shared mutable state requires discipline. |
| `services/postStore.ts` | **5/10** | All functions use `getConfig()` for queue dir + `core/fileSystem` for reads/writes. Tested via fs mocks. |
| `services/processingState.ts` | **5/10** | Same pattern — `getConfig()` + `core/fileSystem`. State file path derived at call time. |
| `services/queueBuilder.ts` | **5/10** | Depends on `postStore`, `platformContentStrategy`, `core/fileSystem`, `types`. |
| `services/gitOperations.ts` | **4/10** | Uses `execCommandSync` (shell exec). Must mock `core/process.js`. |
| `services/lateApi.ts` | **5/10** | HTTP client class. Constructor reads `getConfig()`. API calls go through fetch. Mock `core/network.js` or `getConfig`. |
| `services/scheduler.ts` | **5/10** | Composes `lateApi` + `scheduleConfig` + `postStore`. Three service mocks needed. |
| `services/scheduleConfig.ts` | **6/10** | Reads/writes `schedule.json` via `core/fileSystem`. Pure validation logic + fs I/O. |
| `services/accountMapping.ts` | **5/10** | Late API client + fs cache file. Needs module mocks for both. |
| `services/fileWatcher.ts` | **4/10** | Constructor calls `getConfig()` and `fileExistsSync()`. Extends `EventEmitter`. Chokidar dependency. |
| `tools/ffmpeg/silenceDetection.ts` | **5/10** | Uses `createFFmpeg()` from core. Mock `core/ffmpeg.js`. |
| `tools/ffmpeg/captionBurning.ts` | **5/10** | `execFileRaw` + temp dir + fs operations. Tests mock `core/process.js` + `core/fileSystem.js`. |
| `tools/ffmpeg/singlePassEdit.ts` | **5/10** | Pure `buildFilterComplex` + impure `singlePassEditAndCaption` (execFileRaw). Split already helps. |
| `tools/ffmpeg/clipExtraction.ts` | **5/10** | `execFileRaw` + `ffprobe`. Standard module mock. |
| `tools/ffmpeg/aspectRatio.ts` | **5/10** | `execFileRaw` + face detection integration. |
| `tools/ffmpeg/audioExtraction.ts` | **5/10** | `createFFmpeg()` fluent API. |
| `tools/ffmpeg/frameCapture.ts` | **5/10** | `createFFmpeg()` fluent API. |
| `tools/ffmpeg/overlayCompositing.ts` | **6/10** | Mix of pure `getOverlayPosition` (Tier 1) and impure `compositeOverlays` (execFileRaw). |
| `tools/gemini/geminiClient.ts` | **5/10** | Creates `GoogleGenAI` client from config. API calls + cost tracking. Mock `@google/genai` + `getConfig`. |
| `tools/whisper/whisperClient.ts` | **5/10** | Creates `OpenAI` client from config. File existence checks + API call. Mock `core/ai.js` + `core/fileSystem.js`. |
| `tools/imageGeneration.ts` | **5/10** | OpenAI DALL-E API + `sharp` for image processing + cost tracking. |
| `tools/agentTools.ts` | **5/10** | Utility functions wrapping ffprobe, fs reads, DALL-E. |
| `stages/visualEnhancement.ts` | **5/10** | Composes Gemini + GraphicsAgent + FFmpeg overlay. Three module mocks. |
| All Agent subclasses | **5/10** | Each extends BaseAgent (Tier 2) but tool handlers call Tier 3 tools/services. Mock via `vi.mock()` on dependencies. |

### Tier 4 — Hard to Mock (Score 1–3)

Singleton side effects, cached state, or import-time execution that makes testing difficult.

| Module | Score | Notes |
|--------|-------|-------|
| `config/environment.ts` | **3/10** | **Import side effect**: lines 6–9 run `loadEnvFile()` at import time, mutating `process.env`. `getConfig()` returns a cached singleton (`let config`). Tests must call `initConfig()` to override, and env var stubs via `vi.stubEnv()` are fragile. |
| `config/brand.ts` | **3/10** | `getBrandConfig()` caches in `let cachedBrand`. Reads from fs on first call. No `resetBrandConfig()` exposed — tests must mock the entire module. |
| `core/logger.ts` | **3/10** | Winston logger created at import time (`winston.createLogger()`). Global singleton. Every module imports it. Tests mock it per-file with `vi.mock('../config/logger.js')`. |
| `core/ffmpeg.ts` | **3/10** | `getFFmpegPath()` and `getFFprobePath()` call `getConfig()` + `require('ffmpeg-static')` + `existsSync()` at call time. Some tools call them at **module top level** (e.g. `const ffmpegPath = getFFmpegPath()` in captionBurning.ts, clipExtraction.ts, singlePassEdit.ts), making those modules hard to test without module mocks. |
| `tools/ffmpeg/faceDetection.ts` | **2/10** | `let cachedSession: ort.InferenceSession | null` — ONNX runtime session cached globally. Model file must exist at `modelsDir()/ultraface-320.onnx`. Sharp + ONNX + FFmpeg all needed. |
| `providers/index.ts` | **3/10** | `getProvider()` caches in `let currentProvider` (singleton). Has `resetProvider()` for testing (good), but factory calls `getConfig().LLM_PROVIDER` + `logger.warn/info` (side effects in factory). |
| `config/modelConfig.ts` | **3/10** | `getModelForAgent()` reads `process.env` directly (dynamic key `MODEL_${name}`) and falls through to `getConfig().LLM_MODEL`. Hard to isolate without env stubs. |
| `src/index.ts` (CLI entry) | **1/10** | Reads `package.json` synchronously at import. Constructs Commander program. Calls `initConfig()`, `validateRequiredKeys()`, starts watcher. Not unit-testable — integration/smoke test only. |

---

## 3. Dependency Flow Analysis

### CLI Entry (`src/index.ts`)
- **Depends on**: Commander, `config/environment`, `config/logger`, `services/fileWatcher`, `pipeline`, `services/processingState`, `core/fileSystem`, `core/paths`
- **Consumed by**: Node.js process entry point
- **Mock boundary**: Not testable in isolation. Smoke tests validate CLI flags via subprocess.

### Pipeline (`src/pipeline.ts`)
- **Depends on**: All agents (Summary, Shorts, MediumVideo, Social, Blog, Chapter, Producer), all services (transcription, captionGeneration, costTracker, gitOperations, queueBuilder, processingState), tools (captionBurning, singlePassEdit), stages (visualEnhancement), config (environment, logger, modelConfig), core (fileSystem, paths)
- **Consumed by**: `src/index.ts`, `processVideoSafe()`
- **Mock boundary**: `vi.mock()` on every imported module. Tests use ~30 hoisted mock variables. `runStage()` and `adjustTranscript()` are independently testable.

### Agents (`src/agents/*`)
- **Depends on**: `BaseAgent` → `LLMProvider` (constructor), `providers/index` (default), `config/modelConfig`, `services/costTracker`, `config/logger`
- **Consumed by**: Pipeline stages, each other (SocialMediaAgent used for shorts + medium clips)
- **Mock boundary**: **LLMProvider interface** — inject mock provider via constructor. Tool handlers are the impure seam (they call tools/services).

### LLM Providers (`src/providers/*`)
- **Depends on**: Respective SDK (`@github/copilot-sdk`, `openai`, `@anthropic-ai/sdk`), `config/environment`, `config/logger`
- **Consumed by**: `providers/index.ts` factory, `BaseAgent` constructor
- **Mock boundary**: Mock the SDK module, or inject a custom `LLMProvider` implementation.

### Tools (`src/tools/*`)
- **Depends on**: `core/process` (execFile), `core/ffmpeg` (path resolution), `core/fileSystem`, `config/logger`, `services/costTracker` (Gemini/Whisper), `config/environment` (API keys)
- **Consumed by**: Agents (via tool handlers), services (transcription, captionGeneration), stages
- **Mock boundary**: `vi.mock('../../core/process.js')` for FFmpeg tools. `vi.mock('@google/genai')` for Gemini. `vi.mock('../../core/ai.js')` for Whisper.

### Services (`src/services/*`)
- **Depends on**: `config/environment`, `config/logger`, `core/fileSystem`, `core/paths`, tools (whisper, ffmpeg), external APIs (Late.co)
- **Consumed by**: Pipeline, agents, CLI commands, each other (scheduler → lateApi + postStore)
- **Mock boundary**: `vi.mock()` on `core/fileSystem.js` and `core/process.js` covers most I/O. Service-to-service deps need individual mocks.

### Config (`src/config/*`)
- **Depends on**: `core/fileSystem` (brand.ts), `core/env` (environment.ts), `process.env`
- **Consumed by**: Everything — every module in the project imports config
- **Mock boundary**: `vi.mock('../config/environment.js')` is the most common mock across tests. `initConfig()` allows test overrides. `vi.stubEnv()` for env vars.

### Core (`src/core/*`)
- **Depends on**: Node.js builtins (`fs`, `path`, `child_process`), third-party libs (`winston`, `fluent-ffmpeg`, `sharp`, `onnxruntime-node`, `chokidar`, `tmp`)
- **Consumed by**: Everything above
- **Mock boundary**: Leaf-level mocks. Tests mock `core/fileSystem.js`, `core/process.js`, `core/ffmpeg.js` to control all I/O.

---

## 4. Key Mockability Boundaries

### Boundary 1: `LLMProvider` Interface (Tier 2)

The cleanest seam in the architecture. `BaseAgent` accepts an optional `LLMProvider` via its constructor:

```typescript
constructor(
  protected readonly agentName: string,
  protected readonly systemPrompt: string,
  provider?: LLMProvider,  // ← inject mock here
  model?: string,
)
```

Tests can inject a mock provider that returns canned `LLMResponse` objects without hitting any API. The `LLMSession` interface (`sendAndWait`, `on`, `close`) is small and easy to stub.

**Current gap**: Agent tests in `agents.test.ts` mock `@github/copilot-sdk` at module level instead of injecting a mock `LLMProvider`. This misses the DI seam that already exists.

### Boundary 2: `vi.mock()` Module Boundary (Tier 3)

The dominant testing pattern. Vitest ESM mocks using `vi.hoisted()` + `vi.mock()`:

```typescript
const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }))
vi.mock('../core/process.js', () => ({ execFileRaw: mockExecFile }))
```

Used for: all FFmpeg tools, Whisper/Gemini clients, fs operations, config, logger, services.

**What works well**: The `core/` layer provides thin wrappers around Node builtins, creating stable mock targets. Mocking `core/fileSystem.js` or `core/process.js` controls all file I/O and child processes in one place.

### Boundary 3: Pure Function Extraction (Tier 1)

Several modules already extract pure logic from impure wrappers:

| Module | Pure export | Impure export |
|--------|-------------|---------------|
| `singlePassEdit.ts` | `buildFilterComplex()` | `singlePassEditAndCaption()` |
| `overlayCompositing.ts` | `getOverlayPosition()` | `compositeOverlays()` |
| `captionGenerator.ts` | All exports (generateSRT, generateVTT, generateStyledASS, …) | None |
| `pricing.ts` | All exports | None |
| `platformContentStrategy.ts` | All exports | None |
| `pipeline.ts` | `adjustTranscript()` | `processVideo()` |

**Pattern to replicate**: Extract pure computation from I/O-heavy functions. The `buildFilterComplex` pattern is exemplary — pure string construction tested without mocking FFmpeg.

### Boundary 4: File System Abstraction (`src/core/fileSystem.ts`)

All file operations go through `core/fileSystem.ts`, which wraps Node's `fs` module:

- `readJsonFile`, `readTextFile`, `writeJsonFile`, `writeTextFile`
- `fileExists`, `ensureDirectory`, `copyFile`, `moveFile`, `removeFile`
- `makeTempDir`, `withTempDir`

This gives tests a single mock target for all file I/O. **One `vi.mock('../core/fileSystem.js')` controls 20+ functions**.

### Boundary 5: Process Execution (`src/core/process.ts`)

All child process execution goes through `core/process.ts`:

- `execFileRaw` — used by all FFmpeg tools, face detection
- `execCommandSync` — used by git operations
- `execCommand` — used by agent tools

Mocking this one module eliminates all subprocess side effects.

---

## 5. Consolidated Scorecard

| Module | Tier | Score | Key Blocker |
|--------|------|-------|-------------|
| `captionGenerator.ts` | 1 | 9/10 | None — pure functions, zero I/O |
| `pricing.ts` | 1 | 10/10 | None — pure math on const data |
| `adjustTranscript()` | 1 | 10/10 | None — pure timestamp remapping |
| `buildFilterComplex()` | 1 | 10/10 | None — pure string builder |
| `getOverlayPosition()` | 1 | 10/10 | None — pure expression builder |
| `platformContentStrategy.ts` | 1 | 9/10 | None — pure data lookup |
| `BaseAgent` | 2 | 7/10 | Tool handler side effects; `getProvider()` fallback in constructor |
| `CopilotProvider` | 2 | 7/10 | SDK dependency; `vi.mock('@github/copilot-sdk')` |
| `OpenAIProvider` | 2 | 7/10 | SDK dependency; `vi.mock('openai')` |
| `ClaudeProvider` | 2 | 7/10 | SDK dependency; `vi.mock('@anthropic-ai/sdk')` |
| `socialPosting.ts` | 2 | 8/10 | Already has interface + placeholder impl |
| `processVideo()` | 3 | 5/10 | 30+ mock variables for full pipeline test |
| `transcription.ts` | 3 | 5/10 | Whisper client + FFmpeg + fs writes |
| `captionGeneration.ts` | 3 | 6/10 | Thin wrapper; pure core + fs write |
| `costTracker.ts` | 3 | 5/10 | Mutable singleton; `.reset()` helps but shared state |
| `postStore.ts` | 3 | 5/10 | fs-backed; `getConfig()` for paths |
| `processingState.ts` | 3 | 5/10 | fs-backed JSON state machine |
| `queueBuilder.ts` | 3 | 5/10 | Composes postStore + platformContentStrategy |
| `gitOperations.ts` | 3 | 4/10 | Shell execution via `execCommandSync` |
| `lateApi.ts` | 3 | 5/10 | HTTP client; fetch + config |
| `scheduler.ts` | 3 | 5/10 | Composes lateApi + scheduleConfig + postStore |
| `scheduleConfig.ts` | 3 | 6/10 | Pure validation + fs I/O |
| `accountMapping.ts` | 3 | 5/10 | Late API + fs cache |
| `fileWatcher.ts` | 3 | 4/10 | Constructor side effects (getConfig, fs check) |
| `silenceDetection.ts` | 3 | 5/10 | fluent-ffmpeg wrapper |
| `captionBurning.ts` | 3 | 5/10 | execFileRaw + temp dirs |
| `singlePassEditAndCaption()` | 3 | 5/10 | execFileRaw (pure helper already extracted) |
| `clipExtraction.ts` | 3 | 5/10 | execFileRaw + ffprobe |
| `aspectRatio.ts` | 3 | 5/10 | execFileRaw + face detection |
| `audioExtraction.ts` | 3 | 5/10 | fluent-ffmpeg wrapper |
| `frameCapture.ts` | 3 | 5/10 | fluent-ffmpeg wrapper |
| `overlayCompositing.ts` | 3 | 6/10 | Mixed: pure position helper + impure composite |
| `geminiClient.ts` | 3 | 5/10 | @google/genai SDK + costTracker |
| `whisperClient.ts` | 3 | 5/10 | OpenAI SDK + fs checks + costTracker |
| `imageGeneration.ts` | 3 | 5/10 | OpenAI DALL-E + sharp + costTracker |
| `agentTools.ts` | 3 | 5/10 | ffprobe + fs + DALL-E |
| `visualEnhancement.ts` | 3 | 5/10 | Composes Gemini + GraphicsAgent + FFmpeg |
| Agent subclasses | 3 | 5/10 | BaseAgent is DI-ready but tool handlers are Tier 3 |
| `environment.ts` | 4 | 3/10 | Import-time side effect; cached singleton |
| `brand.ts` | 4 | 3/10 | Cached singleton; no reset function |
| `core/logger.ts` | 4 | 3/10 | Winston singleton created at import |
| `core/ffmpeg.ts` | 4 | 3/10 | `getConfig()` + `require()` at call time; consumers cache at module level |
| `faceDetection.ts` | 4 | 2/10 | ONNX cached session; model file required; sharp + ffmpeg |
| `providers/index.ts` | 4 | 3/10 | Cached singleton factory; `resetProvider()` helps |
| `modelConfig.ts` | 4 | 3/10 | Direct `process.env` reads + `getConfig()` |
| `src/index.ts` | 4 | 1/10 | Import-time sync fs read; Commander setup; not unit-testable |

---

## 6. Cross-Cutting Concerns

### Global Singletons

| Singleton | Location | Reset mechanism | Risk |
|-----------|----------|-----------------|------|
| `getConfig()` | `config/environment.ts` | `initConfig()` overwrites | Import-time `.env` loading mutates `process.env` before tests can intervene |
| `logger` | `core/logger.ts` | None (mock entire module) | Every module imports it; 30+ `vi.mock('../config/logger.js')` across test files |
| `costTracker` | `services/costTracker.ts` | `.reset()` method | Shared mutable state; `setAgent()`/`setStage()` are implicit context |
| `cachedBrand` | `config/brand.ts` | None exposed | First call caches forever; tests must mock the whole module |
| `currentProvider` | `providers/index.ts` | `resetProvider()` | Factory + cache; switching providers closes old one |
| `cachedSession` | `tools/ffmpeg/faceDetection.ts` | None exposed | ONNX session loaded once; heavy native dependency |

### File System Coupling

Nearly every layer reads or writes files:
- **Config**: `.env`, `brand.json`, `schedule.json`
- **Services**: `processing-state.json`, `publish-queue/*/metadata.json`, `.vidpipe-cache.json`
- **Tools**: Temp directories for FFmpeg operations, audio chunks, frame captures
- **Pipeline**: `transcript.json`, `producer-plan.json`, `clip-direction.md`, `cost-report.md`
- **Agents**: Social posts, blog posts, README — all written to disk

**Mitigation**: All file ops go through `core/fileSystem.ts`, providing a single mock point.

### External Process Dependency

FFmpeg is required by 9 tool modules. All use either:
- `fluent-ffmpeg` (silenceDetection, audioExtraction, frameCapture) — mock `core/ffmpeg.ts`
- `execFileRaw` (captionBurning, singlePassEdit, clipExtraction, aspectRatio, overlayCompositing, faceDetection) — mock `core/process.ts`

**Top-level caching problem**: Several modules resolve FFmpeg paths at the **module top level**:
```typescript
const ffmpegPath = getFFmpegPath()  // executed at import time
```
This means `getConfig()` runs before test setup, potentially reading real env vars.

### API Client Creation

| Client | Created | Config source | Mockability |
|--------|---------|---------------|-------------|
| OpenAI (Whisper) | Per-call in `whisperClient.ts` | `getConfig().OPENAI_API_KEY` | ✅ Good — mock `core/ai.js` |
| OpenAI (DALL-E) | Per-call in `imageGeneration.ts` | `getConfig().OPENAI_API_KEY` | ✅ Good — mock `getConfig` |
| GoogleGenAI | Per-call in `geminiClient.ts` | `getConfig().GEMINI_API_KEY` | ✅ Good — mock `@google/genai` |
| LateApiClient | Constructor in `lateApi.ts` | `getConfig()` | ⚠️ Config read in constructor |
| LLM Provider | Singleton via `getProvider()` | `getConfig().LLM_PROVIDER` | ⚠️ Cached singleton |

Per-call creation is good for mockability. Singleton caching is the recurring problem.

---

## 7. Current State Summary

### Tier Distribution (by module count)

| Tier | Count | % of modules | Description |
|------|-------|-------------|-------------|
| **Tier 1** (Pure) | 6 | 12% | No mocking needed |
| **Tier 2** (DI) | 5 | 10% | Interface-injectable |
| **Tier 3** (Module-mock) | 31 | 63% | Requires `vi.mock()` |
| **Tier 4** (Hard) | 8 | 16% | Singletons, import side effects |

### What Already Works Well

1. **`core/` abstraction layer** — wrapping Node builtins (`fs`, `child_process`, `path`) in thin modules gives tests stable, low-churn mock targets. One `vi.mock('../core/fileSystem.js')` covers 20+ functions.

2. **`LLMProvider` interface** — the provider abstraction is well-designed for DI. `BaseAgent` accepts a provider in its constructor. The `LLMSession` contract is small (3 methods).

3. **Pure function extraction** — `buildFilterComplex`, `captionGenerator`, `pricing`, `adjustTranscript`, `platformContentStrategy` are all excellent examples of extracting testable logic from I/O-heavy modules.

4. **`costTracker.reset()`** — the singleton has an explicit reset method, making test isolation straightforward.

5. **`resetProvider()`** — the provider factory exposes a test-only reset function.

6. **`vi.hoisted()` pattern** — consistently used across test files for ESM-compatible mock setup.

### Biggest Gaps

1. **Config import side effects** — `environment.ts` runs `.env` loading at import time. This poisons `process.env` before tests can set up isolation. Every test file that imports anything touching config inherits this side effect.

2. **No `resetBrandConfig()`** — `brand.ts` caches with no way to clear it between tests.

3. **Top-level FFmpeg path resolution** — modules like `captionBurning.ts`, `clipExtraction.ts`, and `singlePassEdit.ts` run `const ffmpegPath = getFFmpegPath()` at module top level, coupling import to config + filesystem.

4. **`faceDetection.ts` ONNX session** — global cached session with no reset. Requires ONNX model file on disk. Tests skip entirely via `describe.skipIf()`.

5. **Agent tests mock SDK instead of using DI** — `agents.test.ts` mocks `@github/copilot-sdk` at module level. This tests the mock, not the agent logic. Should inject a mock `LLMProvider` via the constructor instead.

6. **Heavy pipeline test setup** — `pipeline.test.ts` requires ~30 hoisted mock variables. This is a symptom of the pipeline function doing too much — no intermediate abstractions between the orchestrator and individual stages.

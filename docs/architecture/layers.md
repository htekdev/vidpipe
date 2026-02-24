# Layered Architecture (L0–L7)

> Reference documentation for vidpipe's layered architecture.
> For the background mockability analysis, see [`audit/mockability/`](../../audit/mockability/).

---

## 1. Introduction

The vidpipe codebase uses an eight-layer architecture (L0–L7) to establish clear boundaries between pure logic, infrastructure, external clients, business logic, AI agents, assets, orchestration, and entry points.

**Why layers?**

1. **Mockability boundaries.** Each layer has a single, well-defined mock strategy. You never wonder what to stub — the layer tells you.
2. **Import direction enforcement.** Layer N may only import from layers 0 through N. Upward imports are prohibited.
3. **Test strategy per layer.** Pure functions get zero-mock unit tests. Clients get API stubs. Agents get injected providers. The layer determines the test type.

The full mockability analysis that motivated this design lives in [`audit/mockability/README.md`](../../audit/mockability/README.md).

---

## 2. Layer Overview

| Layer | Name | Purpose | Examples |
|-------|------|---------|----------|
| **L0** | Pure | Zero-dependency pure functions — no I/O, no mocking needed | `types/`, `pricing.ts`, `captionGenerator.ts`, `text.ts`, `buildFilterComplex()`, `adjustTranscript()`, `platformContentStrategy.ts` |
| **L1** | Infrastructure | Thin wrappers around Node.js built-ins and external packages | `config/environment.ts`, `logger.ts`, `core/fileSystem.ts`, `core/paths.ts`, `core/process.ts`, `core/env.ts`, `ai/` (OpenAI, Anthropic, Copilot, Gemini SDK wrappers), `image/image.ts` (sharp), `ffmpeg/ffmpeg.ts` (fluent-ffmpeg), `http/httpClient.ts` |
| **L2** | Clients | External API and child-process clients | FFmpeg tools (`silenceDetection`, `clipExtraction`, …), `whisperClient.ts`, `geminiClient.ts`, LLM providers (`CopilotProvider`, `OpenAIProvider`, `ClaudeProvider`), `lateApi.ts` |
| **L3** | Services | Business logic that composes L2 clients | `transcription.ts`, `costTracker.ts`, `postStore.ts`, `scheduler.ts`, `queueBuilder.ts`, `processingState.ts`, `gitOperations.ts` |
| **L4** | Agents | LLM-powered agents extending `BaseAgent` | `BaseAgent.ts`, `ShortsAgent.ts`, `MediumVideoAgent.ts`, `SummaryAgent.ts`, `BlogAgent.ts`, `ChapterAgent.ts`, `SocialMediaAgent.ts`, `ProducerAgent.ts` |
| **L5** | Assets | Lazy-loaded artifact representations with L4 bridge modules | `MainVideoAsset`, `ShortVideoAsset`, `MediumClipAsset`, `loaders.ts`, bridge modules (`videoServiceBridge`, `analysisServiceBridge`, `pipelineServiceBridge`) |
| **L6** | Pipeline | Stage orchestration | `pipeline.ts`, `runStage()`, `stages/visualEnhancement.ts` |
| **L7** | App | Entry points — CLI, servers, watchers | `src/index.ts` (CLI), review server, `fileWatcher.ts`, commands (`init`, `schedule`, `doctor`) |

---

## 3. Layer Rules

### Import Direction — Strict Single-Dependency + Foundation

L0 and L1 are **foundation layers** — importable from any layer. All other layers follow **strict single-dependency** rules: each business layer imports only from the layer directly below it (plus L0/L1).

```
L7-App  ──imports──▶  L6, L3, L1, L0
L6-Pipeline  ────▶    L5, L1, L0
L5-Assets  ──────▶    L4, L1, L0
L4-Agents  ──────▶    L3, L1, L0
L3-Services  ────▶    L2, L1, L0
L2-Clients  ─────▶    L1, L0
L1-Infra  ───────▶    L0
L0-Pure  ────────▶    (nothing)
```

**Type-only imports are exempt.** `import type { ... }` may cross any boundary since they are erased at compile time and create no runtime coupling.

### Per-Layer Policies

| Layer | May Import | Must NOT Import | Singletons? | I/O? |
|-------|-----------|-----------------|-------------|------|
| **L0** | Self only | L1–L7, `fs`, `child_process` | No | No |
| **L1** | L0 | L2–L7 | Yes (logger, config) | Yes (Node.js built-ins) |
| **L2** | L0, L1 | L3–L7 | No | Yes (external APIs, binaries) |
| **L3** | L0, L1, L2 | L4–L7 | Allowed | Via L2 only |
| **L4** | L0, L1, L3 | L2, L5–L7 | No | Via L3 only |
| **L5** | L0, L1, L4 | L2, L3, L6–L7 | No | Via L4 bridge modules |
| **L6** | L0, L1, L5 | L2, L3, L4, L7 | No | Via L5 asset methods |
| **L7** | L0, L1, L3, L6 | L2, L4, L5 | Yes (CLI, server) | Yes (entry point) |

---

## 4. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│  L7  App                                                │
│  CLI · Review Server · File Watcher · Commands          │
│  imports: L6, L3, L1, L0                                │
├─────────────────────────────────────────────────────────┤
│  L6  Pipeline                                           │
│  pipeline.ts · runStage() · visualEnhancement           │
│  imports: L5, L1, L0                                    │
├─────────────────────────────────────────────────────────┤
│  L5  Assets                                             │
│  MainVideoAsset · ShortVideoAsset · bridge modules      │
│  imports: L4, L1, L0                                    │
├─────────────────────────────────────────────────────────┤
│  L4  Agents                                             │
│  BaseAgent · ShortsAgent · SummaryAgent · BlogAgent · … │
│  imports: L3, L1, L0                                    │
├─────────────────────────────────────────────────────────┤
│  L3  Services                                           │
│  transcription · costTracker · postStore · scheduler     │
│  imports: L2, L1, L0                                    │
├─────────────────────────────────────────────────────────┤
│  L2  Clients                                            │
│  FFmpeg tools · Whisper · Gemini · LLM providers · Late │
│  imports: L1, L0                                        │
├══════════════════════ FOUNDATION ════════════════════════┤
│  L1  Infrastructure                                     │
│  config · logger · fileSystem · process · paths · env   │
│  ai/ (OpenAI, Anthropic, Copilot, Gemini wrappers)      │
│  image/ (sharp) · ffmpeg/ (fluent-ffmpeg) · http/       │
│  imports: L0                                            │
├─────────────────────────────────────────────────────────┤
│  L0  Pure                                               │
│  types · pricing · captions · filters · text · platform │
│  imports: (nothing)                                     │
└─────────────────────────────────────────────────────────┘
       ▲  L0+L1 are foundation — importable from ANY layer
       ▲  Business layers import ONLY from the layer directly below + foundation
```

---

## 5. Test Strategy

Each layer has a defined test type and mock policy.

### Unit Tests (per-layer)

| Layer | What's Real | What's Mocked | Timeout |
|-------|-------------|---------------|---------|
| **L0** | Everything | Nothing | 5 s |
| **L1** | L0 + L1 logic | `fs`, `process.env`, `child_process` | 5 s |
| **L2** | L0–L2 logic | External APIs, FFmpeg binary, file system | 10 s |
| **L3** | L0–L3 logic | L2 clients (via `vi.mock()`) | 10 s |
| **L4** | L0, L1, L4 logic | L3 services (via `vi.mock()`) | 10 s |
| **L5** | L0, L1, L5 logic | L4 agents/bridges (via `vi.mock()`) | 10 s |
| **L6** | L0, L1, L6 logic | L5 assets (via `vi.mock()`) | 10 s |
| **L7** | L0, L1, L7 logic | L6 pipeline (via `vi.mock()`) | 10 s |

### Integration Tests (cross-layer, tiered mock boundaries)

| Workspace | Layers Under Test | Coverage Scope | Mock Boundary | Timeout |
|-----------|------------------|----------------|---------------|---------|
| **integration-L3** | L2 + L3 (real clients + services) | L2, L3 | L1 mocked | 30 s |
| **integration-L4-L6** | L4 + L5 + L6 (agents + assets + pipeline) | L4, L5, L6 | L2 mocked (L3 runs real but uncounted) | 60 s |
| **integration-L7** | L7 app layer | L7 | L1 + L3 mocked | 60 s |

### E2E Tests

| Test Type | What's Real | What's Mocked | Timeout |
|-----------|-------------|---------------|---------|
| **E2E** | Everything | Nothing (real FFmpeg, real I/O) | 120 s |

### Vitest Workspace Commands

The test suite is split by project so you can run just the layer you're working on:

```bash
npx vitest --project unit                # L0–L7 unit — fast, no external deps
npx vitest --project integration-L3      # L3 services — mocks L1/L0
npx vitest --project integration-L4-L6   # L4-L6 layers — mocks L2
npx vitest --project integration-L7      # L7 app — mocks L1-L3
npx vitest --project e2e                 # Real FFmpeg, real I/O
```

Per-tier scripts with coverage:

```bash
npm run test:integration:L3:coverage
npm run test:integration:L4-L6:coverage
npm run test:integration:L7:coverage
npm run test:e2e:coverage
```

### Mock Simplification Example

**Before layers** — testing `transcription.ts` required five mocks:

```typescript
vi.mock('../tools/whisper/whisperClient.js')
vi.mock('../tools/ffmpeg/audioExtraction.js')
vi.mock('../core/fileSystem.js')
vi.mock('../config/logger.js')
vi.mock('../services/costTracker.js')
```

**With layers** — `transcription.ts` is L3, so only L2 clients need mocking:

```typescript
vi.mock('../../L2-clients/whisper/whisperClient.js')
vi.mock('../../L2-clients/ffmpeg/audioExtraction.js')
```

L0 and L1 are foundation layers — they run real in unit tests (no mocking needed).

### Integration Test Mock Examples

```typescript
// Integration L3 — mock L1 only, L2 clients run REAL
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({ /* controlled I/O */ }))
import { markPending } from '../../../L3-services/processingState/processingState.js'

// Integration L4-L6 — mock L2 only, L3+L4+L5+L6 run real
vi.mock('../../../L2-clients/gemini/geminiClient.js', () => ({ /* fake Gemini */ }))
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'

// Integration L7 — mock L1 + L3, test real L7 app layer
vi.mock('../../../L1-infra/config/environment.js', () => ({ /* controlled config */ }))
vi.mock('../../../L3-services/lateApi/lateApiService.js', () => ({ /* fake Late API */ }))
import { createRouter } from '../../../L7-app/review/routes.js'
```

---

## 6. Enforcement

Layer boundaries are enforced at three levels:

### Agent Hooks (`.github/hooks/`)

| Hook | Purpose |
|------|---------|
| `pre-layer-import` | Blocks upward imports. If a file in L2 tries to import from L3+, the hook rejects the change. |
| `pre-layer-mock` | Blocks inappropriate mocking. If an L0 test mocks something, or an L3 test mocks L0/L1, the hook flags it. |

### Instruction File (`.github/instructions/layers.instructions.md`)

The Copilot instruction file teaches the AI assistant the layer rules proactively. When Copilot generates code, it follows the import direction and mocking constraints automatically.

### Hook Rules Reference

For the complete specification of every import rule, mocking constraint, exemption, and known limitation enforced by these hooks, see:

📄 [`.github/hooks/README.md`](../../.github/hooks/README.md) — the authoritative source for all enforcement rules.

### Future: ESLint Plugin

A CI-enforced ESLint rule will scan import paths and fail the build on layer violations:

```bash
# Conceptual check — L0 files must not import from L1+
grep -r "from '\.\./L[1-7]" src/L0-pure/ && echo "VIOLATION" || echo "OK"
```

---

## 7. Adding New Files

Use this decision tree to determine which layer a new file belongs in:

```
Does it have zero dependencies and zero I/O?
  └─ Yes → L0 (Pure)

Does it wrap a Node.js built-in (fs, path, child_process, http)?
  └─ Yes → L1 (Infrastructure)

Does it call an external API or spawn an external process?
  └─ Yes → L2 (Clients)

Does it contain business logic that composes L2 clients?
  └─ Yes → L3 (Services)

Is it an LLM-powered agent extending BaseAgent?
  └─ Yes → L4 (Agents)

Is it a lazy-loaded artifact representation?
  └─ Yes → L5 (Assets)

Does it orchestrate pipeline stages?
  └─ Yes → L6 (Pipeline)

Is it an entry point (CLI, server, watcher)?
  └─ Yes → L7 (App)
```

### Quick Examples

| Scenario | Layer | Reasoning |
|----------|-------|-----------|
| New cost-calculation helper | L0 | Pure math, no I/O |
| Redis cache wrapper | L1 | Infrastructure adapter |
| YouTube Data API client | L2 | External API client |
| Video publishing service | L3 | Business logic composing L2 clients |
| ThumbnailAgent | L4 | LLM-powered agent |
| ThumbnailAsset | L5 | Lazy-loaded representation |
| New pipeline stage | L6 | Orchestration |
| `vidpipe publish` command | L7 | CLI entry point |

---

## 8. Bridge Modules

L5 assets need access to L3 services but can only import L4. To maintain strict layer rules, **bridge modules** in L4 re-export L3 functionality:

| Bridge Module (L4) | Re-exports From (L3) |
|--------------------|-----------------------|
| `videoServiceBridge.ts` | FFmpeg operations from `videoOperations` |
| `analysisServiceBridge.ts` | Gemini analysis, transcription, caption generation |
| `pipelineServiceBridge.ts` | costTracker, processingState, gitOperations, queueBuilder |

```typescript
// L5 imports from L4 bridge (allowed: L5 → L4)
import { singlePassEdit } from '../../L4-agents/videoServiceBridge.js'

// Bridge re-exports from L3 (allowed: L4 → L3)
export { singlePassEdit } from '../../L3-services/videoOperations/videoOperations.js'
```

Similarly, L7 needs L2 functionality (Late API, FFmpeg paths) through **L3 service wrappers**:

| L3 Wrapper | Wraps (L2) |
|-----------|------------|
| `lateApiService.ts` | `LateApiClient` from `L2-clients/late/lateApi` |
| `diagnostics.ts` | FFmpeg/FFprobe path resolvers from `L2-clients/ffmpeg` |

---

## 9. Migration Status

> **Status: Complete.** All source files have been restructured into L0–L7 folders. Layer enforcement hooks are active.

The physical folder restructure from the legacy layout (`src/agents/`, `src/tools/`, `src/services/`, etc.) to the layered layout (`src/L0-pure/` through `src/L7-app/`) is **done**. All imports, tests, and CI are aligned to the new structure.

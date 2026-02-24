# Restructure Proposal: Layered Architecture for Testability

> **Status:** Draft  
> **Date:** 2025-07-15  
> **Scope:** Reorganize `src/` to align folder structure with architectural layers and mockability tiers.

---

## 1. Problem Statement

The current `src/` structure groups modules by **what they are** (agents, tools, services) rather than **what layer they live in**. This creates three concrete problems:

1. **Unclear mocking requirements.** When writing a test for `transcription.ts`, a developer must trace its import chain to discover it depends on `whisperClient.ts` (external API), `ffmpeg/audioExtraction.ts` (child process), `fileSystem.ts` (I/O), `logger.ts` (singleton), and `costTracker.ts` (service). Nothing in the folder structure hints at this.

2. **No compile-time enforcement of layer boundaries.** A pure utility function in `core/text.ts` sits next to `core/ffmpeg.ts` which shells out to a binary. Both are "core" but have fundamentally different test strategies — one needs zero mocking, the other needs `execFile` stubs.

3. **Test organization doesn't match architecture.** The 48 unit tests are mostly flat in `src/__tests__/`, making it impossible to tell at a glance which tests are pure-function tests (fast, no mocking) vs. integration tests (slower, need fixtures).

### What We Want

A developer should be able to look at a file's **directory** and immediately know:
- What it's allowed to import
- What test type it needs (unit / integration / e2e)
- What to mock when testing it

---

## 2. Proposed Layered Structure

```
src/
├── L0-pure/              — Pure functions, zero I/O, zero mocking needed
│   ├── types/            — Domain types
│   │   └── index.ts
│   ├── pricing/          — Cost calculations
│   │   └── pricing.ts
│   ├── text/             — String utilities (slugify, generateId)
│   │   └── text.ts
│   ├── captions/         — Caption generation (SRT, VTT, ASS)
│   │   └── captionGenerator.ts
│   ├── filters/          — FFmpeg filter string builders
│   │   └── (extracted from ffmpeg tools)
│   └── transcript/       — adjustTranscript, timestamp math
│       └── (extracted from captionGeneration.ts)
│
├── L1-infra/             — Infrastructure adapters, mock at boundary
│   ├── config/           — Environment, brand, model config
│   │   ├── environment.ts
│   │   ├── brand.ts
│   │   └── modelConfig.ts
│   ├── logger/           — Winston logger
│   │   └── logger.ts
│   ├── fileSystem/       — File I/O wrapper
│   │   └── fileSystem.ts
│   ├── process/          — execFile, spawn wrappers
│   │   └── process.ts
│   ├── paths/            — Path resolution
│   │   └── paths.ts
│   ├── http/             — HTTP/network utilities
│   │   ├── http.ts
│   │   └── network.ts
│   ├── env/              — Process environment access
│   │   └── env.ts
│   ├── cli/              — CLI argument parsing helpers
│   │   └── cli.ts
│   └── ffmpegResolver/   — FFmpeg/FFprobe binary resolution
│       └── ffmpegResolver.ts
│
├── L2-clients/           — External API/process clients, mock the client
│   ├── ffmpeg/           — FFmpeg operations (9 files)
│   │   ├── frameCapture.ts
│   │   ├── audioExtraction.ts
│   │   ├── silenceDetection.ts
│   │   ├── clipExtraction.ts
│   │   ├── aspectRatio.ts
│   │   ├── captionBurning.ts
│   │   ├── singlePassEdit.ts
│   │   ├── overlayCompositing.ts
│   │   └── faceDetection.ts
│   ├── whisper/          — OpenAI Whisper API client
│   │   └── whisperClient.ts
│   ├── gemini/           — Google Gemini API client
│   │   └── geminiClient.ts
│   ├── openai/           — OpenAI image generation
│   │   └── imageGeneration.ts
│   ├── llm/              — LLM providers
│   │   ├── types.ts
│   │   ├── index.ts
│   │   ├── CopilotProvider.ts
│   │   ├── OpenAIProvider.ts
│   │   ├── ClaudeProvider.ts
│   │   └── imageUtils.ts
│   └── late/             — Late.co scheduling API client
│       └── lateApi.ts
│
├── L3-services/          — Business logic services, mock L2 clients
│   ├── transcription/
│   │   └── transcription.ts
│   ├── costTracking/
│   │   └── costTracker.ts
│   ├── captionGeneration/
│   │   └── captionGeneration.ts
│   ├── postStore/
│   │   └── postStore.ts
│   ├── scheduler/
│   │   ├── scheduler.ts
│   │   └── scheduleConfig.ts
│   ├── queueBuilder/
│   │   └── queueBuilder.ts
│   ├── socialPosting/
│   │   ├── socialPosting.ts
│   │   ├── accountMapping.ts
│   │   └── platformContentStrategy.ts
│   ├── processingState/
│   │   └── processingState.ts
│   └── gitOperations/
│       └── gitOperations.ts
│
├── L4-agents/            — LLM-powered agents, mock L2 clients + inject LLMProvider
│   ├── BaseAgent.ts
│   ├── ProducerAgent.ts
│   ├── ShortsAgent.ts
│   ├── MediumVideoAgent.ts
│   ├── SummaryAgent.ts
│   ├── ChapterAgent.ts
│   ├── SocialMediaAgent.ts
│   ├── BlogAgent.ts
│   ├── GraphicsAgent.ts
│   ├── SilenceRemovalAgent.ts
│   ├── agentTools.ts
│   └── index.ts
│
├── L5-assets/            — Lazy-loaded asset representations
│   ├── Asset.ts
│   ├── VideoAsset.ts
│   ├── TextAsset.ts
│   ├── MainVideoAsset.ts
│   ├── ShortVideoAsset.ts
│   ├── MediumClipAsset.ts
│   ├── SocialPostAsset.ts
│   ├── SummaryAsset.ts
│   ├── BlogAsset.ts
│   ├── loaders.ts
│   └── index.ts
│
├── L6-pipeline/          — Orchestration, mock agents + services
│   ├── pipeline.ts
│   └── stages/
│       └── visualEnhancement.ts
│
├── L7-app/               — Entry points, E2E only
│   ├── cli.ts            — (current index.ts)
│   ├── commands/
│   │   ├── init.ts
│   │   ├── schedule.ts
│   │   └── doctor.ts
│   ├── review/
│   │   ├── server.ts
│   │   ├── routes.ts
│   │   ├── approvalQueue.ts
│   │   └── public/
│   │       ├── index.html
│   │       └── index-single.html
│   └── fileWatcher.ts
│
└── __tests__/            — Reorganized by test type
    ├── unit/             — Tests for L0–L3
    ├── integration/      — Tests for L4–L6
    └── e2e/              — Tests for L7
```

---

## 3. Layer Rules

Each layer has strict import constraints. Violations should eventually be enforced by an ESLint rule or a CI boundary check script.

| Layer | May Import | Must NOT Import | Singletons? | I/O? |
|-------|-----------|-----------------|-------------|------|
| **L0-pure** | Nothing (self only) | L1–L7, `fs`, `child_process`, `node:http` | No | No |
| **L1-infra** | L0 | L2–L7 | Yes (logger, config) | Yes (Node.js built-ins) |
| **L2-clients** | L0, L1 | L3–L7 | No | Yes (external APIs, binaries) |
| **L3-services** | L0, L1, L2 | L4–L7 | Allowed | Via L2 only |
| **L4-agents** | L0, L1, L2, L3 | L5–L7 | No | Via L2/L3 only |
| **L5-assets** | L0–L4 | L6–L7 | No | Via lower layers |
| **L6-pipeline** | L0–L5 | L7 | No | Via lower layers |
| **L7-app** | L0–L6 | — | Yes (CLI, server) | Yes (entry point) |

**Enforcement approach:** A simple script can scan imports and flag violations:
```bash
# Pseudo-check: L0 files must not import from L1+
grep -r "from '\.\./L[1-7]" src/L0-pure/ && echo "VIOLATION" || echo "OK"
```

---

## 4. Test Strategy Per Layer

| Layer | Test Type | What's Real | What's Mocked | Timeout |
|-------|-----------|-------------|---------------|---------|
| **L0** | Unit | Everything | Nothing | 5s |
| **L1** | Unit | L0 + L1 logic | `fs`, `process.env`, `child_process` | 5s |
| **L2** | Unit | L0 + L1 + L2 logic | External APIs, FFmpeg binary, file system | 10s |
| **L3** | Unit | L0–L3 logic | L2 clients (via `vi.mock()`) | 10s |
| **L4** | Integration | L0–L4 logic | L2 clients; LLMProvider injected via constructor | 30s |
| **L5** | Integration | L0–L5 logic | L2 clients | 30s |
| **L6** | Integration | L0–L6 logic | L2 clients, agents | 60s |
| **L7** | E2E | Everything | External APIs only (via env vars / test doubles) | 120s |

### Mocking Simplification

**Before (current):** Testing `transcription.ts` requires mocking:
```typescript
vi.mock('../tools/whisper/whisperClient.js')
vi.mock('../tools/ffmpeg/audioExtraction.js')
vi.mock('../core/fileSystem.js')
vi.mock('../config/logger.js')
vi.mock('../services/costTracker.js')
```

**After (proposed):** Testing `transcription.ts` (L3) requires mocking only L2 clients:
```typescript
vi.mock('../../L2-clients/whisper/whisperClient.js')
vi.mock('../../L2-clients/ffmpeg/audioExtraction.js')
```

L0 and L1 are real because they're pure/infrastructure — no need to mock them.

---

## 5. Migration Path

### Phase 1: Extract L0 Pure Functions *(lowest risk, highest value)*

**Effort:** ~2 hours | **Risk:** Low (no behavior change) | **Value:** High

1. Create `src/L0-pure/` with subdirectories.
2. Move `types/index.ts`, `config/pricing.ts`, `core/text.ts`, `tools/captions/captionGenerator.ts`.
3. Extract pure filter-builder functions from FFmpeg tools into `L0-pure/filters/`.
4. Extract `adjustTranscript` logic from `captionGeneration.ts` into `L0-pure/transcript/`.
5. Update all import paths.
6. Verify: `npm run build && npm run test`.

### Phase 2: Formalize L1 Infrastructure Boundaries

**Effort:** ~2 hours | **Risk:** Low

1. Create `src/L1-infra/` with subdirectories.
2. Move `config/environment.ts`, `config/brand.ts`, `config/modelConfig.ts`, `config/ffmpegResolver.ts`.
3. Move `config/logger.ts` and `core/logger.ts` → merge into `L1-infra/logger/logger.ts`.
4. Move `core/fileSystem.ts`, `core/process.ts`, `core/paths.ts`, `core/http.ts`, `core/network.ts`, `core/env.ts`, `core/cli.ts`.
5. Update imports, build, test.

### Phase 3: Reorganize L2 Clients

**Effort:** ~3 hours | **Risk:** Medium (touches FFmpeg wrappers)

1. Create `src/L2-clients/`.
2. Move all `tools/ffmpeg/*.ts` → `L2-clients/ffmpeg/`.
3. Move `tools/whisper/`, `tools/gemini/`, `tools/imageGeneration.ts`.
4. Move `providers/*` → `L2-clients/llm/`.
5. Move `services/lateApi.ts` → `L2-clients/late/`.
6. Update imports, build, test.

### Phase 4: Restructure Tests to Match

**Effort:** ~3 hours | **Risk:** Low (test-only changes)

1. Create `__tests__/unit/`, `__tests__/integration/`, `__tests__/e2e/`.
2. Move pure-function tests to `unit/`.
3. Move FFmpeg integration tests to `integration/`.
4. Update `vitest.config.ts` with workspaces.
5. Verify all tests pass in new locations.

### Phase 5: Move L3–L7 Into Place

**Effort:** ~4 hours | **Risk:** Medium

1. Create `L3-services/`, `L4-agents/`, `L5-assets/`, `L6-pipeline/`, `L7-app/`.
2. Move files per the mapping table below.
3. Update all import paths project-wide.
4. Final build + test verification.

**Total estimated effort:** ~14 hours across 5 PRs.

---

## 6. What Moves Where — Complete File Mapping

### L0-pure (Pure Functions)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/types/index.ts` | `src/L0-pure/types/index.ts` |
| `src/config/pricing.ts` | `src/L0-pure/pricing/pricing.ts` |
| `src/core/text.ts` | `src/L0-pure/text/text.ts` |
| `src/tools/captions/captionGenerator.ts` | `src/L0-pure/captions/captionGenerator.ts` |
| *(extracted from ffmpeg tools)* | `src/L0-pure/filters/filterBuilders.ts` |
| *(extracted from captionGeneration.ts)* | `src/L0-pure/transcript/adjustTranscript.ts` |
| `src/core/media.ts` | `src/L0-pure/media/media.ts` |

### L1-infra (Infrastructure)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/config/environment.ts` | `src/L1-infra/config/environment.ts` |
| `src/config/brand.ts` | `src/L1-infra/config/brand.ts` |
| `src/config/modelConfig.ts` | `src/L1-infra/config/modelConfig.ts` |
| `src/config/ffmpegResolver.ts` | `src/L1-infra/ffmpegResolver/ffmpegResolver.ts` |
| `src/config/logger.ts` | `src/L1-infra/logger/logger.ts` |
| `src/core/logger.ts` | *(merge into L1-infra/logger/logger.ts)* |
| `src/core/fileSystem.ts` | `src/L1-infra/fileSystem/fileSystem.ts` |
| `src/core/process.ts` | `src/L1-infra/process/process.ts` |
| `src/core/paths.ts` | `src/L1-infra/paths/paths.ts` |
| `src/core/http.ts` | `src/L1-infra/http/http.ts` |
| `src/core/network.ts` | `src/L1-infra/http/network.ts` |
| `src/core/env.ts` | `src/L1-infra/env/env.ts` |
| `src/core/cli.ts` | `src/L1-infra/cli/cli.ts` |
| `src/core/watcher.ts` | `src/L1-infra/watcher/watcher.ts` |

### L2-clients (External Clients)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/tools/ffmpeg/frameCapture.ts` | `src/L2-clients/ffmpeg/frameCapture.ts` |
| `src/tools/ffmpeg/audioExtraction.ts` | `src/L2-clients/ffmpeg/audioExtraction.ts` |
| `src/tools/ffmpeg/silenceDetection.ts` | `src/L2-clients/ffmpeg/silenceDetection.ts` |
| `src/tools/ffmpeg/clipExtraction.ts` | `src/L2-clients/ffmpeg/clipExtraction.ts` |
| `src/tools/ffmpeg/aspectRatio.ts` | `src/L2-clients/ffmpeg/aspectRatio.ts` |
| `src/tools/ffmpeg/captionBurning.ts` | `src/L2-clients/ffmpeg/captionBurning.ts` |
| `src/tools/ffmpeg/singlePassEdit.ts` | `src/L2-clients/ffmpeg/singlePassEdit.ts` |
| `src/tools/ffmpeg/overlayCompositing.ts` | `src/L2-clients/ffmpeg/overlayCompositing.ts` |
| `src/tools/ffmpeg/faceDetection.ts` | `src/L2-clients/ffmpeg/faceDetection.ts` |
| `src/core/ffmpeg.ts` | `src/L2-clients/ffmpeg/ffmpeg.ts` |
| `src/tools/whisper/whisperClient.ts` | `src/L2-clients/whisper/whisperClient.ts` |
| `src/tools/gemini/geminiClient.ts` | `src/L2-clients/gemini/geminiClient.ts` |
| `src/tools/imageGeneration.ts` | `src/L2-clients/openai/imageGeneration.ts` |
| `src/providers/types.ts` | `src/L2-clients/llm/types.ts` |
| `src/providers/index.ts` | `src/L2-clients/llm/index.ts` |
| `src/providers/CopilotProvider.ts` | `src/L2-clients/llm/CopilotProvider.ts` |
| `src/providers/OpenAIProvider.ts` | `src/L2-clients/llm/OpenAIProvider.ts` |
| `src/providers/ClaudeProvider.ts` | `src/L2-clients/llm/ClaudeProvider.ts` |
| `src/providers/imageUtils.ts` | `src/L2-clients/llm/imageUtils.ts` |
| `src/services/lateApi.ts` | `src/L2-clients/late/lateApi.ts` |
| `src/core/ai.ts` | `src/L2-clients/llm/ai.ts` |

### L3-services (Business Logic)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/services/transcription.ts` | `src/L3-services/transcription/transcription.ts` |
| `src/services/costTracker.ts` | `src/L3-services/costTracking/costTracker.ts` |
| `src/services/captionGeneration.ts` | `src/L3-services/captionGeneration/captionGeneration.ts` |
| `src/services/postStore.ts` | `src/L3-services/postStore/postStore.ts` |
| `src/services/scheduler.ts` | `src/L3-services/scheduler/scheduler.ts` |
| `src/services/scheduleConfig.ts` | `src/L3-services/scheduler/scheduleConfig.ts` |
| `src/services/queueBuilder.ts` | `src/L3-services/queueBuilder/queueBuilder.ts` |
| `src/services/socialPosting.ts` | `src/L3-services/socialPosting/socialPosting.ts` |
| `src/services/accountMapping.ts` | `src/L3-services/socialPosting/accountMapping.ts` |
| `src/services/platformContentStrategy.ts` | `src/L3-services/socialPosting/platformContentStrategy.ts` |
| `src/services/processingState.ts` | `src/L3-services/processingState/processingState.ts` |
| `src/services/gitOperations.ts` | `src/L3-services/gitOperations/gitOperations.ts` |

### L4-agents (LLM Agents)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/agents/BaseAgent.ts` | `src/L4-agents/BaseAgent.ts` |
| `src/agents/ProducerAgent.ts` | `src/L4-agents/ProducerAgent.ts` |
| `src/agents/ShortsAgent.ts` | `src/L4-agents/ShortsAgent.ts` |
| `src/agents/MediumVideoAgent.ts` | `src/L4-agents/MediumVideoAgent.ts` |
| `src/agents/SummaryAgent.ts` | `src/L4-agents/SummaryAgent.ts` |
| `src/agents/ChapterAgent.ts` | `src/L4-agents/ChapterAgent.ts` |
| `src/agents/SocialMediaAgent.ts` | `src/L4-agents/SocialMediaAgent.ts` |
| `src/agents/BlogAgent.ts` | `src/L4-agents/BlogAgent.ts` |
| `src/agents/GraphicsAgent.ts` | `src/L4-agents/GraphicsAgent.ts` |
| `src/agents/SilenceRemovalAgent.ts` | `src/L4-agents/SilenceRemovalAgent.ts` |
| `src/agents/index.ts` | `src/L4-agents/index.ts` |
| `src/tools/agentTools.ts` | `src/L4-agents/agentTools.ts` |

### L5-assets (Asset Representations)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/assets/Asset.ts` | `src/L5-assets/Asset.ts` |
| `src/assets/VideoAsset.ts` | `src/L5-assets/VideoAsset.ts` |
| `src/assets/TextAsset.ts` | `src/L5-assets/TextAsset.ts` |
| `src/assets/MainVideoAsset.ts` | `src/L5-assets/MainVideoAsset.ts` |
| `src/assets/ShortVideoAsset.ts` | `src/L5-assets/ShortVideoAsset.ts` |
| `src/assets/MediumClipAsset.ts` | `src/L5-assets/MediumClipAsset.ts` |
| `src/assets/SocialPostAsset.ts` | `src/L5-assets/SocialPostAsset.ts` |
| `src/assets/SummaryAsset.ts` | `src/L5-assets/SummaryAsset.ts` |
| `src/assets/BlogAsset.ts` | `src/L5-assets/BlogAsset.ts` |
| `src/assets/loaders.ts` | `src/L5-assets/loaders.ts` |
| `src/assets/index.ts` | `src/L5-assets/index.ts` |

### L6-pipeline (Orchestration)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/pipeline.ts` | `src/L6-pipeline/pipeline.ts` |
| `src/stages/visualEnhancement.ts` | `src/L6-pipeline/stages/visualEnhancement.ts` |

### L7-app (Entry Points)

| Current Location | Proposed Location |
|------------------|-------------------|
| `src/index.ts` | `src/L7-app/cli.ts` |
| `src/commands/init.ts` | `src/L7-app/commands/init.ts` |
| `src/commands/schedule.ts` | `src/L7-app/commands/schedule.ts` |
| `src/commands/doctor.ts` | `src/L7-app/commands/doctor.ts` |
| `src/review/server.ts` | `src/L7-app/review/server.ts` |
| `src/review/routes.ts` | `src/L7-app/review/routes.ts` |
| `src/review/approvalQueue.ts` | `src/L7-app/review/approvalQueue.ts` |
| `src/review/public/index.html` | `src/L7-app/review/public/index.html` |
| `src/review/public/index-single.html` | `src/L7-app/review/public/index-single.html` |
| `src/services/fileWatcher.ts` | `src/L7-app/fileWatcher.ts` |

---

## 7. Impact on vitest.config.ts

Replace the current flat config with workspace-based test suites:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/__tests__/unit/**/*.test.ts'],
          testTimeout: 10_000,
          coverage: {
            include: [
              'src/L0-pure/**/*.ts',
              'src/L1-infra/**/*.ts',
              'src/L2-clients/**/*.ts',
              'src/L3-services/**/*.ts',
            ],
            thresholds: {
              statements: 80,
              branches: 75,
              functions: 80,
              lines: 80,
            },
          },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/__tests__/integration/**/*.test.ts'],
          testTimeout: 60_000,
          coverage: {
            include: [
              'src/L4-agents/**/*.ts',
              'src/L5-assets/**/*.ts',
              'src/L6-pipeline/**/*.ts',
            ],
            thresholds: {
              statements: 60,
              branches: 50,
              functions: 60,
              lines: 60,
            },
          },
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['src/__tests__/e2e/**/*.test.ts'],
          testTimeout: 120_000,
          coverage: {
            include: ['src/L7-app/**/*.ts'],
          },
        },
      },
    ],
  },
})
```

**Run commands:**
```bash
npx vitest --project unit          # Fast, no external deps
npx vitest --project integration   # Needs FFmpeg
npx vitest --project e2e           # Needs all services
npx vitest                         # All suites
```

---

## 8. Open Questions

1. **Should the `L`-prefix be used literally in directory names?**
   - Pro: Makes layer order instantly visible in file explorers and `ls` output.
   - Con: Verbose import paths (`../../L2-clients/ffmpeg/...`), unconventional.
   - Alternative: Use plain names (`pure/`, `infra/`, `clients/`, etc.) with a `LAYERS.md` reference doc.

2. **Should assets (L5) be merged into services (L3)?**
   - Assets currently depend on agents (L4), which forces them above agents in the hierarchy. If asset lazy-loading were refactored to use callbacks/factories instead of direct agent imports, they could drop to L3.

3. **How to handle the review server?**
   - `review/server.ts` is an Express HTTP server (L7-app), but `approvalQueue.ts` contains business logic (arguably L3). Consider splitting: queue logic → L3, server/routes → L7.

4. **Should `stages/` be merged into `L6-pipeline/` or kept as a separate layer?**
   - Currently only `visualEnhancement.ts` exists. If more stages are extracted from `pipeline.ts`, a `stages/` subdirectory within L6 makes sense. Proposed: keep as `L6-pipeline/stages/`.

5. **Should `core/ai.ts` and `core/media.ts` go to L0 or L2?**
   - If they contain only pure utility functions (format conversions, calculations), they belong in L0. If they call APIs or do I/O, they belong in L2. Requires inspection during Phase 1.

6. **How to handle barrel files (`index.ts`) during migration?**
   - Option A: Each layer gets its own `index.ts` barrel. Consumers import from layer barrels.
   - Option B: No barrels — import directly from leaf modules. More verbose but clearer dependency tracking.
   - Recommendation: Barrels within a layer only (e.g., `L2-clients/ffmpeg/index.ts`), never cross-layer barrels.

7. **Should ESLint enforce layer boundaries?**
   - An `eslint-plugin-import` rule or custom ESLint plugin could enforce that L0 files never import from L1+. Worth adding post-migration in a follow-up PR.

---
applyTo: "src/**/*.ts"
---

# Layer Architecture (L0–L7)

## Hierarchy — strict layer imports with L0+L1 foundation

```
  L7-app         CLI, servers, watchers          → L0, L1, L3, L6
  L6-pipeline    Stage orchestration             → L0, L1, L5
  L5-assets      Lazy-loaded asset + bridges     → L0, L1, L4
  L4-agents      LLM agents (BaseAgent)          → L0, L1, L3
  L3-services    Business logic + cost tracking  → L0, L1, L2
  L2-clients     External API/process clients    → L0, L1
  L1-infra       Infrastructure (config, logger) → L0        ← FOUNDATION
  L0-pure        Pure functions, zero I/O        → (nothing) ← FOUNDATION
  ─────────────────────────────────────────────────────────────
  L0 + L1 are foundation layers — importable from ANY layer.
  All other imports follow strict rules above.
```

## Layer Rules

| Layer | May Import | Must NOT Import | Singletons? | I/O? |
|-------|-----------|-----------------|-------------|------|
| L0-pure | Nothing (self only) | L1–L7, `fs`, `child_process` | No | No |
| L1-infra | L0 | L2–L7 | Yes (logger, config) | Yes (Node.js built-ins) |
| L2-clients | L0, L1 | L3–L7 | No | Yes (external APIs, binaries) |
| L3-services | L0, L1, L2 | L4–L7 | Allowed | Via L2 only |
| L4-agents | L0, L1, L3 | L2, L5–L7 | No | Via L3 only |
| L5-assets | L0, L1, L4 | L2, L3, L6–L7 | No | Via L4 bridge modules |
| L6-pipeline | L0, L1, L5 | L2, L3, L4, L7 | No | Via L5 asset methods |
| L7-app | L0, L1, L3, L6 | L2, L4, L5 | Yes | Yes |

**Foundation layers:** L0 and L1 are importable from every layer. All other imports follow the strict rules above.

**Exception:** `import type` is exempt from layer rules — types may be imported from any layer.

## Import Examples

```typescript
// ✅ L3-services importing from L2-clients (allowed)
import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'

// ✅ L4-agents importing from L3-services (allowed)
import { extractClip } from '../../L3-services/video/clipExtractor.js'

// ✅ L4-agents importing from L1-infra (foundation layer — always allowed)
import logger from '../../L1-infra/config/logger.js'

// ✅ L6-pipeline importing from L5-assets (allowed)
import { MainVideoAsset } from '../../L5-assets/MainVideoAsset.js'

// ❌ L4-agents importing from L2-clients (BLOCKED — must go through L3)
import { runFFmpeg } from '../../L2-clients/ffmpeg/ffmpegClient.js'

// ❌ L6-pipeline importing from L3-services (BLOCKED — must go through L5)
import { costTracker } from '../../L3-services/costTracking/costTracker.js'

// ❌ L7-app importing from L4-agents (BLOCKED — must go through L6)
import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'

// ✅ Type-only imports are exempt from layer rules
import type { Transcript } from '../../L0-pure/types/index.js'

// ❌ L0-pure importing Node.js built-ins (no I/O allowed)
import { readFileSync } from 'node:fs'
```

## Test Strategy Per Layer

### Unit Tests (per-layer, mock layer directly below)

| Layer | Test Type | What's Mocked | Location |
|-------|-----------|---------------|----------|
| L0 | Unit | Nothing | `__tests__/unit/L0-*` |
| L1 | Unit | Node.js built-ins only | `__tests__/unit/L1-*` |
| L2 | Unit | External APIs/processes | `__tests__/unit/L2-*` |
| L3 | Unit | L2 clients only | `__tests__/unit/L3-*` |
| L4–L7 | Unit | Layer directly below | `__tests__/unit/L4-*` … `L7-*` |

### Integration Tests (cross-layer, defined mock boundaries)

| Workspace | Mock Boundary | Coverage Scope | Location |
|-----------|--------------|----------------|----------|
| integration-L3 | L1 mocked | L2 + L3 (real clients + services) | `__tests__/integration/L3/` |
| integration-L4-L6 | L2 mocked | L4 + L5 + L6 (agents + assets + pipeline) | `__tests__/integration/L4-L6/` |
| integration-L7 | L1 + L3 mocked | L7 (app layer) | `__tests__/integration/L7/` |

### E2E Tests (no mocking, real external processes)

| Test Type | What's Mocked | Location |
|-----------|---------------|----------|
| E2E | Nothing (all real) | `__tests__/e2e/` |

## Test Examples

```typescript
// L0 test — NO vi.mock() allowed, pure function tests only
import { generateSRT } from '../../L0-pure/captions/captionGenerator.js'
describe('generateSRT', () => {
  test('formats timestamps', () => { /* pure function test */ })
})

// L3 unit test — only mock L2 clients, never L0/L1
vi.mock('../../L2-clients/whisper/whisperClient.js')
import { transcribeVideo } from '../../L3-services/transcription/transcription.js'
describe('transcribeVideo', () => {
  test('calls whisper client', async () => { /* L2 is mocked */ })
})

// Integration L3 — mock L1 infrastructure, L2 clients run REAL
vi.mock('../../../L1-infra/fileSystem/fileSystem.js', () => ({ /* controlled I/O */ }))
import { markPending } from '../../../L3-services/processingState/processingState.js'

// Integration L4-L6 — mock L2 clients, test real L4+L5+L6 together
vi.mock('../../../L2-clients/gemini/geminiClient.js', () => ({ /* fake Gemini */ }))
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'

// Integration L7 — mock L1 + L3, test real L7 app layer
vi.mock('../../../L1-infra/config/environment.js', () => ({ /* controlled config */ }))
vi.mock('../../../L3-services/scheduler/scheduler.js', () => ({ /* fake scheduler */ }))
import { createRouter } from '../../../L7-app/review/routes.js'
```

**Key rule:** Mock only the declared mock boundary for each integration workspace. Unit tests mock the layer directly below.

## Where New Files Go

- **Pure utility with no imports** → `L0-pure/`
- **Wraps Node.js built-in** (fs, path, crypto) → `L1-infra/`
- **Calls external API or spawns process** (FFmpeg, OpenAI, Gemini) → `L2-clients/`
- **Business logic using L2 clients** (transcription, cost tracking) → `L3-services/`
- **LLM agent with tools** (extends BaseAgent) → `L4-agents/`
- **Lazy-loaded artifact representation** → `L5-assets/`
- **Stage orchestration** (runStage wrapper, processVideo) → `L6-pipeline/`
- **CLI/server entry point** (commander, express, chokidar) → `L7-app/`

**When unsure:** If a module has I/O, it's L1+. If it calls an external binary/API, it's L2. If it combines L2 calls with business rules, it's L3.

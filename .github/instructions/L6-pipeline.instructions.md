---
applyTo: "src/L6-pipeline/**/*.ts"
---

# L6 — Pipeline Layer

## Purpose

Stage orchestration — runs the 15-stage video editing pipeline from ingestion through git push. Each stage is independently wrapped, timed, and error-resilient.

## Import Rules

- ✅ Can import: L0, L1, L5
- ❌ Cannot import: L2, L3, L4, L7
- ✅ `import type` from any layer is exempt
- L6 orchestrates through L5 asset methods only. Pipeline stages are asset methods on MainVideoAsset.

```typescript
// ✅ Allowed — asset from L5
import { MainVideoAsset } from '../../L5-assets/MainVideoAsset.js'

// ✅ Allowed — config from L1 (foundation layer)
import { getConfig } from '../../L1-infra/config/environment.js'

// ❌ Blocked — L4 agent (access through L5 asset bridge)
import { ShortsAgent } from '../../L4-agents/ShortsAgent.js'

// ❌ Blocked — L3 service (access through L5 asset bridge)
import { costTracker } from '../../L3-services/costTracking/costTracker.js'

// ❌ Blocked — L2 client
import { runFFprobe } from '../../L2-clients/ffmpeg/ffprobeClient.js'

// ❌ Blocked — upward into L7
import { startWatcher } from '../../L7-app/watcher.js'
```

## Key Patterns

- Pipeline stages are methods on `MainVideoAsset` — L6 calls asset methods, not agents/services directly
- Each stage is wrapped in `runStage()` which catches errors and records timing
- **Stage failure does NOT abort the pipeline** — subsequent stages proceed with available data
- Key data flow distinction:
  - `adjustedTranscript` (post silence-removal) → used for captions (aligned to edited video)
  - `originalTranscript` → used for shorts, medium clips, chapters (reference original timestamps)
- Shorts and chapters are generated before summary so README can reference them
- Use `PipelineStage` enum values for stage identification
- Stage functions receive a context object with the `VideoAsset` and accumulated results

## Testing

- Location: `__tests__/unit/L6-pipeline/`
- Mock L5 assets only — never mock L0 or L1
- Test stage ordering, error resilience (one stage fails, others continue)
- Test data flow between stages (adjusted vs original transcript routing)

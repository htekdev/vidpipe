---
applyTo: "src/L3-services/**/*.ts"
---

# L3 — Services Layer

## Purpose

Business logic services that wrap L2 clients with cost tracking, validation, and orchestration.

## Import Rules

- ✅ Can import: L0, L1, L2
- ❌ Cannot import: L4–L7
- `import type` from any layer is OK

```typescript
// ✅ OK
import { geminiClient } from '../../L2-clients/gemini/geminiClient.js'
import { costTracker } from './costTracking/costTracker.js'

// ❌ BLOCKED — agents are L4
import { SummaryAgent } from '../../L4-agents/SummaryAgent.js'
```

## Key Patterns

- L3 is the gateway — L4/L5/L6 must access L2 functionality through L3 services
- Three key services:
  - `videoOperations` — FFmpeg re-exports (cut, concat, burn captions)
  - `videoAnalysis` — Gemini + cost tracking (frame analysis, scene detection)
  - `imageGeneration` — OpenAI + cost tracking (DALL-E image generation)
- Add cost tracking (`costTracker.recordServiceUsage()`) when wrapping L2 calls
- New L2 client functionality? Create or extend an L3 service to expose it
- Singletons allowed (costTracker)

## Testing

- Unit tests in `__tests__/unit/L3-services/`
- Mock L2 clients only (`vi.mock('../../L2-clients/...')`)
- Never mock L0 or L1 — only mock the layer directly below

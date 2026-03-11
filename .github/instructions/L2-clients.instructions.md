---
applyTo: "src/L2-clients/**/*.ts"
---

# L2 — Clients Layer

## Purpose

External API/process clients (FFmpeg, Whisper, Gemini, OpenAI, Late API, LLM providers).

## Import Rules

- ✅ Can import: L0, L1
- ❌ Cannot import: L3–L7 (especially NOT `costTracker` or other services)
- `import type` from any layer is OK

```typescript
// ✅ OK
import logger from '../../L1-infra/config/logger.js'
import { getConfig } from '../../L1-infra/config/environment.js'

// ❌ BLOCKED — cost tracking belongs in L3
import { costTracker } from '../../L3-services/costTracking/costTracker.js'
```

## Key Patterns

- All external packages must be wrapped in L1. Import from L1-infra, not directly from packages.
- No business logic — pure client wrappers only
- Use `execFile()` not `exec()` for FFmpeg (no shell injection)
- Resolve FFmpeg/FFprobe paths through `ffmpeg.ts` — never hardcode binary paths
- Set `maxBuffer: 50 * 1024 * 1024` for FFmpeg calls with large stderr output
- No cost tracking here — that belongs in L3 service wrappers
- Reject Promises with stderr message from `execFile` on failure
- Wrap callback-based APIs with `new Promise<T>()` and proper reject on error

## Testing

- Unit tests in `__tests__/unit/L2-clients/`
- Mock external APIs and processes only (`execFile`, `openai`, `@google/generative-ai`, etc.)
- No layer-path mocks — don't mock L0 or L1 modules

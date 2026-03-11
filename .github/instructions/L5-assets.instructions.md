---
applyTo: "src/L5-assets/**/*.ts"
---

# L5 — Assets Layer

## Purpose

Lazy-loaded asset representations that wrap video files with metadata, transcripts, and analysis results. Provides dynamic loaders for heavy modules to avoid eager initialization.

## Import Rules

- ✅ Can import: L0, L1, L4
- ❌ Cannot import: L2, L3, L6, L7
- ✅ `import type` from any layer is exempt
- L5 delegates to L4 via bridge modules (videoServiceBridge, analysisServiceBridge, pipelineServiceBridge).

```typescript
// ✅ Allowed — agent from L4
import { SilenceAgent } from '../../L4-agents/SilenceAgent.js'

// ✅ Allowed — config from L1 (foundation layer)
import logger from '../../L1-infra/config/logger.js'

// ❌ Blocked — L3 service (access through L4 agent tools)
import { transcribeVideo } from '../../L3-services/transcription/transcription.js'

// ❌ Blocked — L2 client
import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'

// ❌ Blocked — upward into L6
import { processVideo } from '../../L6-pipeline/processVideo.js'
```

## Key Patterns

- `VideoAsset` wraps a video file path with lazy-loaded properties (metadata, transcript, analysis)
- `loaders.ts` provides dynamic `import()` for heavy modules (agents) — avoids eager load
- All lazy loaders return a `Promise` — only loaded when first called
- Asset properties are populated incrementally as pipeline stages complete
- Use `readonly` on properties that shouldn't change after initial load

```typescript
// Lazy loader pattern
export async function loadSilenceAgent() {
  const { SilenceAgent } = await import('../../L4-agents/SilenceAgent.js')
  return SilenceAgent
}
```

## Testing

- Location: `__tests__/unit/L5-assets/`
- Mock L4 agents only — never mock L0 or L1
- Test lazy loading behavior (module loaded only on first call)
- Test VideoAsset property population and access patterns

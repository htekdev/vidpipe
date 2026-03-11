---
applyTo: "src/L4-agents/**/*.ts"
---

# L4 — Agents Layer

## Purpose

LLM agents that extend `BaseAgent` with tools for the video editing pipeline. Each agent encapsulates a specific editing task (silence removal, shorts planning, caption generation, etc.) and communicates with LLMs via the provider abstraction.

## Import Rules

- ✅ Can import: L0, L1, L3
- ❌ Cannot import: L2, L5, L6, L7
- ✅ `import type` from any layer is exempt
- LLM provider is obtained from L3-services/llm/providerFactory, not L2 directly.

```typescript
// ✅ Allowed — business logic from L3
import { extractClip } from '../../L3-services/video/clipExtractor.js'

// ✅ Allowed — LLM provider via L3
import { getProvider } from '../../L3-services/llm/providerFactory.js'

// ✅ Allowed — config from L1 (foundation layer)
import logger from '../../L1-infra/config/logger.js'

// ❌ Blocked — L2 client (even LLM providers — use L3 wrapper)
import { CopilotProvider } from '../../L2-clients/llm/CopilotProvider.js'

// ❌ Blocked — upward into L5
import { VideoAsset } from '../../L5-assets/VideoAsset.js'

// ❌ Blocked — upward into L6
import { runStage } from '../../L6-pipeline/runStage.js'
```

## Key Patterns

- All agents extend `BaseAgent` from `./BaseAgent.js`
- Constructor calls `super('AgentName', SYSTEM_PROMPT)`
- `getTools()` returns `Tool[]` — each tool has `name`, `description`, `parameters` (JSON Schema), `handler`
- `LLMProvider` injected via constructor — supports Copilot, OpenAI, Claude backends
- Agent lifecycle: always use `try/finally { agent.destroy() }`
- Tool handlers cast args: `async (args) => this.handleToolCall('name', args as Record<string, unknown>)`
- System prompts are `const SYSTEM_PROMPT = '...'` at module top

## Testing

- Location: `__tests__/unit/L4-agents/`
- Mock L3 services only — never mock L0 or L1
- Mock `LLMProvider` to control agent responses
- Test tool registration, tool handler logic, and prompt construction

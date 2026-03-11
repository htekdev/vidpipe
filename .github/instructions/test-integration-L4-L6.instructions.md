---
applyTo: "src/__tests__/integration/L4-L6/**/*.ts"
---

# L4–L6 Integration Tests — Agents, Assets, Pipeline with Mocked Clients

## Purpose

Test cross-layer integration (L4 agents → L5 assets → L6 pipeline) with mocked L2 external clients. L3 services run real but are not the primary coverage target.

## Coverage Scope: L4 + L5 + L6

## Mocking Rules

| Layer | Mock? | Why |
|-------|-------|-----|
| L0-pure | ❌ Real | Pure functions run as-is |
| L1-infra | ❌ Real | Real config, logger, file system |
| L2-clients | ✅ Mock | Control external API/process responses |
| L3-services | ❌ Real | Runs real but not measured — L3 coverage comes from L3 integration tests |
| L4–L6 | ❌ Real | These are the layers under test |

## Pattern

Mock L2 clients to return controlled responses. L3 services execute real but are not the coverage target — L4, L5, L6 are.

```typescript
vi.mock('../../../L2-clients/gemini/geminiClient.js', () => ({
  analyzeVideoEditorial: vi.fn(async () => 'Cut from 10s to 15s'),
}))
import { MainVideoAsset } from '../../../L5-assets/MainVideoAsset.js'
```

## What to Test

- Agent tool-call flows with fake LLM/external responses
- Pipeline stage sequencing with controlled stage outputs
- Asset lazy-loading and bridge delegation behavior
- L5 bridge modules calling through to L4 agents correctly

## Rules

- Only mock paths under `L2-clients/` — never mock L0, L1, or L3+
- Use `vi.hoisted()` for mock variables referenced in `vi.mock()` factories
- Mock the LLMProvider interface for agent tests (not the provider module)
- Verify tool call arguments passed to mocked L2 clients
- Clean up any files written by real L1 infrastructure in `afterAll`
- For agent tests, always call `agent.destroy()` in `afterEach` or `finally`

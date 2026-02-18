# Mockability Audit: LLM Provider Layer

> `src/providers/` — Interfaces, factory, and three provider implementations.

## Architecture Overview

The provider layer implements a classic **Strategy pattern** with constructor injection:

```
LLMProvider (interface)
├── CopilotProvider  → @github/copilot-sdk
├── OpenAIProvider   → openai SDK
└── ClaudeProvider   → @anthropic-ai/sdk
```

## Interfaces

### `LLMProvider` (types.ts:156–167)

```typescript
interface LLMProvider {
  readonly name: ProviderName
  createSession(config: SessionConfig): Promise<LLMSession>
  isAvailable(): boolean
  getDefaultModel(): string
  close?(): Promise<void>
}
```

Clean contract with no hidden state. `createSession()` is the only method with I/O. **Mockability: 10/10** — trivially implementable as a test double.

### `LLMSession` (types.ts:146–153)

```typescript
interface LLMSession {
  sendAndWait(message: string): Promise<LLMResponse>
  on(event: ProviderEventType, handler: (event: ProviderEvent) => void): void
  close(): Promise<void>
}
```

Three methods, all stateless from the caller's perspective. **Mockability: 10/10**.

### `LLMResponse` (types.ts:57–70)

Pure data object — `content`, `toolCalls`, `usage`, `cost`, `durationMs`. No behavior. **Mockability: 10/10**.

## Factory: `getProvider()` (index.ts:24–58)

```typescript
let currentProvider: LLMProvider | null = null  // module-level singleton
export function getProvider(name?: ProviderName): LLMProvider { ... }
```

| Aspect | Detail |
|--------|--------|
| Singleton | Module-scoped `currentProvider` cached between calls |
| Side effects | Reads `getConfig().LLM_PROVIDER`, logs via `logger` |
| Reset hook | `resetProvider()` exported for testing |
| Mockability | **6/10** — must use `vi.mock()` to replace, or inject provider directly into agents |

The `resetProvider()` function is a good testing affordance, but the factory itself can't be replaced without module mocking because it's imported as a function, not injected.

## Provider Implementations

### CopilotProvider

| Aspect | Detail |
|--------|--------|
| External I/O | `@github/copilot-sdk` (CopilotClient, subprocess) |
| Singleton | `this.client` lazily created, reused across sessions |
| State | CopilotSessionWrapper tracks usage events internally |
| Mockability | **5/10** — CopilotClient spawns subprocesses; must mock `@github/copilot-sdk` entirely |

### OpenAIProvider

| Aspect | Detail |
|--------|--------|
| External I/O | `openai` SDK HTTP calls |
| Singleton | No — creates new `OpenAI()` client per session |
| State | OpenAISession maintains full message history |
| Dependencies | `calculateTokenCost()`, `getConfig().OPENAI_API_KEY`, `logger` |
| Mockability | **6/10** — client created inside `createSession`, no injection point for the HTTP client |

### ClaudeProvider

| Aspect | Detail |
|--------|--------|
| External I/O | `@anthropic-ai/sdk` HTTP calls |
| Singleton | No — creates new `Anthropic()` client per session |
| State | ClaudeSession maintains message history |
| Dependencies | `calculateTokenCost()`, `getConfig().ANTHROPIC_API_KEY`, `logger` |
| Mockability | **6/10** — same pattern as OpenAIProvider |

## Key Findings

1. **LLMProvider interface is the primary DI boundary.** Agents accept `provider?: LLMProvider` in their constructor, so tests can inject a mock provider without touching the factory at all. This is the recommended mock point.

2. **`getProvider()` is a cached singleton** that reads config and logs. Testing code that calls `getProvider()` directly requires either `vi.mock('../providers/index.js')` or calling `resetProvider()` in `beforeEach`.

3. **Individual providers have no injection point for their SDK clients.** `new OpenAI()` and `new Anthropic()` are called inside `createSession()`. To test provider internals, you must mock the SDK module.

4. **`resetProvider()` is an explicit test affordance** — good pattern, but only helps when testing the factory itself.

## Mockability Scorecard

| Component | Score | Reason |
|-----------|-------|--------|
| LLMProvider interface | 10/10 | Pure contract, trivially mockable |
| LLMSession interface | 10/10 | Three simple methods |
| LLMResponse type | 10/10 | Data-only, no behavior |
| getProvider() factory | 6/10 | Module singleton, needs vi.mock() or DI bypass |
| CopilotProvider | 5/10 | Subprocess-based SDK, heavy mocking needed |
| OpenAIProvider | 6/10 | No client injection, but simpler than Copilot |
| ClaudeProvider | 6/10 | Same pattern as OpenAI |

## Recommendation

Always mock at the **LLMProvider interface level** in agent tests — never mock individual provider internals unless specifically testing provider behavior. The constructor injection pattern in BaseAgent makes this straightforward.

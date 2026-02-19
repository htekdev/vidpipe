---
applyTo: "src/__tests__/unit/L4-*/**/*.ts"
---
# Unit Tests — L4 (Agents)

## Mocking Rules

- ✅ Can mock **L3 service paths only** (`vi.mock('../../../../src/L3-services/...')`).
- ❌ Cannot mock L0-L2 or L4+ paths.
- **LLMProvider is injected** via constructor — create a mock provider object, don't `vi.mock()` it.

## What to Test

- Agent tool handler logic (the `handler` functions returned by `getTools()`)
- Agent construction and system prompt composition
- Prompt generation utilities
- Tool argument validation

## Pattern

Create a mock `LLMProvider`, instantiate the agent, then test tool handlers directly.

```typescript
import { vi, describe, test, expect } from 'vitest'
import type { LLMProvider } from '../../../../src/L0-pure/types/index.js'

const mockProvider: LLMProvider = {
  createSession: vi.fn().mockResolvedValue({
    sendMessage: vi.fn().mockResolvedValue({ content: '{}', toolCalls: [] }),
    destroy: vi.fn(),
  }),
  name: 'mock',
}

vi.mock('../../../../src/L3-services/costTracking/costTracker.js', () => ({
  costTracker: { recordCall: vi.fn() },
}))

import { SummaryAgent } from '../../../../src/L4-agents/SummaryAgent.js'

describe('SummaryAgent', () => {
  test('registers expected tools', () => {
    const agent = new SummaryAgent(mockProvider)
    const tools = agent['getTools']()
    expect(tools.map(t => t.name)).toContain('write_summary')
  })
})
```

## Checklist

- [ ] Every `vi.mock()` path contains `/L3-services/` — nothing else
- [ ] LLMProvider is a hand-crafted mock object, not `vi.mock()`'d
- [ ] Agent is destroyed in `afterEach` or `finally`

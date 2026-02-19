# Copilot Hooks

> Automated enforcement of vidpipe's L0–L7 layered architecture via GitHub Copilot pre/post tool-use hooks.

These hooks run **before** or **after** every Copilot tool call (edit, create, bash, powershell). They inspect the proposed change and return `deny` if it violates the architecture rules. All hooks are **fail-open** — if the hook script itself errors, the tool call proceeds.

---

## 1. Overview

vidpipe uses an eight-layer architecture (L0-pure → L7-app) where imports flow strictly downward. Two hooks enforce this at authoring time:

| Hook | Phase | Purpose |
|------|-------|---------|
| **pre-layer-import** | `preToolUse` | Blocks upward imports and L0 builtins |
| **pre-layer-mock** | `preToolUse` | Blocks incorrect `vi.mock()` usage in tests |
| **pre-push-block** | `preToolUse` | Blocks `git push` — must use `npm run push` |
| **pre-amend-block** | `preToolUse` | Blocks `git commit --amend` when HEAD is already pushed |
| **pre-force-push-block** | `preToolUse` | Blocks `git push --force` / `--force-with-lease` |
| **post-edit-invalidate** | `postToolUse` | Deletes `.github/reviewed.md` when code is edited |

The layer hooks only fire on `edit` and `create` tool calls for `.ts` / `.js` files. The git hooks fire on `bash` and `powershell` tool calls.

---

## 2. Layer Import Rules (`pre-layer-import`)

This hook enforces four rules on every `edit` or `create` of a `.ts`/`.js` file inside `src/L{N}-*`.

### 2.1 Rules

| # | Rule | Description |
|---|------|-------------|
| 1 | **No upward imports** | Layer N cannot import from layer N+1 or higher. L2 may import L0, L1 — never L3+. |
| 2 | **L0 builtins ban** | L0-pure cannot import Node.js builtins (`node:fs`, `path`, `child_process`, etc.). L0 must be pure — no I/O. |
| 3 | **L4/L5/L6→L2 skip ban** | Layers 4–6 must not import directly from L2-clients. Access L2 functionality through L3-services instead. |
| 4 | **Dynamic imports** | `import('...')` follows the same rules as static `import ... from '...'`. |

### 2.2 Import Direction Matrix

| Source → Target | L0 | L1 | L2 | L3 | L4 | L5 | L6 | L7 |
|-----------------|----|----|----|----|----|----|----|----|
| **L0** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L1** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L2** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **L3** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **L4** | ✅ | ✅ | ⚠️¹ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **L5** | ✅ | ✅ | ⚠️¹ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **L6** | ✅ | ✅ | ⚠️¹ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **L7** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

> ¹ L4/L5/L6→L2 is blocked (skip-layer ban) — must go through L3 services. Exception: `BaseAgent.ts` → `L2-clients/llm/` is allowed.

### 2.3 Exemptions

| Exemption | Pattern | Rationale |
|-----------|---------|-----------|
| **Type-only imports** | `import type { Foo } from '...'` | Erased at compile time — no runtime coupling |
| **Type-only re-exports** | `export type { Foo } from '...'` | Erased at compile time — no runtime coupling |
| **Test files** | Any file under `__tests__/` | Tests need to import subjects from any layer |
| **BaseAgent→LLM** | `BaseAgent.ts` importing from `L2-clients/llm/` | Provider abstraction is a core L4 dependency |

### 2.4 L0 Banned Builtins

The following Node.js modules are banned in L0-pure (both `node:` prefixed and bare):

```
assert, buffer, child_process, cluster, console, crypto, dgram, dns,
events, fs, http, http2, https, net, os, path, perf_hooks, process,
readline, stream, string_decoder, timers, tls, tty, url, util, v8,
vm, worker_threads, zlib
```

### 2.5 Examples

```typescript
// ✅ L3-services importing from L2-clients (downward)
import { whisperClient } from '../../L2-clients/whisper/whisperClient.js'

// ❌ L2-clients importing from L3-services (upward — BLOCKED)
import { costTracker } from '../../L3-services/costTracking/costTracker.js'

// ✅ Type-only import crosses any boundary (EXEMPT)
import type { Transcript } from '../../L0-pure/types/index.js'

// ✅ Type-only re-export crosses any boundary (EXEMPT)
export type { LLMProvider } from '../../L2-clients/llm/types.js'

// ❌ L0-pure importing Node.js builtins (BLOCKED)
import { readFileSync } from 'node:fs'

// ❌ L5-assets importing directly from L2-clients (skip-layer — BLOCKED)
import { extractClip } from '../../L2-clients/ffmpeg/clipExtraction.js'

// ✅ BaseAgent.ts importing from L2-clients/llm/ (EXEMPT)
import { CopilotProvider } from '../../L2-clients/llm/CopilotProvider.js'

// ❌ Dynamic import follows the same rules (BLOCKED)
const mod = await import('../../L3-services/costTracker.js') // from L2 file
```

---

## 3. Test Mocking Rules (`pre-layer-mock`)

This hook enforces what `vi.mock()` calls are allowed based on the test file's location.

### 3.1 Unit Tests (`__tests__/unit/L{N}/`)

| Layer | Allowed `vi.mock()` Targets | Denied `vi.mock()` Targets |
|-------|----------------------------|---------------------------|
| **L0** | ❌ None — no `vi.mock()` allowed at all | Everything |
| **L1** | Node.js builtins only (bare imports) | Any layer-path mock (`/L{N}-`) |
| **L2** | External APIs/processes only (bare imports) | Any layer-path mock (`/L{N}-`) |
| **L3** | L2 layer paths only | L0, L1, L3, L4, L5, L6, L7 layer paths |
| **L4** | L3 layer paths only | L0, L1, L2, L4, L5, L6, L7 layer paths |
| **L5** | L4 layer paths only | L0, L1, L2, L3, L5, L6, L7 layer paths |
| **L6** | L5 layer paths only | L0, L1, L2, L3, L4, L6, L7 layer paths |
| **L7** | L6 layer paths only | L0, L1, L2, L3, L4, L5, L7 layer paths |

**Rule:** In unit tests, you may only mock the layer directly below (L{N-1}). L0 has no layer below — no mocking at all. L1 and L2 have no layer-path mocks — they mock builtins and external APIs respectively (bare imports without `/L{N}-` paths).

### 3.2 Integration Tests (`__tests__/integration/`)

| Workspace | Allowed `vi.mock()` Targets | Denied `vi.mock()` Targets |
|-----------|----------------------------|---------------------------|
| **L3/** | L0, L1 layer paths | L2, L3, L4, L5, L6, L7 layer paths |
| **L4-L6/** | L2 layer paths only | L0, L1, L3, L4, L5, L6, L7 layer paths |
| **L7/** | L1, L2, L3 layer paths | L0, L4, L5, L6, L7 layer paths |

### 3.3 E2E Tests (`__tests__/e2e/`)

**No `vi.mock()` allowed at all.** Any occurrence of `vi.mock(` in an E2E test file is denied. Everything runs with real dependencies.

---

## 4. Third-Party Mocks

Bare imports (those without `/L{N}-` path segments) are **not policed** by the layer-mock hook. This means third-party and Node.js builtin mocks like these are allowed in most test contexts:

```typescript
// ✅ Allowed in unit L1+ and integration tests
vi.mock('node:child_process')
vi.mock('openai')
vi.mock('sharp')
vi.mock('@google/generative-ai')
```

**Exceptions:**
- **E2E tests:** All `vi.mock()` is denied, including third-party
- **L0 unit tests:** All `vi.mock()` is denied — L0 is pure, no dependencies to mock

---

## 5. Known Limitations

### Multi-line imports with `from` on a separate line

The import hook checks each line independently. If `import type` is on one line and `from '...'` is on the next, the `from` line is not recognized as type-only:

```typescript
// ⚠️ NOT recognized as type-only by the hook (may false-positive)
import type { Transcript }
  from '../../L3-services/types.js'

// ✅ Use single-line form instead
import type { Transcript } from '../../L3-services/types.js'
```

### Inline type annotations not exempted

The hook only exempts `import type { ... }` (statement-level). The inline form `import { type Foo }` is **not** exempted and will be checked against layer rules:

```typescript
// ❌ NOT exempted — will trigger layer check
import { type Foo, bar } from '../../L5-assets/foo.js'

// ✅ Split into separate imports
import type { Foo } from '../../L5-assets/foo.js'
import { bar } from '../../L3-services/bar.js'
```

### Global `setup.ts` auto-mocks logger for all projects

The vitest global `setup.ts` file auto-mocks the Winston logger (`L1-infra`) for **all** test projects, including E2E. The `pre-layer-mock` hook cannot police vitest `setupFiles` since they run at runtime, not through Copilot tool calls.

**Workaround:** If E2E tests must use the real logger, split `setup.ts` into per-project setup files.

### Multi-line `vi.mock()` calls

The mock hook handles multi-line `vi.mock()` calls:
- **PowerShell version:** Uses `[regex]::Matches()` with `\s` matching across newlines
- **Bash version:** Flattens content with `tr '\n' ' '` before regex extraction

---

## 6. Hook Registration

All hooks are registered in `.github/hooks/hooks.json`. Each hook provides both `.ps1` (Windows) and `.sh` (macOS/Linux) implementations.

### `hooks.json` Structure

```jsonc
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": ".github/hooks/<hook-name>.sh",
        "powershell": ".github/hooks/<hook-name>.ps1",
        "cwd": ".",
        "timeoutSec": 5,
        "comment": "Description of what the hook does"
      }
    ],
    "postToolUse": [
      // Same structure — runs AFTER the tool call
    ]
  }
}
```

### Hook Input/Output Protocol

**Input:** Hooks receive JSON on stdin with the tool name and arguments:

```json
{
  "toolName": "edit",
  "toolArgs": "{\"path\": \"src/L2-clients/foo.ts\", \"new_str\": \"import ...\"}"
}
```

**Output (deny):** To block a tool call, write a JSON object to stdout:

```json
{"permissionDecision": "deny", "permissionDecisionReason": "Explanation shown to user"}
```

**Output (allow):** Exit with code 0 and no stdout JSON → tool call proceeds.

**Error handling:** All hooks are fail-open. If the script throws, it catches the error, logs to stderr, and exits 0 (allowing the tool call).

### Registered Hooks

| Phase | Hook | Triggers On |
|-------|------|-------------|
| `preToolUse` | `pre-push-block` | `bash`, `powershell` commands containing `git push` |
| `preToolUse` | `pre-amend-block` | `bash`, `powershell` commands containing `git commit --amend` (only when HEAD is pushed) |
| `preToolUse` | `pre-force-push-block` | `bash`, `powershell` commands containing `git push --force` |
| `preToolUse` | `pre-layer-import` | `edit`, `create` on `.ts`/`.js` files in `src/L{N}-*` |
| `preToolUse` | `pre-layer-mock` | `edit`, `create` on `.ts`/`.js` files in `__tests__/` |
| `postToolUse` | `post-edit-invalidate` | `edit`, `create` (deletes `.github/reviewed.md` to invalidate code reviews) |

---

## 7. Test Directory Structure

The test directory layout determines which mocking rules apply:

```
src/__tests__/
├── unit/
│   ├── L0-pure/           — No vi.mock() allowed (pure functions)
│   ├── L1-infra/          — Mock Node.js builtins only (bare imports)
│   ├── L2-clients/        — Mock external APIs only (bare imports)
│   ├── L3-services/       — Mock L2 layer paths only
│   ├── L4-agents/         — Mock L3 layer paths only
│   ├── L5-assets/         — Mock L4 layer paths only
│   ├── L6-pipeline/       — Mock L5 layer paths only
│   └── L7-app/            — Mock L6 layer paths only
├── integration/
│   ├── L3/                — Mock L0/L1 infrastructure only
│   ├── L4-L6/             — Mock L2 external clients only
│   └── L7/                — Mock L1–L3 (infra + services) only
└── e2e/                   — No vi.mock() allowed (everything real)
```

### Vitest Workspace Commands

```bash
npx vitest --project unit                # All unit tests (L0–L7)
npx vitest --project integration-L3      # L3 integration
npx vitest --project integration-L4-L6   # L4-L6 integration
npx vitest --project integration-L7      # L7 integration
npx vitest --project e2e                 # End-to-end (real FFmpeg, real I/O)
```

---

## 8. Quick Reference

### "Can I import X from Y?"

1. Is it `import type`? → **Always allowed**
2. Is the file in `__tests__/`? → **Always allowed** (import hook is exempt)
3. Is source layer ≥ target layer? → **Allowed** (downward import)
4. Is source L4–L6 and target L2? → **Blocked** unless `BaseAgent.ts` → `L2-clients/llm/`
5. Is source L0 and target is a Node.js builtin? → **Blocked**

### "Can I mock X in this test?"

1. Is the test in `__tests__/e2e/`? → **No mocking allowed**
2. Is the test in `__tests__/unit/L0-pure/`? → **No mocking allowed**
3. Is the mock target a bare import (no `/L{N}-`)? → **Allowed** (except E2E and L0)
4. Is the mock target a layer path? → Check the tables in sections 3.1 and 3.2

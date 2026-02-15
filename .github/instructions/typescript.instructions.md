---
applyTo: "**/*.ts"
---

# TypeScript Best Practices

## Module System — ESM Only

- This project uses `"type": "module"` — all code is ESM.
- **All runtime imports MUST use `.js` extensions** (e.g., `import { foo } from './utils.js'`). TypeScript's `bundler` moduleResolution resolves `.js` → `.ts` at compile time.
- Type-only imports (`import type { ... }`) do not need `.js` extensions.
- Never use `require()` or CommonJS patterns.
- Use `import.meta.dirname` instead of `__dirname` and `import.meta.filename` instead of `__filename`.

## Strict TypeScript

- `strict: true` is enabled — never use `// @ts-ignore` or `// @ts-nocheck`.
- Prefer `unknown` over `any`. The only acceptable `any` is in JSON-parsed LLM tool call argument signatures.
- Use explicit return types on exported functions.
- Use `satisfies` for type-safe object literals when the type has a known shape.
- Use discriminated unions over optional fields when modeling state variants.

## Type Conventions

- All domain types live in `src/types/index.ts` — import from there, don't redeclare.
- Prefer `interface` for object shapes that may be extended. Use `type` for unions, intersections, and mapped types.
- Avoid enums for new code — use `as const` objects or string literal unions instead. The existing `PipelineStage` enum is the exception.
- Use `readonly` on properties that should not be mutated after construction.

## Error Handling

- Pipeline stages: errors are caught by `runStage()` — don't add redundant try/catch inside stage logic unless cleanup is needed.
- Agents: always use try/finally with `agent.destroy()`.
- FFmpeg operations: reject the Promise with the stderr message from `execFile`.
- Cleanup operations that may fail: use `.catch(() => {})`.
- Never swallow errors silently — at minimum, log them with `logger.error()`.

## Async Patterns

- Prefer `async`/`await` over raw Promises and `.then()` chains.
- Use `Promise.all()` for independent concurrent operations.
- Never use `void` to fire-and-forget async calls — always `await` or handle the Promise.
- When wrapping callback-based APIs (like `execFile`), use `new Promise<T>()` with proper reject on error.

## Imports & Organization

- Group imports: Node.js builtins → third-party packages → project modules.
- Use the Winston logger singleton: `import logger from '../config/logger.js'`.
- Use lazy-loaded config: `import { getConfig } from '../config/environment.js'`.
- Use brand config: `import { getBrandConfig } from '../config/brand.js'`.

## Functions & Parameters

- Keep functions small and focused — one responsibility per function.
- Prefer named parameters via an options object when a function takes more than 3 parameters.
- Use `readonly` arrays in parameter types when the function doesn't mutate them.
- Avoid default exports for non-singleton modules — use named exports.

## Naming

- **Files:** `camelCase.ts` for modules, `PascalCase.ts` for classes/agents.
- **Variables/functions:** `camelCase`.
- **Types/interfaces/classes:** `PascalCase`.
- **Constants:** `UPPER_SNAKE_CASE` for true compile-time constants, `camelCase` for runtime values.
- **Boolean variables:** prefix with `is`, `has`, `should`, `can` (e.g., `isEdited`, `hasWebcam`).

## Testing

- Tests live in `src/__tests__/` (unit) and `src/__tests__/integration/` (integration).
- Every bug fix MUST include a regression test.
- Unit tests mock external I/O (`execFile`, `fs`, `sharp`, `openai`, `exa-js`) — test real source functions, not mock reimplementations.
- Use `vi.hoisted()` for mock variables used in `vi.mock()` factories (Vitest ESM requirement).
- Use `describe.skipIf()` for tests that require optional external dependencies like FFmpeg.

## FFmpeg & Child Processes

- Always use `execFile()` (not `exec()`) for safety — no shell injection.
- Resolve FFmpeg/FFprobe paths through `src/config/ffmpegResolver.ts` — never hardcode.
- Set `maxBuffer: 50 * 1024 * 1024` for FFmpeg calls that produce large stderr output.

## Defensive Coding — Don't Overdo It

- Only validate at system boundaries (user CLI input, external API responses, file I/O).
- Trust internal function contracts — don't re-validate data passed between internal modules.
- Don't add error handling for conditions that can't occur.
- Don't add fallback behavior "just in case" — if something fails unexpectedly, let it throw.

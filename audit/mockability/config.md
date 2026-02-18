# Mockability Audit: Config Layer

> `src/config/` and related `src/core/` files — Environment, brand, model selection, pricing, logging.

## environment.ts

```typescript
import { loadEnvFile } from '../core/env.js'

// Side effect on import — loads .env file
const envPath = join(process.cwd(), '.env')
if (fileExistsSync(envPath)) {
  loadEnvFile(envPath)
}

let config: AppEnvironment | null = null  // module-level singleton

export function initConfig(cli: CLIOptions = {}): AppEnvironment { ... }
export function getConfig(): AppEnvironment {
  if (config) return config
  return initConfig()  // lazy fallback
}
```

| Aspect | Detail |
|--------|--------|
| Import side effect | `.env` file loaded at module parse time |
| Pattern | Lazy singleton with `initConfig()` / `getConfig()` |
| State | Module-level `config` variable, set once |
| Mockability | **5/10** — Import side effect + singleton. Tests must `vi.mock()` or call `initConfig()` with controlled values |

The `.env` loading on import means any test importing `environment.ts` (even transitively) will trigger file system access. All test files mock this: `vi.mock('../config/environment.js', () => ({ getConfig: mockGetConfig }))`.

## brand.ts

```typescript
let cachedBrand: BrandConfig | null = null  // module-level cache

export function getBrandConfig(): BrandConfig {
  if (cachedBrand) return cachedBrand
  const config = getConfig()           // depends on environment.ts
  const raw = readTextFileSync(brandPath)  // sync file read
  cachedBrand = JSON.parse(raw)
  return cachedBrand
}
```

| Aspect | Detail |
|--------|--------|
| Pattern | Lazy singleton with file I/O on first call |
| Dependencies | `getConfig()` (for BRAND_PATH), `readTextFileSync()`, `fileExistsSync()` |
| State | Cached after first read, never invalidated |
| Mockability | **5/10** — Must mock both `getConfig` and `fileSystem` to control, or mock the module |

Tests mock this at module level: `vi.mock('../config/brand.js', () => ({ getBrandConfig: () => ({ ... }) }))`.

## modelConfig.ts

```typescript
export const PREMIUM_MODEL = 'claude-opus-4.5'
export const STANDARD_MODEL = 'claude-sonnet-4.5'
export const FREE_MODEL = 'gpt-4.1'

export const AGENT_MODEL_MAP: Record<string, string> = {
  SilenceRemovalAgent: PREMIUM_MODEL,
  ShortsAgent: PREMIUM_MODEL,
  // ...
}

export function getModelForAgent(agentName: string): string | undefined {
  const envKey = `MODEL_${agentName.replace(...).toUpperCase()}`
  const envOverride = process.env[envKey]
  if (envOverride) return envOverride
  return AGENT_MODEL_MAP[agentName] ?? getConfig().LLM_MODEL ?? undefined
}
```

| Aspect | Detail |
|--------|--------|
| Pattern | Constants + lookup function |
| Dependencies | `process.env` (for per-agent overrides), `getConfig()` (for global model) |
| State | Constants are immutable; function reads env each call |
| Mockability | **8/10** — Constants are importable, function has simple inputs/outputs |

`AGENT_MODEL_MAP` and model constants can be imported directly in tests. `getModelForAgent()` depends on `process.env` and `getConfig()` but the logic is trivial.

## pricing.ts

```typescript
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPer1M: 2.50, outputPer1M: 10.00, ... },
  // ... 20+ models
}

export function calculateTokenCost(model, inputTokens, outputTokens): number { ... }
export function calculatePRUCost(model): number { ... }
export function getModelPricing(model): ModelPricing | undefined { ... }
```

| Aspect | Detail |
|--------|--------|
| Pattern | Static data + pure functions |
| Dependencies | None — zero imports beyond types |
| State | Immutable constant `MODEL_PRICING` |
| Mockability | **10/10** — Pure functions with no side effects |

Tested directly in `providers.test.ts` with no mocks — just input/output assertions. Gold standard.

## logger.ts (config)

```typescript
// Re-export from core
export { default, sanitizeForLog, setVerbose, pushPipe, popPipe } from '../core/logger.js'
```

### core/logger.ts

```typescript
const logger = winston.createLogger({
  level: 'info',
  format: LOG_FORMAT,
  transports: [new winston.transports.Console()],
})

export default logger
```

| Aspect | Detail |
|--------|--------|
| Pattern | Module-level singleton, created eagerly on import |
| Side effects | Winston transport creation, console output |
| Mockability | **4/10** — Every test must `vi.mock('../config/logger.js')` |

The logger is the most-mocked module in the codebase. Every test file includes:
```typescript
vi.mock('../config/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  pushPipe: vi.fn(),
  popPipe: vi.fn(),
}))
```

## ffmpegResolver.ts (config)

```typescript
// Re-exports from core/ffmpeg.ts
export { getFFmpegPath, getFFprobePath } from '../core/ffmpeg.js'
```

The actual resolution in `core/ffmpeg.ts` uses `createRequire()` and `existsSync()` at call time (not import time). **Mockability: 6/10** — must mock `core/ffmpeg.js`.

## Key Findings

1. **`environment.ts` has import-time side effects** — `.env` loading runs when the module is first imported. This is a testability hazard: any transitive import chain pulls in file system access.

2. **`pricing.ts` and `modelConfig.ts` are the most testable** — pure/static data with simple lookup functions. No mocking needed.

3. **`brand.ts` caches its singleton forever** — no `resetBrand()` or invalidation mechanism. Tests must mock the module.

4. **Logger is a universal test boilerplate tax** — every test file pays 4 lines of mock setup. A shared Vitest setup file could eliminate this.

5. **Config getters (`getConfig`, `getBrandConfig`) return plain objects** — the data itself is mockable, but the singleton caching prevents per-test customization without full module mocking.

## Mockability Scorecard

| Module | Score | Reason |
|--------|-------|--------|
| pricing.ts | 10/10 | Pure functions + static data |
| modelConfig.ts | 8/10 | Constants + simple lookup |
| environment.ts | 5/10 | Import side effect + lazy singleton |
| brand.ts | 5/10 | Lazy singleton + file I/O + no reset |
| ffmpegResolver.ts | 6/10 | Runtime resolution via require() |
| logger.ts | 4/10 | Eager singleton, mocked in every test |

## Recommendation

1. Move `.env` loading behind a lazy call (e.g., inside `initConfig()`) to eliminate the import side effect.
2. Add `resetBrandConfig()` test affordance to `brand.ts`, similar to `resetProvider()`.
3. Create a shared Vitest setup file that auto-mocks `logger` to eliminate per-test boilerplate.

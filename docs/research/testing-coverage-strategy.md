# Testing & Coverage Strategy

## Overview

vidpipe maintains comprehensive test coverage across its 15-stage pipeline, 8 agents, EDL system, and FFmpeg tools. The project uses Vitest with `@vitest/coverage-v8` and enforces coverage thresholds on every push.

## Coverage Thresholds

| Metric | Threshold | Current |
|--------|-----------|---------|
| Statements | 70% | 73.55% |
| Branches | 64% | 64.14% |
| Functions | 70% | 78.07% |
| Lines | 70% | 73.74% |

These thresholds are enforced by `npm run push` (via `cicd/push.ts`). A push cannot proceed if any threshold fails.

## Test Architecture

### Test Types

| Type | Location | Purpose |
|------|----------|---------|
| **Unit tests** | `src/__tests__/*.test.ts` | Mock external I/O, test real source functions |
| **Integration tests** | `src/__tests__/integration/*.test.ts` | Real FFmpeg against test videos |
| **Compiler tests** | `src/__tests__/edl/*.test.ts` | EDL compilation verification |
| **Asset tests** | `src/__tests__/assets/*.test.ts` | Video asset lazy loading, caching, type safety |
| **Service tests** | `src/__tests__/services/*.test.ts` | Queue building, scheduling, content strategy |

### Test Files (34 total)

#### Core Pipeline Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `pipeline.test.ts` | ~20 | Stage execution, error isolation, transcript adjustment |
| `utilities.test.ts` | ~15 | Brand config, logger, environment, Whisper prompt |
| `providers.test.ts` | 57 | Pricing, cost tracker, provider factory, platform mapping |

#### Agent Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `agents.test.ts` | ~30 | SilenceRemoval, Shorts, Medium, Chapter, Summary, Social, Blog agents |

#### EDL System Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `edl/effectTools.test.ts` | 15 | Text overlay position mapping, highlight region coords, slow motion speed |
| `edl/layoutTools.test.ts` | 14 | All 5 layout tools with param variants |
| `edl/transitionTools.test.ts` | 12 | All 4 transition tools with duration/direction |
| `edl/typeGuards.test.ts` | 12 | Type guard functions, default param constants |
| `edl/compiler.test.ts` | 21 | Full compilation, all effect types, animations, b-roll, fade-to-black |

#### Asset Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `assets/VideoAsset.test.ts` | 25 | Metadata, transcript, chapters, captions, force reload, error paths |
| `assets/BlogAsset.test.ts` | 15 | Blog loading, frontmatter, content, missing file |
| `assets/ShortVideoAsset.test.ts` | 12 | Constructor, variants, social posts, composite transcripts |
| `assets/MediumClipAsset.test.ts` | 7 | Constructor, error paths, social posts |
| `assets/SocialPostAsset.test.ts` | 6 | Platform typing, content loading, missing file |
| `assets/SummaryAsset.test.ts` | 3 | Summary loading |

#### Core Module Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `core/fileSystem.test.ts` | ~10 | File read/write, exists, directory operations |
| `core/fileSystem-extra.test.ts` | 33 | Sync variants, streams, writeTextFile, removeDirectory, copyFontsToDir |
| `core/process.test.ts` | 10 | execCommand, execFileRaw, spawnCommand, execCommandSync |

#### Service Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `services/queueBuilder.test.ts` | 11 | Queue building, media resolution, frontmatter parsing, Instagram fallback |
| `services/platformContentStrategy.test.ts` | 13 | Platform media rules, content matrix |
| `services/scheduleConfig.test.ts` | ~10 | Schedule validation |

#### FFmpeg Tool Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `tools/agentTools.test.ts` | ~15 | Frame capture, drawRegions, video info, transcript reading |
| `ffmpeg.test.ts` | ~20 | Silence detection, clip extraction, audio extraction, caption burning |

#### Integration Tests
| File | Tests | What It Covers |
|------|-------|---------------|
| `integration/ffmpeg.test.ts` | ~15 | Real FFmpeg operations against test videos |
| `integration/captions.test.ts` | ~10 | Real caption generation + burning |
| `integration/portrait.test.ts` | ~8 | Real smart layout conversions |

## Mock Patterns

### ESM Module Mocking

Vitest ESM requires `vi.hoisted()` for mock variables used in `vi.mock()` factories:

```typescript
const mockExecFile = vi.hoisted(() => vi.fn())
vi.mock('../../core/process.js', () => ({
  execCommand: mockExecFile,
}))
```

### Asset Test Mocking

Asset tests require mocking `fileExistsSync` because `environment.ts` imports it at module level during test setup:

```typescript
vi.mock('../../core/fileSystem.js', () => ({
  fileExists: vi.fn(),
  readTextFile: vi.fn(),
  readJsonFile: vi.fn(),
  fileExistsSync: vi.fn().mockReturnValue(false),  // Required for environment.ts
  // ... other exports
}))
```

### Dynamic Import Pattern

Brand config tests use `vi.resetModules()` + dynamic `import()` to get fresh module instances with different mock data per test:

```typescript
beforeEach(() => {
  vi.resetModules()
  vi.mocked(readTextFileSync).mockReturnValue(JSON.stringify(partialBrand))
})

it('validates missing fields', async () => {
  const { getBrandConfig } = await import('../config/brand.js')
  const config = getBrandConfig()
  // Each test gets a fresh module with different mock data
})
```

### Integration Test Safety

Integration tests gracefully skip when FFmpeg is not available:

```typescript
const ffmpegOk = await checkFFmpeg()
describe.skipIf(!ffmpegOk)('integration tests', () => {
  // Only run when FFmpeg is installed
})
```

## Bug Fix Testing Convention

Every bug fix requires a regression test that:

1. **Reproduces the bug** — The test should fail without the fix
2. **Verifies the fix** — The test should pass with the fix
3. **Prevents regression** — The test becomes a permanent guard

### Test-First Review Fixes

When addressing code review feedback:

1. Write a failing test that exposes the issue
2. Verify the test fails
3. Implement the fix
4. Verify the test passes

## Coverage Exclusions

Provider SDK adapters are intentionally excluded from coverage:

- `CopilotProvider.ts` — Thin SDK wrapper requiring real Copilot API
- `OpenAIProvider.ts` — Thin SDK wrapper requiring real OpenAI API
- `ClaudeProvider.ts` — Thin SDK wrapper requiring real Anthropic API

These are declarative adapter code with no business logic worth unit testing.

## Push Pipeline

The `npm run push` command runs a comprehensive pre-push pipeline:

```
1. Pre-flight checks (reviewed.md exists, gh auth, clean working tree)
2. Type check (tsc --noEmit)
3. Tests (vitest run)
4. Coverage check (vitest run --coverage, verify thresholds)
5. Build (tsup)
6. Git push
7. CI gate polling (CodeQL, Copilot Code Review)
```

Failure at any step blocks the push. The developer must fix the issue and retry.

## Coverage Improvement Strategy

When coverage drops below thresholds, the most efficient approach targets:

1. **0% coverage files** — New files with no tests (highest ROI per test)
2. **Exported utility functions** — Pure functions with multiple branches
3. **Validation logic** — Config validation, frontmatter parsing, type normalization
4. **Error paths** — Exception branches in core modules

Branch coverage is typically the hardest threshold to meet, as it requires testing both sides of every conditional. Focus areas for branch improvement:
- Config validation with partial/missing data
- Platform normalization edge cases
- Frontmatter parsing with quoted values, null values, missing markers
- Error handling paths with non-standard error types

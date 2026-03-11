# Mockability Audit: Pipeline

> `src/pipeline.ts` — 15-stage video processing pipeline with error isolation.

## `runStage()` Pattern (lines 60–80)

```typescript
export async function runStage<T>(
  stageName: PipelineStage,
  fn: () => Promise<T>,
  stageResults: StageResult[],
): Promise<T | undefined> {
  costTracker.setStage(stageName)
  const start = Date.now()
  try {
    const result = await fn()
    stageResults.push({ stage: stageName, success: true, duration })
    return result
  } catch (err: unknown) {
    stageResults.push({ stage: stageName, success: false, error: message, duration })
    return undefined
  }
}
```

| Aspect | Detail |
|--------|--------|
| Pattern | Higher-order function wrapping async work |
| Dependencies | `costTracker.setStage()` (singleton), `logger` (singleton) |
| Side effects | Pushes to mutable `stageResults` array, sets cost tracker stage |
| Error handling | Catches all errors, returns `undefined` on failure |
| Mockability | **8/10** — Clean functional pattern, easy to test with a mock `fn` |

The existing test (`pipeline.test.ts`) imports and tests `runStage()` directly with mock functions. The `stageResults` accumulator is a plain array — no mocking needed.

## `adjustTranscript()` — Pure Function (lines 86–131)

```typescript
export function adjustTranscript(
  transcript: Transcript,
  removals: { start: number; end: number }[],
): Transcript { ... }
```

| Aspect | Detail |
|--------|--------|
| Pattern | Pure function — immutable input, new output |
| Dependencies | None — operates only on data types |
| Mockability | **10/10** — Fully testable with zero mocking |

Tested directly in `silenceRemoval.test.ts` with various input scenarios. No mocks. This is the ideal pattern.

## `processVideo()` — Pipeline Orchestrator (lines 159–481)

```typescript
export async function processVideo(videoPath: string): Promise<PipelineResult> {
  const stageResults: StageResult[] = []
  const cfg = getConfig()
  // 15 stages, each wrapped in runStage()
}
```

### Dependency Map

| Category | Dependencies |
|----------|-------------|
| Config | `getConfig()` — skip flags, output dirs |
| Agents | 7 agents (SilenceRemoval, Shorts, MediumVideo, Summary, Social, Blog, Chapter) |
| Services | `transcribeVideo()`, `generateCaptions()`, `buildPublishQueue()`, `commitAndPush()` |
| Tools | `burnCaptions()`, `singlePassEditAndCaption()` |
| Core | `fileSystem.js` (write, copy, ensure, exists, read), `paths.js`, `logger`, `costTracker` |
| Assets | `MainVideoAsset.ingest()`, `videoAsset.getEditorialDirection()` |

### Data Flow Between Stages

```
ingestion → video (VideoFile)
  → transcription → transcript
    → silence-removal → editedVideoPath, adjustedTranscript
      → captions → captions (file paths)
        → caption-burn → captionedVideoPath
      → shorts → shorts[] (uses adjusted transcript + edited video)
      → medium-clips → mediumClips[]
      → chapters → chapters[]
        → summary → summary (references shorts, chapters)
          → social-media → socialPosts[]
          → short-posts → more socialPosts
          → medium-clip-posts → more socialPosts
            → queue-build → publish-queue/ populated
          → blog → blogPost
            → git-push → committed
```

Stages use **immutable cascading data** — each stage receives the output of previous stages through local variables. No global mutable state is shared between stages (except `costTracker`).

### Conditional Execution

Stages are gated by config skip flags:
- `cfg.SKIP_SILENCE_REMOVAL`, `SKIP_SHORTS`, `SKIP_MEDIUM_CLIPS`, `SKIP_SOCIAL`, `SKIP_CAPTIONS`, `SKIP_VISUAL_ENHANCEMENT`, `SKIP_SOCIAL_PUBLISH`, `SKIP_GIT`

And by data availability:
- Shorts/medium clips require `transcript`
- Summary requires `downstreamTranscript`
- Social posts require `downstreamTranscript` AND `summary`
- Caption burn requires `captions` AND (ASS file exists)

**Mockability: 4/10** — `processVideo()` itself is an integration point. Testing it requires mocking 15+ modules. The existing test does exactly this with massive `vi.hoisted()` blocks.

## `processVideoSafe()` — Error Boundary (lines 521–538)

```typescript
export async function processVideoSafe(videoPath: string): Promise<PipelineResult | null> {
  await markPending(slug, videoPath)
  await markProcessing(slug)
  try {
    const result = await processVideo(videoPath)
    await markCompleted(slug)
    return result
  } catch (err) {
    await markFailed(slug, message)
    return null
  }
}
```

Wraps `processVideo()` with processing state tracking. **Mockability: 5/10** — adds `processingState` dependency.

## Key Findings

1. **`runStage()` is an excellent, testable pattern.** Clean higher-order function with simple contract. The only dependency is `costTracker.setStage()` which is a no-op for testing purposes.

2. **`adjustTranscript()` is a pure function** — fully testable with zero mocking. This is the gold standard for pipeline logic.

3. **`processVideo()` is necessarily hard to mock** — it's the integration point for 15 stages. The current test approach (mock every dependency via `vi.hoisted()` + `vi.mock()`) is correct but verbose (~60 lines of mock setup).

4. **Stages have implicit file-based contracts.** Stage 5 (caption burn) reads `.ass` files written by Stage 4. Stage 9 (summary) reads `clip-direction.md` written between stages. These file contracts are invisible in the function signatures.

5. **Global config dependency** (`getConfig()`) controls which stages run. Tests must provide a full config mock with all skip flags set correctly.

6. **Cost tracking is cross-cutting** — `costTracker` is set at each stage boundary via `costTracker.setStage()`. This is a side effect but doesn't affect correctness.

## Mockability Scorecard

| Component | Score | Reason |
|-----------|-------|--------|
| adjustTranscript() | 10/10 | Pure function, no deps |
| runStage() | 8/10 | Clean HOF, trivial deps |
| generateCostMarkdown() | 9/10 | Pure formatter |
| processVideoSafe() | 5/10 | Wraps processVideo + state tracking |
| processVideo() | 4/10 | 15+ module mocks, implicit file contracts |

## Recommendation

The pipeline is well-structured for what it does. Keep `adjustTranscript()` and `runStage()` as exported pure-ish functions. For `processVideo()`, continue with the current mock-everything approach but consider extracting stage logic into standalone functions that can be tested independently of the pipeline orchestrator.

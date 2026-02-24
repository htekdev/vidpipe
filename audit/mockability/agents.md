# Mockability Audit: Agent Layer

> `src/agents/` — BaseAgent and 9 agent subclasses.

## BaseAgent Pattern (BaseAgent.ts)

```typescript
abstract class BaseAgent {
  constructor(
    protected readonly agentName: string,
    protected readonly systemPrompt: string,
    provider?: LLMProvider,  // ← DI point
    model?: string,
  ) {
    this.provider = provider ?? getProvider()  // fallback to singleton
  }
}
```

### DI Analysis

| Aspect | Detail |
|--------|--------|
| Provider injection | Optional `LLMProvider` param — good DI, falls back to `getProvider()` |
| Model selection | Uses `getModelForAgent()` from modelConfig.ts |
| Cost tracking | Directly imports `costTracker` singleton |
| Logging | Directly imports `logger` singleton |
| Session lifecycle | Lazy creation via `provider.createSession()`, manual `destroy()` |
| Retry logic | Built-in 3-retry with exponential backoff for transient errors |

**Mockability of BaseAgent: 7/10** — Provider is injectable, but `costTracker` and `logger` are imported singletons requiring `vi.mock()`.

## Agent Subclasses

### SilenceRemovalAgent

| Tool | Side Effects |
|------|-------------|
| `decide_removals` | Pure — stores removals in agent state |

External deps called by wrapper function `removeDeadSilence()`:
- `detectSilence()` → FFmpeg subprocess
- `singlePassEdit()` → FFmpeg subprocess
- `ffprobe()` → FFmpeg subprocess

**Mockability: 6/10** — Tool handler is pure, but the orchestration function has heavy FFmpeg I/O.

### ShortsAgent

| Tool | Side Effects |
|------|-------------|
| `add_shorts` | Pure — accumulates planned shorts in array |
| `review_shorts` | Pure — returns current state |
| `finalize_shorts` | Heavy I/O — triggers clip extraction, caption generation, caption burning, platform variants |

External deps in `finalize_shorts`:
- `extractClip()` / `extractCompositeClip()` → FFmpeg
- `generateStyledASSForSegment()` → Pure function (caption text generation)
- `burnCaptions()` → FFmpeg
- `generatePlatformVariants()` → FFmpeg
- `writeTextFile()` / `writeJsonFile()` → File I/O

**Mockability: 5/10** — Planning tools are pure, but finalization triggers a cascade of FFmpeg operations.

### MediumVideoAgent

Same pattern as ShortsAgent with `add_medium_clips`, `review_medium_clips`, `finalize_medium_clips`.

**Mockability: 5/10** — Same issues as ShortsAgent.

### SocialMediaAgent

| Tool | Side Effects |
|------|-------------|
| `create_posts` | Light I/O — `writeTextFileSync()` to save posts |
| MCP: `web_search_exa` | External HTTP (via MCP server) |

**Mockability: 7/10** — Simple tool handlers, but MCP server connection adds complexity.

### BlogAgent

| Tool | Side Effects |
|------|-------------|
| `write_blog` | Light I/O — `writeTextFileSync()` |
| MCP: `web_search_exa` | External HTTP (via MCP server) |

**Mockability: 7/10** — Same as SocialMediaAgent.

### SummaryAgent

| Tool | Side Effects |
|------|-------------|
| `capture_frame` | FFmpeg subprocess — extracts frame at timestamp |
| `write_summary` | File I/O — writes README.md |

**Mockability: 6/10** — `capture_frame` requires FFmpeg mocking.

### ChapterAgent

| Tool | Side Effects |
|------|-------------|
| `write_chapters` | File I/O — writes 4 output files (JSON, timestamps, markdown, FFmpeg metadata) |

**Mockability: 8/10** — Single tool with only file writes. Output format generators are pure functions.

### GraphicsAgent

| Tool | Side Effects |
|------|-------------|
| `generate_enhancement` | `generateImage()` → HTTP API call (image generation), `sharp` image processing |
| `skip_opportunity` | Pure — logs only |

**Mockability: 5/10** — Image generation API + sharp processing.

### ProducerAgent

| Tool | Side Effects |
|------|-------------|
| `get_video_info` | Reads from VideoAsset (cached metadata) |
| `get_editorial_direction` | Reads from VideoAsset (may trigger Gemini API) |
| `get_transcript` | Reads from VideoAsset |
| `add_cuts` | Pure — accumulates removal decisions |
| `finalize_cuts` | `singlePassEdit()` → FFmpeg subprocess |

**Mockability: 6/10** — Most tools read cached data, but `finalize_cuts` triggers FFmpeg.

## Key Findings

1. **BaseAgent's optional `LLMProvider` parameter is the best DI point.** Tests can inject a mock provider that returns scripted `LLMResponse` objects, bypassing all LLM I/O.

2. **The real mockability bottleneck is tool handlers.** Even with a mock provider, tool handlers directly call FFmpeg, file system, and HTTP APIs. These must be mocked individually via `vi.mock()`.

3. **Planning vs. execution split exists in ShortsAgent and MediumVideoAgent.** The `add_*` and `review_*` tools are pure state accumulators — easy to test. The `finalize_*` tools trigger all side effects — hard to test.

4. **Existing test pattern (agents.test.ts) mocks the Copilot SDK** at the module level and captures tool registrations. This tests tool schemas but not tool execution.

## Mockability Scorecard

| Agent | Score | Bottleneck |
|-------|-------|-----------|
| ChapterAgent | 8/10 | File writes only |
| SocialMediaAgent | 7/10 | MCP server, file writes |
| BlogAgent | 7/10 | MCP server, file writes |
| SilenceRemovalAgent | 6/10 | FFmpeg via orchestration |
| SummaryAgent | 6/10 | FFmpeg frame capture |
| ProducerAgent | 6/10 | FFmpeg in finalize_cuts |
| ShortsAgent | 5/10 | FFmpeg cascade in finalize |
| MediumVideoAgent | 5/10 | FFmpeg cascade in finalize |
| GraphicsAgent | 5/10 | Image API + sharp |

## Recommendation

Test agents at two levels: (1) mock `LLMProvider` to verify prompt construction and tool schema registration, (2) mock individual tool dependencies (`vi.mock()` for FFmpeg, file I/O) to verify tool handler logic. Consider extracting `finalize_*` logic into separate testable functions.

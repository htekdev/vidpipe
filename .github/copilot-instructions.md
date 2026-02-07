# Copilot Instructions — video-auto-note-taker

## Project Overview

Automated video processing pipeline that watches a folder for new `.mp4` recordings, then runs a multi-stage pipeline: transcription → silence removal → caption generation → caption burning → short clip extraction → summary/README generation → social media posts → blog post → git commit & push.

**Tech stack:** Node.js, TypeScript (ES2022), ESM modules (`"type": "module"`), `@github/copilot-sdk` for AI agents, OpenAI Whisper for transcription, FFmpeg for all video/audio operations, Winston for logging, Chokidar for file watching, Exa for web search.

## Architecture

### Pipeline Stages (pipeline.ts)

```
ingest → transcribe → silence-removal → captions → caption-burn → shorts → summary → social-media → short-posts → blog → git-push
```

Each stage is wrapped in `runStage()` which catches errors and records timing. A stage failure does NOT abort the pipeline — subsequent stages proceed with whatever data is available.

### Agent Pattern (@github/copilot-sdk)

All AI agents extend `BaseAgent` (src/agents/BaseAgent.ts):

```typescript
class MyAgent extends BaseAgent {
  constructor() {
    super('MyAgent', SYSTEM_PROMPT)
  }

  protected getTools(): Tool<unknown>[] {
    return [{
      name: 'my_tool',
      description: '...',
      parameters: { /* JSON Schema */ },
      handler: async (args) => this.handleToolCall('my_tool', args as Record<string, unknown>),
    }]
  }

  protected async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // Process tool call, store results on the instance
    return { success: true }
  }
}
```

**Flow:** `CopilotClient` → `CopilotSession` (with system prompt + tools, streaming enabled) → `sendAndWait()` → LLM calls tools → agent stores structured results → caller reads them after `run()` completes → `destroy()` cleans up.

**Existing agents:**
- `SilenceRemovalAgent` — decides which silence regions to remove (tool: `decide_removals`)
- `ShortsAgent` — plans short clips from transcript (tool: `plan_shorts`)
- `SummaryAgent` — captures frames + writes README.md (tools: `capture_frame`, `write_summary`)
- `SocialMediaAgent` — generates posts for 5 platforms (tools: `search_links`, `create_posts`)
- `BlogAgent` — writes dev.to blog post (tools: `search_web`, `write_blog`)

### Service Layer (src/services/)

| Service | Purpose |
|---------|---------|
| `videoIngestion` | Copy video to `recordings/{slug}/`, extract metadata via ffprobe |
| `transcription` | Extract audio as MP3, send to Whisper, chunk if >25MB |
| `captionGeneration` | Generate SRT/VTT/ASS from transcript (no AI needed) |
| `fileWatcher` | Chokidar-based watcher for new .mp4 files, stability checks |
| `gitOperations` | `git add -A && git commit && git push` |
| `socialPosting` | Renders social posts as YAML frontmatter + markdown body |

### FFmpeg Tools Layer (src/tools/ffmpeg/)

| Tool | Purpose |
|------|---------|
| `silenceDetection` | Detect silence regions via `silencedetect` audio filter |
| `singlePassEdit` | Trim+setpts+concat filter_complex for frame-accurate cuts |
| `captionBurning` | Burn ASS subtitles into video (hard-coded subs) |
| `clipExtraction` | Extract single or composite clips with 1s buffer |
| `audioExtraction` | Extract MP3 (64kbps mono), split into chunks if needed |
| `frameCapture` | Capture PNG screenshot at a specific timestamp |

All FFmpeg tools use `execFile()` with `process.env.FFMPEG_PATH` (not shell commands). Set via `FFMPEG_PATH` / `FFPROBE_PATH` env vars.

## Coding Conventions

### Bug Fix Rule
Every bug fix **must** include a regression test — see [Bug Fix Testing Convention](#bug-fix-testing-convention) above.

### Module System
- ESM modules: `"type": "module"` in package.json
- TypeScript: ES2022 target, `bundler` moduleResolution
- All imports use `.ts` extensions — tsx handles resolution at runtime
- Run with `npx tsx src/index.ts`

### Imports & Logging
```typescript
import logger from './config/logger'    // Winston logger, singleton
import { getConfig } from './config/environment'  // Lazy-loaded, validated config
import { getBrandConfig } from './config/brand'   // Brand voice/vocabulary from brand.json
```

### Error Handling
- Pipeline stages: try/catch in `runStage()`, log error, continue to next stage
- Agents: try/finally with `agent.destroy()` to clean up CopilotClient
- FFmpeg: `execFile` callback → reject Promise with stderr message
- File operations: `.catch(() => {})` for cleanup operations that may fail

### Types
All domain types are in `src/types/index.ts`. Key types:
- `VideoFile` — ingested video metadata (slug, paths, duration)
- `Transcript` — Whisper output (segments with word-level timestamps)
- `ShortClip` — planned short with segments, output paths
- `SocialPost` — platform-specific post with YAML frontmatter
- `VideoSummary` — title, overview, keyTopics, snapshots
- `PipelineStage` — enum of all stage names
- `SilenceRemovalResult` — editedPath, removals, keepSegments
- `AgentResult<T>` — generic agent response wrapper

## Key Patterns

### Creating a New Agent

1. Create `src/agents/MyAgent.ts`
2. Extend `BaseAgent` with a system prompt
3. Define tools in `getTools()` with JSON Schema parameters
4. Implement `handleToolCall()` to process tool invocations and store results
5. Export a public async function that instantiates the agent, calls `run()`, reads results, calls `destroy()`

### Adding a New Pipeline Stage

1. Add enum value to `PipelineStage` in `src/types/index.ts`
2. Create the stage logic (service or agent)
3. Add to `processVideo()` in `src/pipeline.ts`, wrapped in `runStage()`
4. Add the result field to `PipelineResult` interface

### Using FFmpeg

```typescript
import { execFile } from 'child_process'
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg'

// Always use execFile (not exec) for safety
execFile(ffmpegPath, args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
  if (error) reject(new Error(`FFmpeg failed: ${stderr}`))
  else resolve(result)
})
```

### Caption Generation (ASS Format)

- **Montserrat Bold** is bundled in `assets/fonts/` — no system font installation needed. FFmpeg references the bundled font file directly.
- Word-by-word karaoke highlight using `\k` tags (OpusClips-style)
- Words grouped into 5-word display lines via `chunkWords()`
- `generateStyledASS()` — full video captions
- `generateStyledASSForSegment()` — single clip with buffer-adjusted timestamps
- `generateStyledASSForComposite()` — multi-segment composite with running offset

### Social Post File Format

YAML frontmatter + markdown body:
```markdown
---
platform: tiktok
status: draft
scheduledDate: null
hashtags:
  - "#GitHubCopilot"
links: []
characterCount: 142
videoSlug: "my-video"
createdAt: "2025-01-01T00:00:00.000Z"
---

Post content here...
```

## Important Technical Notes

### Windows ARM64 Compatibility
- `@ffmpeg-installer/ffmpeg` does NOT support Windows ARM64
- Must install FFmpeg system-wide (e.g., via winget) and set `FFMPEG_PATH` / `FFPROBE_PATH` in `.env`

### Whisper 25MB File Size Limit
- Audio extracted as MP3 at 64kbps mono to minimize size
- If audio >25MB, it's split into chunks via `splitAudioIntoChunks()`
- Chunk transcripts are merged with cumulative timestamp offsets

### ASS Subtitle Filter on Windows — Drive Letter Colon Issue
- FFmpeg's `ass=` filter parses `:` as an option separator
- Windows paths like `C:\path\captions.ass` break the filter
- **Solution:** Copy ASS file to a temp dir, set `cwd` to that dir, use relative filename `ass=captions.ass`
- Both `captionBurning.ts` and `singlePassEdit.ts` implement this pattern

### Single-Pass Edit (Frame-Accurate Cuts)
- `-c copy` (stream copy) snaps to keyframes → causes timestamp drift
- Instead: `trim+setpts+concat` filter_complex re-encodes for frame-accurate cuts
- `singlePassEditAndCaption()` combines silence removal + caption burning in one encode pass

### Brand Vocabulary
- `brand.json` defines custom vocabulary fed to Whisper's `prompt` parameter
- Improves transcription accuracy for domain-specific terms (e.g., "GitHub Copilot", "Copilot SDK")
- Also drives agent system prompts for consistent voice/tone in summaries, posts, blog

### Transcript Adjustment After Silence Removal
- `adjustTranscript()` in `pipeline.ts` shifts all timestamps by cumulative removed duration
- Adjusted transcript is used for caption generation (aligned to edited video)
- Original transcript is used for shorts (they reference original video timestamps)

## File Structure

```
video-auto-note-taker/
├── src/
│   ├── index.ts                    # CLI entry point (watch mode + --once mode)
│   ├── pipeline.ts                 # Pipeline orchestration, runStage(), adjustTranscript()
│   ├── types/index.ts              # All TypeScript interfaces and enums
│   ├── __tests__/
│   │   ├── *.test.ts               # Unit tests (mock external I/O)
│   │   └── integration/
│   │       ├── *.test.ts           # Integration tests (real FFmpeg)
│   │       ├── fixture.ts          # Synthetic test video generator
│   │       └── fixtures/           # Real speech video + transcript
│   ├── config/
│   │   ├── environment.ts          # .env loading, AppEnvironment config
│   │   ├── logger.ts               # Winston logger singleton
│   │   └── brand.ts                # Brand config from brand.json
│   ├── agents/
│   │   ├── BaseAgent.ts            # Abstract base for all Copilot SDK agents
│   │   ├── SilenceRemovalAgent.ts  # Context-aware silence removal decisions
│   │   ├── ShortsAgent.ts          # Short clip planning from transcript
│   │   ├── SummaryAgent.ts         # README generation with frame captures
│   │   ├── SocialMediaAgent.ts     # Multi-platform social post generation
│   │   └── BlogAgent.ts           # Dev.to blog post generation
│   ├── services/
│   │   ├── videoIngestion.ts       # Copy video, extract metadata, create dirs
│   │   ├── transcription.ts        # Whisper transcription with chunking
│   │   ├── captionGeneration.ts    # SRT/VTT/ASS generation orchestration
│   │   ├── fileWatcher.ts          # Chokidar file watcher with stability checks
│   │   ├── gitOperations.ts        # Git add/commit/push
│   │   └── socialPosting.ts        # Social post rendering helpers
│   └── tools/
│       ├── ffmpeg/
│       │   ├── silenceDetection.ts # Detect silence regions
│       │   ├── singlePassEdit.ts   # Frame-accurate trim+concat editing
│       │   ├── captionBurning.ts   # Burn ASS subs into video
│       │   ├── clipExtraction.ts   # Extract clips (single + composite)
│       │   ├── audioExtraction.ts  # Extract MP3, chunk audio
│       │   └── frameCapture.ts     # Screenshot capture at timestamp
│       ├── captions/
│       │   └── captionGenerator.ts # SRT/VTT/ASS format generators
│       ├── whisper/
│       │   └── whisperClient.ts    # OpenAI Whisper API client
│       └── search/
│           └── exaClient.ts        # Exa web search client
├── brand.json                      # Brand voice, vocabulary, hashtags, guidelines
├── recordings/                     # Output: one subfolder per processed video
│   └── {slug}/
│       ├── {slug}.mp4              # Ingested video copy
│       ├── {slug}-edited.mp4       # Silence-removed video
│       ├── {slug}-captioned.mp4    # Captioned video
│       ├── transcript.json         # Whisper transcript
│       ├── transcript-edited.json  # Timestamp-adjusted transcript
│       ├── README.md               # Generated summary
│       ├── thumbnails/             # Frame captures (snapshot-001.png, ...)
│       ├── shorts/                 # Short clips + captions + metadata
│       ├── social-posts/           # Platform-specific posts + blog
│       └── captions/               # SRT, VTT, ASS files
├── cache/                          # Temp audio files (cleaned up after use)
├── package.json
├── tsconfig.json
├── vitest.config.ts                # Vitest config (coverage thresholds, test patterns)
├── brand.json
├── .env                            # Local config (not committed)
└── .env.example                    # Template for .env
```

## Environment Variables

```env
OPENAI_API_KEY=       # Required — OpenAI API key for Whisper + Copilot SDK
WATCH_FOLDER=         # Folder to watch for new .mp4 files
REPO_ROOT=            # Absolute path to this repo
FFMPEG_PATH=          # Optional — absolute path to ffmpeg binary
FFPROBE_PATH=         # Optional — absolute path to ffprobe binary
EXA_API_KEY=          # Optional — Exa AI API key for web search in posts/blog
```

## Bug Fix Testing Convention

> **Every bug fix MUST include a regression test** that:
> 1. Reproduces the bug (the test should fail without the fix)
> 2. Verifies the fix works correctly
> 3. Is placed in the appropriate test file (unit test for logic bugs, integration test for FFmpeg/pipeline bugs)
> 4. Uses the real speech video fixture when testing caption alignment, speech-related features, or pipeline quality

**Bug fix workflow:**
1. First write a failing test that demonstrates the issue
2. Then implement the fix
3. Verify the test passes
4. Run full test suite to ensure no regressions: `npm test`

## Testing

### Running the Pipeline Manually

```bash
# Process a single video (no file watcher):
npx tsx src/index.ts "C:\path\to\video.mp4"

# Process next video from watch folder then exit:
npx tsx src/index.ts --once

# Watch mode (continuous):
npx tsx src/index.ts
```

### Test Suite

**Framework:** Vitest with @vitest/coverage-v8

**Test scripts:**
- `npm test` — run all tests (unit + integration)
- `npm run test:unit` — unit tests only (fast, no external deps)
- `npm run test:integration` — integration tests only (requires FFmpeg)
- `npm run test:coverage` — full coverage report
- `npm run test:watch` — watch mode for development

**Test structure:**
- `src/__tests__/*.test.ts` — Unit tests (mock external I/O, test real source functions)
- `src/__tests__/integration/*.test.ts` — Integration tests (real FFmpeg against test videos)
- `src/__tests__/integration/fixtures/` — Test fixtures (real speech video + transcript)
- `src/__tests__/integration/fixture.ts` — Synthetic test video generator

### Key Testing Patterns

- Unit tests mock `execFile`, `fs`, `sharp`, `openai`, `exa-js` — test real source functions not mock reimplementations
- Integration tests use `describe.skipIf(!ffmpegOk)` for CI safety (skip gracefully when FFmpeg unavailable)
- Use `vi.hoisted()` for mock variables used in `vi.mock()` factories (Vitest ESM requirement)
- Agent tool handlers take 2 args: `(args: TArgs, invocation: ToolInvocation)` — always pass mock invocation in tests
- Use `import.meta.dirname` for ESM path resolution (not `__dirname`)
- Coverage thresholds at 70% (lines/functions/branches/statements)
- Current coverage: 332 tests across 20 files, ~79% line coverage

### Test Fixtures

- **Synthetic video** (`fixture.ts`): 5s testsrc + sine audio for basic FFmpeg operation tests
- **Real speech video** (`fixtures/sample-speech.mp4`): 32s clip with 81 words of real speech for caption quality and pipeline tests
- **Real transcript** (`fixtures/sample-speech-transcript.json`): Word-level timestamps from Whisper

### Visual Self-Verification

After making changes to video output (captions, portrait layout, aspect ratios, overlays), always **visually verify** by extracting thumbnail frames from the generated video and inspecting them:

```bash
# Capture a frame at a specific timestamp from a generated video
ffmpeg -y -ss 2 -i path/to/output.mp4 -frames:v 1 -q:v 2 preview.png

# Capture multiple timestamps to verify different states:
# - 0.5s: hook text overlay visible?
# - 2-3s: captions + hook both visible?
# - 5s+:  hook gone, captions only?
# - 8s+:  mid-video caption alignment?
```

**What to check:**
- Portrait split-screen: face NOT duplicated in top section, face zoomed in at bottom
- Captions: green highlight on active word, positioned between screen and face sections
- Hook overlay: visible for first ~4 seconds at top, fades out
- Font sizes: active word visibly larger than inactive words
- No visual artifacts from crop/scale operations

# Copilot Instructions — video-auto-note-taker

## Project Overview

Automated video processing pipeline that watches a folder for new `.mp4` recordings, then runs a 14-stage pipeline: ingestion → transcription → silence removal → captions → caption burning → shorts → medium clips → chapters → summary → social media → short posts → medium clip posts → blog → git push.

**Tech stack:** Node.js, TypeScript (ES2022), ESM modules (`"type": "module"`), `@github/copilot-sdk` for AI agents, OpenAI Whisper for transcription, FFmpeg for all video/audio operations, Winston for logging, Chokidar for file watching, Exa for web search, Sharp for image analysis, Commander for CLI.

## Architecture

### Pipeline Stages (pipeline.ts)

14 stages executed in order. Each is wrapped in `runStage()` which catches errors and records timing. A stage failure does **NOT** abort the pipeline — subsequent stages proceed with whatever data is available.

| # | Stage enum | What it does |
|---|-----------|-------------|
| 1 | `ingestion` | Copy video to `recordings/{slug}/`, extract metadata (duration, size) via ffprobe |
| 2 | `transcription` | Extract audio as MP3 (64kbps mono), send to OpenAI Whisper, chunk if >25MB, merge results |
| 3 | `silence-removal` | Detect silence via FFmpeg, agent decides which regions to cut, `singlePassEdit()` trims video |
| 4 | `captions` | Generate SRT/VTT/ASS from adjusted transcript (no AI needed) |
| 5 | `caption-burn` | Burn ASS subtitles into video; uses `singlePassEditAndCaption()` (one re-encode pass) when silence was removed, or `burnCaptions()` standalone |
| 6 | `shorts` | Agent plans 15–60s short clips, extracts them, generates platform variants (portrait/square/feed), burns captions + portrait hook overlay |
| 7 | `medium-clips` | Agent plans 60–180s medium clips, extracts with xfade transitions for composites, burns captions with medium style |
| 8 | `chapters` | Agent identifies topic boundaries, writes chapters in 4 formats: JSON, YouTube timestamps, Markdown, FFmpeg metadata |
| 9 | `summary` | Agent captures key frames + writes narrative README.md with brand voice, shorts table, chapters section |
| 10 | `social-media` | Agent generates posts for 5 platforms (TikTok, YouTube, Instagram, LinkedIn, X) with web search for links |
| 11 | `short-posts` | For each short clip, agent generates per-platform social posts saved to `shorts/{slug}/posts/` |
| 12 | `medium-clip-posts` | For each medium clip, reuses short-post agent, saves to `medium-clips/{slug}/posts/` |
| 13 | `blog` | Agent writes dev.to-style blog post (800–1500 words) with frontmatter, web search for links |
| 14 | `git-push` | `git add -A && git commit && git push` for the recording folder |

**Key data flow:**
- **Adjusted transcript** (post silence-removal) is used for captions (aligned to edited video)
- **Original transcript** is used for shorts, medium clips, and chapters (they reference original video timestamps)
- Shorts and chapters are generated before summary so the README can reference them

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

**Flow:** `CopilotClient({ autoStart: true })` → `createSession({ systemMessage, tools, streaming: true })` → `sendAndWait(prompt, 300_000)` → LLM calls tools → agent stores structured results → caller reads them after `run()` completes → `destroy()` tears down session + client.

**Existing agents (8 total):**

| Agent | Tools | Purpose |
|-------|-------|---------|
| `SilenceRemovalAgent` | `decide_removals` | Context-aware silence removal; conservative for demos, only removes >= 2s gaps, caps at 20% of duration |
| `ShortsAgent` | `plan_shorts` | Plans 3–8 short clips (15–60s), extracts + generates platform AR variants + portrait captions with hook |
| `MediumVideoAgent` | `plan_medium_clips` | Plans 2–4 medium clips (60–180s), extracts with xfade transitions, burns medium-style captions |
| `ChapterAgent` | `generate_chapters` | Identifies 3–10 chapter boundaries, writes JSON/YouTube/Markdown/FFmetadata formats |
| `SummaryAgent` | `capture_frame`, `write_summary` | Captures key frame screenshots, writes narrative README.md |
| `SocialMediaAgent` | `search_links`, `create_posts` | Generates posts for 5 platforms; also used for per-short and per-medium-clip posts |
| `BlogAgent` | `search_web`, `write_blog` | Writes dev.to blog post with frontmatter, weaves in search result links |

### Smart Layout System (src/tools/ffmpeg/aspectRatio.ts)

Converts landscape screen recordings with webcam overlays into platform-specific split-screen layouts.

**`SmartLayoutConfig` interface:**
```typescript
interface SmartLayoutConfig {
  label: string       // e.g. 'SmartPortrait'
  targetW: number     // output width (always 1080)
  screenH: number     // height of screen section (top)
  camH: number        // height of webcam section (bottom)
  fallbackRatio: AspectRatio  // if no webcam detected
}
```

**`convertWithSmartLayout()` shared helper** — detects webcam via `detectWebcamRegion()`, then:
1. Crops the screen region (excluding webcam area) and scales to `targetW × screenH`
2. AR-matches the webcam crop to `targetW × camH`: if webcam AR > target AR → center-crop width; if < target AR → center-crop height
3. Stacks screen (top) + webcam (bottom) via `[screen][cam]vstack`
4. Falls back to simple center-crop if no webcam detected

**Three smart converters:**

| Function | Output | Screen (top) | Webcam (bottom) | Fallback |
|----------|--------|-------------|----------------|----------|
| `convertToPortraitSmart()` | 1080×1920 | 1080×1248 | 1080×672 | 9:16 crop |
| `convertToSquareSmart()` | 1080×1080 | 1080×700 | 1080×380 | 1:1 crop |
| `convertToFeedSmart()` | 1080×1350 | 1080×878 | 1080×472 | 4:5 crop |

**`generatePlatformVariants()`** — generates all platform variants for a clip, deduplicating by aspect ratio. Default platforms for shorts: tiktok, youtube-shorts, instagram-reels, instagram-feed, linkedin.

### Edge-Based Webcam Bbox Detection (src/tools/ffmpeg/faceDetection.ts)

Two-phase webcam detection:

**Phase 1 — Corner skin-tone analysis:**
- Samples `SAMPLE_FRAMES=5` frames at even intervals
- Forces analysis resolution to `320×180` (ANALYSIS_WIDTH × ANALYSIS_HEIGHT)
- Analyzes 4 corners (25% × 25% each) for skin-tone pixels + visual variance
- `calculateCornerConfidence()` = consistency × avg_score across frames
- Minimum thresholds: `MIN_SKIN_RATIO=0.05`, `MIN_CONFIDENCE=0.3`

**Phase 2 — `refineBoundingBox()` edge detection:**
- Replaces hardcoded WEBCAM_CROP_MARGIN with data-driven bounds
- Computes per-column and per-row mean grayscale intensity across 5 sample frames
- Finds peak inter-adjacent-pixel difference (`findPeakDiff()`) to locate overlay edges
- Constants: `REFINE_MIN_EDGE_DIFF=3.0`, `REFINE_MIN_SIZE_FRAC=0.05`, `REFINE_MAX_SIZE_FRAC=0.55`
- Falls back to coarse 25% corner bounds if refinement fails

**Resolution mapping:** Analysis at 320×180, mapped back to original video resolution with `scaleX = width / 320`, `scaleY = height / 180`. This means **videos can be non-16:9** (e.g., 2304×1536 is 3:2) — the scale factors handle arbitrary resolutions.

### Caption System (src/tools/captions/captionGenerator.ts)

**Three caption styles** (`CaptionStyle` type: `'shorts' | 'medium' | 'portrait'`):

| Style | Active font | Inactive font | Active color | PlayRes | Use case |
|-------|------------|--------------|-------------|---------|----------|
| `shorts` | 54pt | 42pt | Yellow (`&H00FFFF&`) | 1920×1080 | Landscape short clips |
| `medium` | 40pt | 32pt | Yellow (`&H00FFFF&`) | 1920×1080 | Medium clips, bottom-positioned |
| `portrait` | 78pt + 130% scale pop | 66pt | Green (`&H00FF00&`) | 1080×1920 | Portrait shorts (Opus Clips style) |

**Word-by-word karaoke highlighting:**
- Words grouped by speech gaps (`SILENCE_GAP_THRESHOLD=0.8s`) and max group size (`MAX_WORDS_PER_GROUP=8`)
- Groups split into 1–2 display lines at `WORDS_PER_LINE=4`
- One Dialogue line per word-state: active word gets color + size change, all others stay base
- Portrait style adds `\fscx130\fscy130\t(0,150,\fscx100\fscy100)` scale pop animation on active word

**Hook overlay (portrait only):**
- Style: `Hook` — Montserrat 56pt, dark text (`&H00333333&`), light gray bg (`&H60D0D0D0&`/`&H60E0E0E0&` outline/back), rounded corners via `BorderStyle=3` with `Outline=18`, `Alignment=8` (top-center)
- Displays for first 4 seconds with `\fad(300,500)` fade in/out
- Max 60 characters, truncated with `...`

**ASS format variants:**
- `generateStyledASS()` — full video captions
- `generateStyledASSForSegment()` — single clip with buffer-adjusted timestamps
- `generateStyledASSForComposite()` — multi-segment composite with running offset
- `generatePortraitASSWithHook()` — portrait captions + hook overlay for single segment
- `generatePortraitASSWithHookComposite()` — portrait captions + hook for composite

**Montserrat Bold** is bundled in `assets/fonts/`. Fonts are copied alongside the ASS file at render time; FFmpeg's `ass` filter is invoked with `fontsdir=.` so libass finds them.

### Service Layer (src/services/)

| Service | Purpose |
|---------|---------|
| `videoIngestion` | Copy video to `recordings/{slug}/`, extract metadata via ffprobe |
| `transcription` | Extract audio as MP3, send to Whisper, chunk if >25MB |
| `captionGeneration` | Generate SRT/VTT/ASS from transcript (orchestration wrapper) |
| `fileWatcher` | Chokidar-based watcher for new .mp4 files, stability checks |
| `gitOperations` | `git add -A && git commit && git push` |
| `socialPosting` | Renders social posts as YAML frontmatter + markdown body |

### FFmpeg Tools Layer (src/tools/ffmpeg/)

| Tool | Purpose |
|------|---------|
| `silenceDetection` | Detect silence regions via `silencedetect` audio filter |
| `singlePassEdit` | Trim+setpts+concat filter_complex for frame-accurate cuts; `singlePassEditAndCaption()` adds ass filter in the same encode |
| `captionBurning` | Burn ASS subtitles into video (hard-coded subs) |
| `clipExtraction` | `extractClip()` single segment with buffer; `extractCompositeClip()` via concat demuxer; `extractCompositeClipWithTransitions()` via xfade/acrossfade filters |
| `audioExtraction` | Extract MP3 (64kbps mono), split into chunks if needed |
| `frameCapture` | Capture PNG screenshot at a specific timestamp |
| `aspectRatio` | Smart layout converters + simple center-crop + platform variant generation |
| `faceDetection` | Webcam overlay detection via skin-tone analysis + edge refinement (uses Sharp) |

All FFmpeg tools use `execFile()` with `process.env.FFMPEG_PATH` (not shell commands). Set via `FFMPEG_PATH` / `FFPROBE_PATH` env vars.

## Coding Conventions

### Bug Fix Rule
Every bug fix **must** include a regression test — see [Bug Fix Testing Convention](#bug-fix-testing-convention) below.

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
- Agents: try/finally with `agent.destroy()` to clean up CopilotClient + CopilotSession
- FFmpeg: `execFile` callback → reject Promise with stderr message
- File operations: `.catch(() => {})` for cleanup operations that may fail

### Types
All domain types are in `src/types/index.ts`. Key types:
- `VideoFile` — ingested video metadata (slug, paths, duration, size, createdAt)
- `Transcript` — Whisper output (text, segments, words with word-level timestamps, language, duration)
- `ShortClip` — planned short with segments, output paths, variants (platform AR)
- `MediumClip` — planned medium clip with segments, hook, topic
- `Chapter` — timestamp, title, description
- `SocialPost` — platform-specific post with YAML frontmatter
- `VideoSummary` — title, overview, keyTopics, snapshots, markdownPath
- `PipelineStage` — enum of all 14 stage names
- `SilenceRemovalResult` — editedPath, removals, keepSegments, wasEdited
- `AgentResult<T>` — generic agent response wrapper
- `AspectRatio` — `'16:9' | '9:16' | '1:1' | '4:5'`
- `CaptionStyle` — `'shorts' | 'medium' | 'portrait'`

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

- **Montserrat Bold** is bundled in `assets/fonts/` — no system font installation needed. FFmpeg references the bundled font file directly via `fontsdir=.`.
- Word-by-word karaoke highlighting (not `\k` tags — uses per-word Dialogue lines with color/size overrides)
- Words grouped into display lines via `splitGroupIntoLines()` at `WORDS_PER_LINE=4`
- `generateStyledASS()` — full video captions
- `generateStyledASSForSegment()` — single clip with buffer-adjusted timestamps
- `generateStyledASSForComposite()` — multi-segment composite with running offset
- `generatePortraitASSWithHook()` / `generatePortraitASSWithHookComposite()` — portrait captions + hook overlay

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
shortSlug: null
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
- **Solution:** Copy ASS file + bundled fonts to a temp dir, set `cwd` to that dir, use relative filename `ass=captions.ass:fontsdir=.`
- Both `captionBurning.ts` and `singlePassEdit.ts` implement this pattern

### Single-Pass Edit (Frame-Accurate Cuts)
- `-c copy` (stream copy) snaps to keyframes → causes timestamp drift
- Instead: `trim+setpts+concat` filter_complex re-encodes for frame-accurate cuts
- `singlePassEditAndCaption()` chains the `ass` filter after concat in the same filter_complex — one re-encode, perfect timestamp alignment

### Brand Vocabulary
- `brand.json` defines custom vocabulary fed to Whisper's `prompt` parameter
- Improves transcription accuracy for domain-specific terms (e.g., "GitHub Copilot", "Copilot SDK")
- Also drives agent system prompts for consistent voice/tone in summaries, posts, blog

### Transcript Adjustment After Silence Removal
- `adjustTranscript()` in `pipeline.ts` shifts all timestamps by cumulative removed duration
- Words/segments entirely inside a removed region are filtered out
- Adjusted transcript is used for caption generation (aligned to edited video)
- Original transcript is used for shorts, medium clips, and chapters (they reference original video timestamps)

### Videos Can Be Non-16:9
- Source videos may have arbitrary aspect ratios (e.g., 2304×1536 is 3:2)
- Face detection analysis frames are forced to 320×180, then mapped back with `scaleX = resolution.width / 320`, `scaleY = resolution.height / 180`
- Smart layout screen crop uses detected webcam bounds, not hardcoded positions

### Clip Extraction Buffer
- All clip extraction adds a 1-second buffer before/after each segment boundary
- Composite clips: `extractCompositeClip()` uses concat demuxer; `extractCompositeClipWithTransitions()` uses xfade/acrossfade for smooth transitions (used by medium clips)

## CLI Usage

```bash
# Process a single video (no file watcher):
npx tsx src/index.ts "C:\path\to\video.mp4"

# Process next video from watch folder then exit:
npx tsx src/index.ts --once

# Watch mode (continuous):
npx tsx src/index.ts

# Skip specific stages:
npx tsx src/index.ts --no-git --no-social --no-shorts video.mp4

# All CLI flags:
#   --watch-dir <path>     Watch folder
#   --output-dir <path>    Output directory (default: ./recordings)
#   --openai-key <key>     OpenAI API key
#   --exa-key <key>        Exa AI API key
#   --brand <path>         Brand config path (default: ./brand.json)
#   --once                 Process one video and exit
#   --no-git               Skip git commit/push
#   --no-silence-removal   Skip silence removal
#   --no-shorts            Skip shorts generation
#   --no-medium-clips      Skip medium clip generation
#   --no-social            Skip social media posts
#   --no-captions          Skip caption generation/burning
#   -v, --verbose          Verbose logging
```

## File Structure

```
video-auto-note-taker/
├── src/
│   ├── index.ts                    # CLI entry point (Commander, watch mode + --once mode)
│   ├── pipeline.ts                 # Pipeline orchestration, runStage(), adjustTranscript()
│   ├── types/index.ts              # All TypeScript interfaces and enums
│   ├── __tests__/
│   │   ├── *.test.ts               # Unit tests (mock external I/O)
│   │   └── integration/
│   │       ├── *.test.ts           # Integration tests (real FFmpeg)
│   │       ├── fixture.ts          # Synthetic test video generator (5s testsrc + sine)
│   │       └── fixtures/           # Real speech video + transcript
│   ├── config/
│   │   ├── environment.ts          # .env loading, CLIOptions, AppEnvironment config
│   │   ├── logger.ts               # Winston logger singleton
│   │   └── brand.ts                # Brand config from brand.json
│   ├── agents/
│   │   ├── BaseAgent.ts            # Abstract base for all Copilot SDK agents
│   │   ├── SilenceRemovalAgent.ts  # Context-aware silence removal decisions
│   │   ├── ShortsAgent.ts          # Short clip planning (15–60s) + extraction + variants
│   │   ├── MediumVideoAgent.ts     # Medium clip planning (60–180s) + extraction
│   │   ├── ChapterAgent.ts         # Chapter boundary detection + multi-format output
│   │   ├── SummaryAgent.ts         # README generation with frame captures
│   │   ├── SocialMediaAgent.ts     # Multi-platform social post generation (also short/medium posts)
│   │   └── BlogAgent.ts            # Dev.to blog post generation
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
│       │   ├── singlePassEdit.ts   # Frame-accurate trim+concat editing (+caption combo)
│       │   ├── captionBurning.ts   # Burn ASS subs into video
│       │   ├── clipExtraction.ts   # Extract clips (single + composite + xfade)
│       │   ├── audioExtraction.ts  # Extract MP3, chunk audio
│       │   ├── frameCapture.ts     # Screenshot capture at timestamp
│       │   ├── aspectRatio.ts      # Smart layout + center-crop + platform variants
│       │   └── faceDetection.ts    # Webcam overlay detection (skin-tone + edge refinement)
│       ├── captions/
│       │   └── captionGenerator.ts # SRT/VTT/ASS format generators + hook overlay
│       ├── whisper/
│       │   └── whisperClient.ts    # OpenAI Whisper API client
│       └── search/
│           └── exaClient.ts        # Exa web search client
├── assets/
│   └── fonts/                      # Bundled Montserrat Bold font files
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
│       ├── shorts/                 # Short clips + captions + platform variants + metadata
│       ├── medium-clips/           # Medium clips + captions + metadata + posts
│       ├── chapters/               # chapters.json, chapters-youtube.txt, chapters.md, chapters.ffmetadata
│       ├── social-posts/           # Platform-specific posts + devto.md blog
│       └── captions/               # SRT, VTT, ASS files
├── cache/                          # Temp audio files (cleaned up after use)
├── package.json
├── tsconfig.json
├── vitest.config.ts                # Vitest config (coverage thresholds, test patterns)
├── .env                            # Local config (not committed)
└── .env.example                    # Template for .env
```

## Environment Variables

```env
OPENAI_API_KEY=       # Required — OpenAI API key for Whisper + Copilot SDK
WATCH_FOLDER=         # Folder to watch for new .mp4 files (default: ./watch)
REPO_ROOT=            # Absolute path to this repo (default: cwd)
FFMPEG_PATH=          # Optional — absolute path to ffmpeg binary (default: 'ffmpeg')
FFPROBE_PATH=         # Optional — absolute path to ffprobe binary (default: 'ffprobe')
EXA_API_KEY=          # Optional — Exa AI API key for web search in posts/blog
OUTPUT_DIR=           # Optional — output directory (default: ./recordings)
BRAND_PATH=           # Optional — path to brand.json (default: ./brand.json)
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

### Test Suite

**Framework:** Vitest with @vitest/coverage-v8

**Test scripts:**
- `npm test` (or `npx vitest run`) — run all tests (unit + integration)
- `npm run test:unit` — unit tests only (`--testPathPattern='__tests__/(?!integration)'`)
- `npm run test:integration` — integration tests only (`--testPathPattern=integration`)
- `npm run test:coverage` (or `npx vitest run --coverage`) — full coverage report
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
- Use `import.meta.dirname` for ESM path resolution (not `__dirname`)
- Coverage thresholds: statements=70%, branches=65%, functions=70%, lines=70%

### Test Fixtures

- **Synthetic video** (`fixture.ts`): `setupFixtures()` generates 5s video via `testsrc=duration=5:size=640x480:rate=25` + `sine=frequency=440:duration=5` for basic FFmpeg operation tests
- **Real speech video** (`fixtures/sample-speech.mp4`): 32s clip with real speech for caption quality and pipeline tests
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

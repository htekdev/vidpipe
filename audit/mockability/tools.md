# Mockability Audit: Tools Layer

> `src/tools/` — FFmpeg operations, caption generation, Gemini/Whisper clients, image generation.

## Directory Structure

```
src/tools/
├── agentTools.ts          — Shared tool builder helpers
├── imageGeneration.ts     — AI image generation API
├── captions/
│   └── captionGenerator.ts — SRT/VTT/ASS caption text generation
├── ffmpeg/
│   ├── aspectRatio.ts      — Platform variant generation
│   ├── audioExtraction.ts  — Audio extraction for Whisper
│   ├── captionBurning.ts   — ASS subtitle burning into video
│   ├── clipExtraction.ts   — Short/medium clip cutting
│   ├── faceDetection.ts    — Webcam region detection (ONNX + FFmpeg)
│   ├── frameCapture.ts     — Screenshot extraction at timestamp
│   ├── overlayCompositing.ts — AI image overlay compositing
│   ├── silenceDetection.ts — Silence region detection
│   └── singlePassEdit.ts  — Combined trim + caption burn
├── gemini/
│   └── geminiClient.ts    — Google Gemini vision API
└── whisper/
    └── whisperClient.ts   — OpenAI Whisper transcription API
```

## Pure Functions (High Mockability)

### captionGenerator.ts — **9/10**

```typescript
// Pure functions — no I/O, no imports beyond types
export function generateSRT(transcript: Transcript): string { ... }
export function generateVTT(transcript: Transcript): string { ... }
export function generateStyledASS(transcript: Transcript, style?: CaptionStyle): string { ... }
export function generateStyledASSForSegment(...): string { ... }
export function generatePortraitASSWithHook(...): string { ... }
```

- Zero external dependencies (imports only from `../../types`)
- All functions are `Transcript → string` transformations
- Existing tests (`captionGenerator.test.ts`) use **no mocks at all** — just input/output assertions
- Includes word-level timing, karaoke highlighting, hook overlay positioning

### overlayCompositing.ts — **8/10**

```typescript
// Pure function — builds FFmpeg filter string, no execution
export function buildFilterComplex(overlays, videoWidth, videoHeight): string { ... }
// Pure function — position calculation
export function getOverlayPosition(region, margin): { x: string; y: string } { ... }
```

- `getOverlayPosition()` and `buildFilterComplex()` are pure
- `compositeOverlays()` calls `execFileRaw()` → needs mocking
- Split between pure helpers and I/O function is clean

### Helpers in other modules

- `mergeRemovals()` in ProducerAgent — pure sorting/merging
- `toYouTubeTimestamp()`, `fmtTime()`, `buildTranscriptBlock()` in ChapterAgent/SummaryAgent — pure formatters
- `generateChaptersJSON()`, `generateYouTubeTimestamps()`, `generateFFMetadata()` in ChapterAgent — pure output formatters

## FFmpeg Tools (Low Mockability)

### captionBurning.ts — **4/10**

```typescript
import { execFileRaw } from '../../core/process.js'
import { getFFmpegPath } from '../../core/ffmpeg.js'

export async function burnCaptions(videoPath, assPath, outputPath): Promise<string> { ... }
```

| Dependency | Type |
|-----------|------|
| `execFileRaw()` | Child process (FFmpeg) |
| `makeTempDir()`, `copyFile()`, `listDirectory()`, `renameFile()` | File I/O |
| `getFFmpegPath()` | Config + require() |
| `logger` | Singleton |

Complex temp-directory workflow to handle Windows drive-letter colon in FFmpeg filter paths. Substantial logic interleaved with I/O.

### faceDetection.ts — **4/10**

```typescript
import { sharp, ort } from '../../core/media.js'
import { execFileRaw } from '../../core/process.js'

const MODEL_PATH = join(modelsDir(), 'ultraface-320.onnx')
let cachedSession: ort.InferenceSession | null = null  // module-level cache
```

| Dependency | Type |
|-----------|------|
| `execFileRaw()` | FFmpeg frame extraction |
| `sharp` | Image processing (resize, raw buffer) |
| `ort.InferenceSession` | ONNX model inference |
| Module-level `cachedSession` | Mutable singleton state |

Three external systems (FFmpeg + Sharp + ONNX Runtime) plus a module-level cached session. Hardest tool to mock comprehensively.

### clipExtraction.ts — **4/10**

| Dependency | Type |
|-----------|------|
| `execFileRaw()` | FFmpeg clip cutting |
| File I/O | Temp files, concat lists |
| `ffprobe()` | Media metadata |

### singlePassEdit.ts — **4/10**

Combines silence removal + caption burning in one FFmpeg pass. Complex filter graph construction.

### silenceDetection.ts — **5/10**

```typescript
export async function detectSilence(videoPath, opts): Promise<SilenceRegion[]> { ... }
```

Parses FFmpeg stderr for `silence_start`/`silence_end` markers. The parsing logic is testable if extracted, but currently interleaved with the `execFileRaw` call.

### aspectRatio.ts — **5/10**

Platform variant generation. Calls FFmpeg per variant but has testable resolution calculation logic.

### audioExtraction.ts — **5/10**

Fluent-ffmpeg based. The promise wrapper pattern is clean but requires mocking the entire fluent-ffmpeg chain.

### frameCapture.ts — **5/10**

Single FFmpeg call to extract a frame. Simple enough to mock but no pure logic to test.

## API Clients

### geminiClient.ts — **4/10**

| Dependency | Type |
|-----------|------|
| `@google/generative-ai` | HTTP API |
| `core/fileSystem.js` | File upload |
| `getConfig().GEMINI_API_KEY` | Config singleton |

Direct SDK instantiation with no injection point.

### whisperClient.ts — **4/10**

| Dependency | Type |
|-----------|------|
| `openai` | HTTP API (Whisper endpoint) |
| `core/fileSystem.js` | File read for upload |
| `getConfig().OPENAI_API_KEY` | Config singleton |

### imageGeneration.ts — **4/10**

AI image generation via HTTP API. Direct SDK usage.

## Key Findings

1. **Clean pure/impure separation exists in some tools.** `captionGenerator.ts` is 100% pure. `overlayCompositing.ts` separates `buildFilterComplex()` (pure) from `compositeOverlays()` (I/O). This pattern should be replicated.

2. **Most FFmpeg tools directly import singletons**: `getConfig()`, `logger`, `getFFmpegPath()`. These create implicit dependencies that require module-level mocking.

3. **Module-level state in faceDetection.ts** (`cachedSession`) and `captionBurning.ts` (`ffmpegPath`, `FONTS_DIR` evaluated at import) makes them harder to test in isolation.

4. **Existing test patterns** (`ffmpegTools.test.ts`) mock `core/process.js` and `core/fileSystem.js` at the module level with `vi.hoisted()` — verbose but effective.

## Mockability Scorecard

| Tool | Score | Key Issue |
|------|-------|-----------|
| captionGenerator.ts | 9/10 | Pure functions, no mocks needed |
| overlayCompositing.ts | 8/10 | Pure helpers + one FFmpeg call |
| silenceDetection.ts | 5/10 | FFmpeg stderr parsing interleaved with I/O |
| aspectRatio.ts | 5/10 | FFmpeg per variant |
| audioExtraction.ts | 5/10 | fluent-ffmpeg chain |
| frameCapture.ts | 5/10 | Single FFmpeg call, no pure logic |
| singlePassEdit.ts | 4/10 | Complex filter graph + FFmpeg |
| captionBurning.ts | 4/10 | Temp dir workflow + FFmpeg |
| clipExtraction.ts | 4/10 | FFmpeg + temp files + concat |
| faceDetection.ts | 4/10 | FFmpeg + Sharp + ONNX, cached session |
| geminiClient.ts | 4/10 | Direct SDK, no injection |
| whisperClient.ts | 4/10 | Direct SDK, no injection |
| imageGeneration.ts | 4/10 | Direct SDK, no injection |

## Recommendation

Extract pure logic from FFmpeg tools (filter graph building, stderr parsing, timestamp calculation) into separate functions that can be tested without mocking. The `captionGenerator.ts` pattern is the gold standard.

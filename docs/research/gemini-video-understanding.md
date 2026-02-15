# Gemini Video Understanding Integration

## Overview

vidpipe integrates Google's Gemini API for two distinct vision capabilities:

1. **Video Editorial Analysis** — Upload a raw video file and receive timestamped editorial direction (cut points, pacing, transitions, b-roll suggestions, hook analysis)
2. **Image Element Detection** — Analyze screenshot frames to detect UI elements with pixel-coordinate bounding boxes

Gemini is the only production-ready API that accepts raw video files and returns timestamped analysis without requiring frame extraction. This makes it uniquely suited for editorial direction generation.

## Video Editorial Analysis

### How It Works

```
┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Video File  │────▶│  Gemini Files API │────▶│  Editorial Prompt │
│  (.mp4)      │     │  (async upload)   │     │  (analysis)       │
└──────────────┘     └───────────────────┘     └────────┬─────────┘
                                                        │
                                               ┌────────▼─────────┐
                                               │  Markdown output  │
                                               │  with timestamps  │
                                               └──────────────────┘
```

#### Upload Process

1. **File upload** via `ai.files.upload()` with `video/mp4` MIME type
2. **Async processing** — Gemini processes the upload asynchronously. The client polls `ai.files.get()` every 2 seconds until state transitions from `PROCESSING` → `ACTIVE`
3. **Analysis request** — Once active, the video URI is sent with the editorial analysis prompt

#### Editorial Prompt

The prompt asks Gemini to act as a professional video editor and produce structured analysis covering:

| Section | What It Covers |
|---------|---------------|
| **Cut Points & Transitions** | Every moment where a cut should occur, WHY it improves the edit, which transition type to use (hard cut, crossfade, dissolve, J-cut, L-cut, jump cut, fade to black) |
| **Pacing Analysis** | Sections too slow/fast/dead air with start/end timestamps and recommended actions |
| **B-Roll & Graphics** | Moments where text overlays, graphics, zoom-ins, or visual emphasis would improve engagement |
| **Hook & Retention** | First 3 seconds rated 1-10 with specific improvement suggestions |
| **Content Structure** | Intro/body sections/outro with timestamps and topics |
| **Key Moments** | Most engaging, surprising, or important moments to emphasize |

The output is free-form Markdown stored as `editorial-direction.md` alongside the video.

#### Cost Tracking

Gemini's video input uses approximately **263 tokens per second** of footage (per documentation). The client estimates input tokens as `ceil(duration_seconds × 263)` and output tokens as `ceil(response_length / 4)`. This is recorded via `costTracker.recordServiceUsage()` for the pipeline cost report.

### Example Output (representative)

```markdown
## Cut Points & Transitions
- **00:15** — Hard cut to screen share. The intro ramble runs too long;
  cutting here keeps the hook tight.
- **02:34** — Crossfade to webcam. This is a natural pause where the speaker
  reflects before the next topic.
- **05:12** — J-cut to terminal output. Start the audio of the next section
  0.5s before the visual cut for smoother flow.

## Pacing Analysis
- **01:20–01:45** — Dead air while waiting for build. Speed up 2× or cut entirely.
- **03:00–03:30** — Speaking too fast through important concept. Consider
  adding a text overlay summarizing the key point.

## Hook & Retention
Rating: 4/10. The first 3 seconds show a loading screen. Suggestion:
Start with the "mind-blown" moment at 04:22 as a cold open, then
cut to intro.
```

## Image Element Detection

### How It Works

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Screenshot  │────▶│  FFprobe dims   │────▶│  Gemini Vision    │
│  (JPEG/PNG)  │     │  (actual px)    │     │  (element detect) │
└──────────────┘     └─────────────────┘     └────────┬─────────┘
                                                      │
                                             ┌────────▼─────────┐
                                             │  DetectedElement[]│
                                             │  (pixel coords)   │
                                             └──────────────────┘
```

#### Process

1. **Get actual image dimensions** via FFprobe (`-show_entries stream=width,height`)
2. **Read image** as base64 and send to Gemini with the actual dimensions baked into the prompt
3. **Parse JSON response** — Gemini returns a JSON array of detected elements
4. **Coordinate rescaling** — Detect and correct normalized coordinate spaces (see below)
5. **Validate** — Filter out invalid entries missing required fields

#### Coordinate Rescaling (Gemini Bounding Box Fix)

Gemini often returns coordinates in a **normalized [0, 1000] space** regardless of the actual image dimensions specified in the prompt. The client detects this pattern and rescales:

```typescript
// Detection heuristic:
// If max extent ≤ 1050 but image is > 1500px in either dimension,
// Gemini likely returned normalized [0, 1000] coordinates
if (maxX <= 1050 && maxY <= 1050 && (imgWidth > 1500 || imgHeight > 1500)) {
  const scaleX = imgWidth / 1000
  const scaleY = imgHeight / 1000
  elements = elements.map(e => ({
    ...e,
    x: Math.round(e.x * scaleX),
    y: Math.round(e.y * scaleY),
    width: Math.round(e.width * scaleX),
    height: Math.round(e.height * scaleY),
  }))
}
```

This was discovered through testing — Gemini's responses consistently used a 0-1000 coordinate space for images larger than ~1500px, making the raw coordinates useless for FFmpeg filter positioning without rescaling.

#### Output Type

```typescript
interface DetectedElement {
  label: string    // e.g., "VS Code editor tab bar"
  x: number        // pixels from left
  y: number        // pixels from top
  width: number    // box width in pixels
  height: number   // box height in pixels
}
```

### Integration with ProducerAgent

The `analyze_frame` tool in ProducerAgent wraps `analyzeImageElements()`:

1. Agent captures a frame at a specific timestamp
2. Sends the frame to Gemini for element detection
3. Returns the element array with image dimensions and a conversion tip
4. Agent converts pixel coordinates to normalized 0-1 coordinates for `zoom_screen` or `highlight_region` effects

This enables **vision-guided editing** — the AI can "see" what's on screen and plan precise zoom/highlight effects targeting specific UI elements, code blocks, or terminal output.

### Visual Verification with `drawRegions()`

Before committing to expensive FFmpeg encodes, agents can verify their coordinate targeting using `drawRegions()` from `src/tools/agentTools.ts`:

```typescript
// Draw labeled rectangles on a captured frame
drawRegions(imagePath, [
  { label: 'Terminal', x: 100, y: 400, width: 800, height: 300 },
  { label: 'Code Editor', x: 100, y: 50, width: 800, height: 350 },
])
```

This annotates the frame with colored rectangles + labels, allowing the agent (or developer) to visually confirm that coordinates target the intended regions before rendering.

## Configuration

| Environment Variable | Required | Description |
|---------------------|----------|-------------|
| `GEMINI_API_KEY` | No | Google AI Studio API key. When absent, editorial direction returns gracefully as unavailable |

The Gemini integration is designed as an **optional enhancement** — all pipeline stages work without it. When available, it provides richer editorial context that improves the ProducerAgent's edit quality.

## Model Selection

Default model: **`gemini-2.5-flash`** — chosen for its balance of speed, cost, and video understanding capability. Can be overridden per-call via the `model` parameter.

## SDK

Uses `@google/genai` SDK (v1.x) with these key imports:

```typescript
import { GoogleGenAI, createUserContent, createPartFromUri, createPartFromBase64 } from '@google/genai'
```

- `createPartFromUri` — References uploaded video files
- `createPartFromBase64` — Embeds images inline for element detection
- `createUserContent` — Wraps multimodal content arrays

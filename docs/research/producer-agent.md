# ProducerAgent — AI-Powered Video Production

## Overview

The ProducerAgent is a sophisticated LLM-powered video editor that operates as a Copilot SDK agent. It analyzes videos through multiple modalities (transcript, chapters, visual content, Gemini editorial direction) and produces a structured edit plan that gets compiled into a single FFmpeg render pass.

Unlike the pipeline's existing agents (ShortsAgent, ChapterAgent, etc.) which each handle one specific task, the ProducerAgent orchestrates **full video production** — layout selection, transitions, effects, and rendering — in a single agent session.

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                    ProducerAgent                        │
│                                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────────┐ │
│  │  Context     │  │  Planning   │  │  Compile &     │ │
│  │  Tools (6)   │  │  Tool (1)   │  │  Render        │ │
│  └──────┬──────┘  └──────┬──────┘  └───────┬────────┘ │
│         │                │                  │          │
│  get_video_info    plan_edits         compileEdl()     │
│  get_transcript    ─────────▶        + runFfmpeg()     │
│  get_chapters      EdlAccumulator                      │
│  get_editorial_direction                               │
│  capture_frame                                         │
│  analyze_frame (Gemini vision)                         │
└────────────────────────────────────────────────────────┘
```

## Workflow

The agent follows a prescribed workflow to gather context before planning:

### Phase 1: Context Gathering

1. **`get_video_info`** — Dimensions, duration, FPS. Sets `videoDuration` for planning.
2. **`get_chapters`** — Chapter structure with timestamps and titles. Informs layout transitions.
3. **`get_editorial_direction`** — Gemini-powered editorial analysis (when available). Provides timestamped cut points, pacing analysis, transition recommendations, b-roll suggestions, and hook scoring.
4. **`get_transcript`** — Speech content with optional time-range filtering. Can be called multiple times for different sections.

### Phase 2: Visual Analysis (Optional)

5. **`capture_frame`** — Capture a JPEG screenshot at any timestamp for visual inspection.
6. **`analyze_frame`** — Capture + Gemini vision analysis. Returns `DetectedElement[]` with pixel-coordinate bounding boxes for every UI element on screen.

The agent uses frame analysis to plan **precision edits**:
- Target `zoom_screen` to specific code blocks or terminal output
- Place `highlight_region` boxes around buttons or UI elements
- Verify webcam position before `zoom_webcam`

### Phase 3: Planning

7. **`plan_edits`** — Submit the complete edit plan as a structured JSON array. Called once with all edits.

Each edit specifies:
```typescript
{
  type: 'layout' | 'transition' | 'effect',
  tool: string,       // e.g., 'split_layout', 'fade', 'text_overlay'
  start_time: number,  // seconds
  end_time?: number,   // required for layouts and effects
  params?: Record<string, unknown>
}
```

### Phase 4: Compilation & Rendering (Automatic)

After `plan_edits` returns, the `produce()` method automatically:

1. Retrieves webcam region from the video asset's layout data
2. Builds the EDL via `accumulator.toEdl()` with video metadata
3. Compiles to FFmpeg via `compileEdl()` → `filter_complex` string
4. Executes FFmpeg → rendered output video

## Tools Reference

### Context Tools

| Tool | Returns | Purpose |
|------|---------|---------|
| `get_video_info` | `{ width, height, duration, fps }` | Video dimensions and timing |
| `get_transcript` | `{ text, segments[] }` | Speech content, filterable by time range |
| `get_chapters` | `{ chapters[{ title, timestamp, description }] }` | Topic structure |
| `get_editorial_direction` | `{ available, editorialDirection }` | Gemini editorial analysis or graceful fallback |
| `capture_frame` | `{ imagePath }` | Screenshot for visual inspection |
| `analyze_frame` | `{ elements[], imageWidth, imageHeight, tip }` | Gemini vision element detection with normalization guidance |

### Planning Tool

| Tool | Input | Effect |
|------|-------|--------|
| `plan_edits` | `{ edits: PlannedEdit[] }` | Populates `EdlAccumulator` for compilation |

## System Prompt Design

The system prompt is carefully structured to guide the LLM's decision-making:

### Layout Guidance
- Start with `split_layout` as default
- `only_webcam` for personal moments (intros, reactions, emotional beats)
- `only_screen` for detailed technical content (code walkthroughs, demos)
- `zoom_screen` always requires prior `capture_frame` + region specification

### Segment Trimming
The prompt explicitly teaches gap-based trimming:
> "You can SKIP content by leaving GAPS between layout decisions. Layout 1: 0-2s, Layout 2: 3-5s → The gap at 2-3s is automatically excluded."

### Effects Philosophy
- "Subtle is better"
- "Every edit should serve viewer engagement"
- Text overlays should use animations (`fade-in`, `pop`, `slide-up`)
- `fade_to_black` at the end for clean outros

### Coordinate System
- `zoom_screen` and `highlight_region` use **normalized 0-1 coordinates**
- Agent gets pixel coordinates from `analyze_frame`, divides by `imageWidth`/`imageHeight`
- The prompt explains this conversion explicitly

## Aspect Ratio Support

The agent accepts a target aspect ratio at construction time and maps it to output dimensions:

| Aspect Ratio | Output | Use Case |
|-------------|--------|----------|
| `16:9` | 1920×1080 | Standard landscape |
| `9:16` | 1080×1920 | Portrait (TikTok, Reels, Shorts) |
| `1:1` | 1080×1080 | Square (Instagram, LinkedIn) |
| `4:5` | 1080×1350 | Instagram Feed |

These dimensions are embedded as `outputWidth`/`outputHeight` in the EDL metadata, allowing the compiler to generate correctly-sized output.

## Result Type

```typescript
interface ProduceResult {
  summary: string       // Agent's description of edits made
  outputPath?: string   // Path to rendered video (if successful)
  success: boolean      // Whether FFmpeg rendering succeeded
  error?: string        // Error message if failed
  editCount?: number    // Number of edits planned
}
```

## Error Handling

- **Gemini unavailable** — `get_editorial_direction` returns `{ available: false }` with fallback guidance
- **`analyze_frame` failure** — Returns error + fallback message suggesting `capture_frame` instead
- **No edits planned** — Returns `{ success: false, error: 'No edits were planned' }`
- **FFmpeg render failure** — Returns error with the FFmpeg stderr output
- **Agent session failure** — Caught in `produce()`, returns error message

## Integration with VideoAsset

ProducerAgent takes a `VideoAsset` instance, giving it access to:

- `videoPath` — Source video file
- `getMetadata()` — Cached dimensions, duration, format
- `getTranscript()` — Word-level Whisper transcript
- `getChapters()` — Chapter boundaries
- `getLayout()` — Pre-detected webcam region
- `getEditorialDirection()` — Cached Gemini analysis

The `VideoAsset` handles caching and lazy loading, so repeated tool calls don't re-read files or re-run FFprobe.

## Relationship to Pipeline

The ProducerAgent is designed as an **optional production step** that could be added to the pipeline after caption burning (stage 5) to enhance the video with dynamic layouts, transitions, and effects. Currently it operates standalone via the asset system, but the architecture supports future pipeline integration.

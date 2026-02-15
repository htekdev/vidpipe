# Edit Decision List (EDL) System

## Overview

The EDL system is a **declarative edit description language** that bridges AI-planned video edits and FFmpeg execution. An LLM agent analyzes video content (transcript, chapters, visual content) and expresses editing intent as structured decisions. The EDL compiler then transforms those decisions into a single FFmpeg `filter_complex` command for efficient one-pass rendering.

This architecture cleanly separates **what** to edit (AI planning) from **how** to execute it (FFmpeg compilation), enabling flexible, composable video editing workflows.

## Architecture

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────────┐
│  ProducerAgent   │────▶│   EdlAccumulator   │────▶│   EDL Compiler  │
│  (AI planning)   │     │   (collect edits)  │     │ (FFmpeg output) │
└─────────────────┘     └───────────────────┘     └────────┬────────┘
                                                           │
                                                    ┌──────▼──────┐
                                                    │   FFmpeg     │
                                                    │ filter_complex│
                                                    └─────────────┘
```

### Components

| Component | File | Purpose |
|-----------|------|---------|
| **Type System** | `src/types/edl.ts` | Strongly-typed interfaces for all edit decisions |
| **Accumulator** | `src/tools/edl/accumulator.ts` | Stateful collector with validation and optimization |
| **Compiler** | `src/tools/edl/compiler.ts` | EDL → FFmpeg `filter_complex` transformation |
| **Layout Tools** | `src/tools/edl/layoutTools.ts` | High-level API for layout decisions |
| **Transition Tools** | `src/tools/edl/transitionTools.ts` | High-level API for transition decisions |
| **Effect Tools** | `src/tools/edl/effectTools.ts` | High-level API for effect decisions |

## Decision Types

### Layouts — How content is arranged

Layouts control how webcam and screen content are composed within the frame. Only one layout can be active at any time.

| Tool | Description | Key Params |
|------|-------------|------------|
| `only_webcam` | Full-frame webcam feed | — |
| `only_screen` | Full-frame screen capture | — |
| `split_layout` | Stacked screen (65%) + webcam (35%) | `screenPercent`, `webcamPercent` |
| `zoom_webcam` | Zoomed-in webcam | `scale` (default: 1.2) |
| `zoom_screen` | Zoomed-in screen region | `region: { x, y, width, height }` (0-1 normalized) |

### Transitions — How to move between layouts

Transitions define how one layout segment blends into the next.

| Tool | Description | Key Params |
|------|-------------|------------|
| `fade` | Smooth crossfade | `duration` (default: 0.5s) |
| `swipe` | Slide transition | `direction` (left/right/up/down) |
| `zoom_transition` | Dramatic zoom blur | `duration` |
| `cut` | Instant hard cut | — |

### Effects — Overlays and modifications

Effects are applied on top of layouts and can overlap with each other.

| Tool | Description | Key Params |
|------|-------------|------------|
| `text_overlay` | Text with position + animation | `text`, `position`, `animation` (none/fade-in/slide-up/pop) |
| `highlight_region` | Highlight box with animation | `x, y, width, height`, `color`, `animation` (none/pulse/draw), `dimOutside` |
| `slow_motion` | Speed change | `speed` (0.5 = half, 2.0 = double), `preservePitch` |
| `b_roll` | B-roll overlay | `imagePath`, `mode` (fullscreen/pip), `pipSize`, `pipPosition` |
| `fade_to_black` | Fade video + audio to black | `duration` (default: 1.0s) |

## Segment Trimming

The compiler automatically **excludes content gaps** between layout decisions. If layouts cover 0–2s and 3–5s, the gap at 2–3s is cut from the output. This enables the AI agent to trim dead air, filler words, and hesitations simply by leaving gaps in its layout plan — no explicit "cut" instruction needed.

## The Accumulator

`EdlAccumulator` is a stateful collector that agents interact with during planning. Key behaviors:

```typescript
const acc = new EdlAccumulator()

// Auto-generates IDs as "{type}-{number}"
acc.add({ type: 'layout', tool: 'split_layout', startTime: 0, endTime: 30, params: {} })
acc.add({ type: 'effect', tool: 'text_overlay', startTime: 5, endTime: 8, params: { text: 'Hello' } })

// Validation checks
const { valid, errors } = acc.validate()
// - Layout overlaps: two layouts active at the same time → error
// - Transition boundaries: transitions not at layout edges → error
// - Effects can overlap freely

// Build final EDL
const edl = acc.toEdl('/source.mp4', '/output.mp4', webcamRegion)
```

### Optimization

`optimizeEdl()` post-processes the EDL before compilation:

1. **Merges adjacent layouts** — Two consecutive `split_layout` segments with identical params become one
2. **Removes redundant transitions** — Cuts between identical layouts that were merged
3. **Combines overlapping effects** — Same-type effects with matching params are merged into one

## Compiler Implementation

The compiler transforms an `EditDecisionList` into a single FFmpeg `filter_complex` string plus input/output arguments.

### Compilation Pipeline

```
1. Sort decisions by startTime
2. Separate into layouts, transitions, effects
3. For each layout segment:
   a. Trim video: [0:v]trim=start=X:end=Y,setpts=PTS-STARTPTS[segN]
   b. Trim audio: [0:a]atrim=start=X:end=Y,asetpts=PTS-STARTPTS[aN]
   c. Apply layout transformation (crop, scale, vstack)
4. Chain segments with transitions (xfade) or hard concat
5. Overlay effects (drawtext, drawbox, setpts for speed)
6. Handle b-roll as separate inputs with overlay filter
7. Apply audio fade-out for fade_to_black
```

### Key Design Decisions

**Single-pass encoding** — All decisions compile into one `-filter_complex` and one FFmpeg invocation. No intermediate files, no multi-pass encoding.

**Parallel audio trim** — Audio streams are trimmed in parallel with video using `atrim/asetpts`, preventing A/V drift.

**Unique internal labels** — Each segment gets unique labels (`seg0`, `v0`, `a0`, etc.) to prevent filter graph collisions.

### Effect Compilation Details

#### Text Overlay → `drawtext`

```
drawtext=text='Hello':fontsize=48:fontcolor=white:
  x=(w-text_w)/2:y=h-th-60:
  enable='between(t,5,8)':
  alpha='if(lt(t-5,0.4),(t-5)/0.4,1)'     # fade-in animation
```

Supports four animations:
- **none** — static text
- **fade-in** — alpha ramps from 0→1 over 0.4s
- **slide-up** — y position slides from +60px below over 0.4s
- **pop** — fontsize scales 1.4× then back to 1× over 0.4s

#### Highlight Region → `drawbox`

Detects normalized coordinates (0-1 range) and converts to FFmpeg expressions like `iw*0.1`.

Supports:
- **pulse** — oscillating thickness via `abs(sin(t*6.28))`
- **draw** — progressive width reveal using `min()`
- **dimOutside** — adds full-frame `black@0.5` overlay before the highlight box

#### B-Roll → `overlay`

Unlike other effects, b-roll adds extra `-i` inputs to the FFmpeg command:

- **Fullscreen mode** — Scales b-roll to output dimensions, overlays at 0:0
- **Picture-in-picture** — Scales by `pipSize%`, positions at a corner

#### Fade to Black

Combines video fade (`fade=type=out`) and audio fade (`afade=type=out`) at the specified timestamp.

## Type Safety

All 14 param interfaces in `src/types/edl.ts` include `[key: string]: unknown` index signatures, allowing them to satisfy `Record<string, unknown>` constraints when passed through the agent tool call pipeline (JSON-parsed arguments). Type guards like `isLayoutDecision()`, `hasWebcamRegion()`, and the `DEFAULT_*_PARAMS` constants provide runtime validation.

## Test Coverage

The EDL system has comprehensive unit tests:

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `effectTools.test.ts` | 15 | text_overlay position mapping, highlight_region coords/colors, slow_motion speed/pitch |
| `layoutTools.test.ts` | 14 | All 5 layout tools with params, accumulator integration |
| `transitionTools.test.ts` | 12 | All 4 transition tools, duration/direction params |
| `typeGuards.test.ts` | 12 | Type guards, default params verification |
| `compiler.test.ts` | 21 | Full compilation pipeline, all effect types, animations, b-roll |

## Future Directions

- **Keyframe-based effects** — Parameterize animations with keyframe arrays instead of hardcoded 0.4s
- **Audio effects** — Background music ducking, sound effects at timestamps
- **Multi-camera** — Multiple source video support in EDL
- **Preview mode** — Low-resolution preview renders for faster iteration

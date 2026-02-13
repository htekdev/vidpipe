# Vision Agents — Feature Summary

## What We Built

This feature branch (`feature/vision-agents`) adds an AI-powered video production system to vidpipe. The system analyzes videos through multiple modalities — transcript, chapters, visual content, and Gemini video understanding — then plans and executes professional video edits in a single FFmpeg render pass.

## New Capabilities

### 1. Edit Decision List (EDL) System

A **declarative edit description language** that bridges AI planning and FFmpeg execution.

**Architecture:**
- **Type system** (`src/types/edl.ts`) — 14 strongly-typed param interfaces for layouts, transitions, and effects
- **Accumulator** (`src/tools/edl/accumulator.ts`) — Stateful collector with validation, optimization, and EDL construction
- **Compiler** (`src/tools/edl/compiler.ts`) — Transforms EDL → single-pass FFmpeg `filter_complex`
- **Semantic tools** — High-level APIs for layouts (5), transitions (4), and effects (5)

**14 Edit Tools:**

| Category | Tools |
|----------|-------|
| Layouts | `only_webcam`, `only_screen`, `split_layout`, `zoom_webcam`, `zoom_screen` |
| Transitions | `fade`, `swipe`, `zoom_transition`, `cut` |
| Effects | `text_overlay`, `highlight_region`, `slow_motion`, `b_roll`, `fade_to_black` |

**Key innovation: Segment trimming via gaps** — The compiler automatically excludes time gaps between layout decisions, enabling the AI to trim dead air simply by leaving gaps in its plan.

→ Full details: [docs/research/edl-system.md](edl-system.md)

### 2. Gemini Video Understanding

Two vision capabilities powered by Google's Gemini API:

**Video Editorial Analysis** — Upload a raw .mp4 and receive timestamped editorial direction:
- Cut points with transition type recommendations
- Pacing analysis (too slow, dead air, too fast)
- B-roll and graphics suggestions
- Hook rating (1-10) with improvement suggestions
- Content structure (intro/body/outro with timestamps)

**Image Element Detection** — Analyze screenshot frames to detect UI elements with pixel-coordinate bounding boxes. Includes automatic rescaling from Gemini's normalized [0-1000] coordinate space to actual image dimensions.

→ Full details: [docs/research/gemini-video-understanding.md](gemini-video-understanding.md)

### 3. ProducerAgent

An LLM-powered video editor with 7 tools across 4 phases:

1. **Context gathering** — Video info, transcript, chapters, editorial direction
2. **Visual analysis** — Frame capture + Gemini vision for precise UI element detection
3. **Edit planning** — Single `plan_edits` call with all decisions
4. **Automatic rendering** — EDL compilation → FFmpeg execution

The agent receives Gemini's editorial recommendations and translates them into concrete edits: layout changes at chapter boundaries, zoom effects on detected UI elements, text overlays for key points, transitions at recommended cut points.

→ Full details: [docs/research/producer-agent.md](producer-agent.md)

### 4. Five Production Effect Capabilities (Gap Analysis)

Identified and implemented 5 missing production capabilities:

| # | Capability | Implementation | What It Does |
|---|-----------|---------------|-------------|
| 1 | **Segment trimming** | Gap-based exclusion in compiler | Cut dead air by leaving gaps between layouts |
| 2 | **Fade to black** | `fade_to_black` effect tool + compiler | Clean video endings with synced audio/video fade |
| 3 | **Text animations** | `drawtext` with alpha/position/fontsize modifiers | Fade-in, slide-up, pop animations for overlays |
| 4 | **Highlight animations** | `drawbox` with thickness/width modifiers | Pulse and progressive-draw animations |
| 5 | **B-roll overlays** | Extra FFmpeg inputs + overlay filter | Fullscreen or picture-in-picture b-roll |

### 5. VideoAsset System

Abstract base class for lazy-loaded, cached video data:

- `VideoAsset` — Base with metadata, transcript, chapters, captions, layout, editorial direction
- `MainVideoAsset` — Full video with shorts, medium clips, social posts, blog, summary
- `ShortVideoAsset` — Short clip with platform variants and per-clip social posts
- `MediumClipAsset` — Medium clip with per-clip social posts
- Supporting assets: `BlogAsset`, `SocialPostAsset`, `SummaryAsset`

### 6. Comprehensive Test Suite

140+ new tests across 16 files to meet coverage thresholds:

| Category | New Files | Tests Added |
|----------|-----------|-------------|
| EDL tools | 4 | 54 (effectTools, layoutTools, transitionTools, typeGuards) |
| Assets | 5 | 43 (Blog, Short, Medium, SocialPost, Summary + VideoAsset extensions) |
| Core | 1 | 33 (fileSystem-extra) |
| Services | 2 | 24 (queueBuilder, platformContentStrategy) |
| Extensions | 4 | ~30 (process, providers, utilities, VideoAsset) |

**Final coverage:** Statements 73.55%, Branches 64.14%, Functions 78.07%, Lines 73.74%

→ Full details: [docs/research/testing-coverage-strategy.md](testing-coverage-strategy.md)

## Files Changed

### New Files (30+)

**EDL System:**
- `src/types/edl.ts` — Full type system (14 param interfaces, type guards, defaults)
- `src/tools/edl/accumulator.ts` — Stateful decision collector with optimization
- `src/tools/edl/compiler.ts` — EDL → FFmpeg filter_complex compiler
- `src/tools/edl/effectTools.ts` — Text overlay, highlight, slow motion tools
- `src/tools/edl/layoutTools.ts` — 5 layout tools
- `src/tools/edl/transitionTools.ts` — 4 transition tools

**Gemini Integration:**
- `src/tools/gemini/geminiClient.ts` — Video editorial analysis + image element detection

**Agent:**
- `src/agents/ProducerAgent.ts` — AI video producer with 7 tools

**Assets:**
- `src/assets/VideoAsset.ts` — Abstract base class
- `src/assets/MainVideoAsset.ts` — Full video asset
- `src/assets/ShortVideoAsset.ts` — Short clip asset
- `src/assets/MediumClipAsset.ts` — Medium clip asset
- `src/assets/BlogAsset.ts` — Blog post asset
- `src/assets/SocialPostAsset.ts` — Social post asset
- `src/assets/SummaryAsset.ts` — Summary asset

**Tests (16 new/modified):**
- `src/__tests__/edl/effectTools.test.ts`
- `src/__tests__/edl/layoutTools.test.ts`
- `src/__tests__/edl/transitionTools.test.ts`
- `src/__tests__/edl/typeGuards.test.ts`
- `src/__tests__/assets/BlogAsset.test.ts`
- `src/__tests__/assets/ShortVideoAsset.test.ts`
- `src/__tests__/assets/MediumClipAsset.test.ts`
- `src/__tests__/assets/SocialPostAsset.test.ts`
- `src/__tests__/assets/SummaryAsset.test.ts`
- `src/__tests__/core/fileSystem-extra.test.ts`
- `src/__tests__/services/queueBuilder.test.ts`
- `src/__tests__/services/platformContentStrategy.test.ts`

**Research Documentation:**
- `docs/research/edl-system.md`
- `docs/research/gemini-video-understanding.md`
- `docs/research/producer-agent.md`
- `docs/research/testing-coverage-strategy.md`

### Modified Files

- `src/tools/agentTools.ts` — `drawRegions()` FFmpeg special character escaping fix
- `src/__tests__/assets/VideoAsset.test.ts` — +9 tests (metadata edges, chapters/captions force/caching)
- `src/__tests__/core/process.test.ts` — +7 tests (execFileRaw, spawnCommand, execCommandSync)
- `src/__tests__/providers.test.ts` — +3 tests (fromLatePlatform throw, PRU edge cases)
- `src/__tests__/utilities.test.ts` — +2 tests (brand validation with missing/empty fields)

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Single-pass FFmpeg compilation | One render pass = no intermediate files, no quality loss, faster execution |
| Gap-based segment trimming | Natural for AI — just leave gaps instead of explicit cut commands |
| Normalized 0-1 coordinates for effects | Resolution-independent; agent doesn't need to know output dimensions |
| Gemini coordinate rescaling (÷1000) | Worked around Gemini's undocumented normalized coordinate space |
| `EdlAccumulator` pattern | Separates decision collection from compilation; enables validation + optimization |
| Index signatures on EDL param types | Enables `Record<string, unknown>` compatibility for JSON-parsed tool call args |
| Optional Gemini integration | Pipeline works without it; editorial direction gracefully returns unavailable |

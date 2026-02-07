# Research: Medium-Form Video Generation (1–3 Minutes)

> **✅ Implementation Status**
>
> Medium-form clip generation is **implemented** as a pipeline stage using the `MediumVideoAgent`.
>
> | Recommendation | Status | Location |
> |---|---|---|
> | `MediumVideoAgent` (separate from `ShortsAgent`) | ✅ Implemented | `src/agents/MediumVideoAgent.ts` |
> | `MediumClip` and `MediumSegment` types | ✅ Implemented | `src/types/index.ts` |
> | `PipelineStage.MediumClips` | ✅ Implemented | Pipeline runs after Shorts stage |
> | `plan_medium_clips` tool with structured schema | ✅ Implemented | JSON schema matches research proposal |
> | Deep Dive clips (single contiguous segment) | ✅ Implemented | Uses `extractClip()` |
> | Compilation clips (multi-segment with transitions) | ✅ Implemented | Uses `extractCompositeClipWithTransitions()` |
> | `extractCompositeClipWithTransitions()` (Phase 2) | ✅ Implemented | `src/tools/ffmpeg/clipExtraction.ts` |
> | Caption style parameter (`medium`) | ✅ Implemented | `CaptionStyle = 'shorts' \| 'medium' \| 'portrait'` in `captionGenerator.ts` |
> | `--no-medium-clips` skip flag | ✅ Implemented | `src/config/environment.ts` — `SKIP_MEDIUM_CLIPS` |
> | Medium clip social posts | ✅ Implemented | `PipelineStage.MediumClipPosts` in `pipeline.ts` |
> | Output to `medium-clips/` directory | ✅ Implemented | Each clip gets `.mp4`, `.ass`, `.md` files |
> | `hook` and `topic` fields | ✅ Implemented | Part of `MediumClip` interface and agent schema |
> | Highlight Reel clip type | ❌ Not implemented | Only deep-dive and compilation types are supported |
> | `standaloneScore` / `suggestedPlatforms` | ❌ Not implemented | Omitted to keep the agent simpler |
> | Pre-filtering with embeddings (Phase 4) | ❌ Not implemented | LLM handles full transcript directly |
> | Title cards between compilation segments | ❌ Not implemented | Crossfade transitions used instead |
>
> **Key differences from research:**
> - **2 clip types** instead of 3: deep-dive and compilation (no highlight-reel)
> - **2–4 clips** target instead of 2–5
> - No `standaloneScore` or `suggestedPlatforms` fields — simpler schema
> - Crossfade transitions via `xfade` filter replace proposed title cards

> **Goal:** Automatically extract 1–3 minute "medium-form" clips from longer recordings, complementing our existing 15–60s shorts pipeline.

---

## Table of Contents

1. [Medium-Form Content Strategy](#1-medium-form-content-strategy)
2. [Platform-Specific Guidance](#2-platform-specific-guidance)
3. [Segment Identification](#3-segment-identification)
4. [Technical Implementation](#4-technical-implementation)
5. [Multi-Segment Compilation](#5-multi-segment-compilation)
6. [Existing Tools & Approaches](#6-existing-tools--approaches)
7. [Shorts vs Medium vs Full-Length Comparison](#7-shorts-vs-medium-vs-full-length-comparison)
8. [Agent Prompt Design](#8-agent-prompt-design)
9. [Implementation Plan](#9-implementation-plan)
10. [Pipeline Integration](#10-pipeline-integration)

---

## 1. Medium-Form Content Strategy

### Why 1–3 Minutes?

Medium-form fills the gap between shorts (punchy, single-moment clips) and full-length content. Recent data is overwhelmingly in favor of this length:

- **TikTok:** Buffer's analysis of 1.1M TikToks found videos >60 seconds get **43% more reach** and **64% more watch time** than 30–60s clips. TikTok has explicitly stated user behavior is "shifting away from the 21-to-34-second sweet spot." There's a notable completion-rate spike for videos around 2–3 minutes.
- **Instagram Reels:** Extended to 3 minutes in Jan 2025. Reels between 60–90 seconds achieve the **highest average views and engagement** — enough to develop a narrative and deliver real value while still maintaining attention.
- **YouTube:** Shorts now allow up to 3 minutes (late 2024), though the audience still expects brevity. The sweet spot for YouTube mid-roll clips or community content tends to be 1–3 minutes.

### What Makes a Good 1–3 Minute Segment?

Unlike shorts (which are *moments*), medium-form clips are **complete topics**:

| Aspect | Shorts (15–60s) | Medium (1–3 min) |
|--------|-----------------|-------------------|
| Content unit | Single moment, quote, punchline | Complete topic, mini-story, full explanation |
| Narrative | Hook → payoff | Hook → context → body → takeaway/CTA |
| Viewer expectation | Instant gratification | Willing to invest time for depth |
| Editing style | Fast cuts, punchy | Can breathe; transitions between ideas OK |
| Replay value | Loop-friendly | Watch-once but share-worthy |

### Content Structure for Medium-Form

A strong 1–3 minute clip follows this structure:

1. **Hook (0–5s):** Bold statement, question, or surprising claim — identical importance to shorts
2. **Context (5–20s):** Brief setup — why this matters, what problem is being discussed
3. **Body (20s–2:30):** The meat — explanation, story, demonstration, argument
4. **Takeaway / CTA (last 15–30s):** Clear conclusion, key insight, or call to action

---

## 2. Platform-Specific Guidance

### TikTok (60–180s sweet spot for substantive content)
- Algorithm now actively rewards longer content that maintains watch time
- Videos in 3–10 min range received ~2× the views of ultra-short clips
- **Strategy:** Use medium clips as the primary content format; shorter cuts as teasers
- Strong hook in first 3 seconds is non-negotiable regardless of length
- Raw/authentic feel is preferred over heavily produced

### Instagram Reels (60–90s engagement sweet spot)
- Two-path strategy: 15–30s for viral reach, 60–90s for meaningful engagement
- Completion rate and engagement are heavily weighted by the algorithm
- **Strategy:** Target 60–90s for deep-engagement clips; the full 3 minutes is available but use sparingly
- Slick, snappy editing style performs better than raw footage

### YouTube Shorts / Mid-Roll (up to 3 min)
- Bimodal success pattern: ultra-short (~13s) OR full-minute clips
- 3-minute Shorts are experimental; the audience still expects speed
- **Strategy:** Use medium clips as standalone YouTube content or mid-roll excerpts rather than Shorts
- "Get to the point at lightspeed" — front-load value even in longer formats

### LinkedIn / Professional Platforms
- 1–2 minute clips perform well for professional/educational content
- Complete explanations of concepts land better than teasers
- **Strategy:** Ideal platform for medium-form — professionals will invest time for value

---

## 3. Segment Identification

### How Medium Differs from Short Identification

| Criteria | Shorts Selection | Medium Selection |
|----------|-----------------|------------------|
| What to find | Peak moments, quotable lines, emotional spikes | Complete topic discussions, narrative arcs |
| Granularity | Single continuous segment (15–60s) | One or more segments forming a complete idea |
| Selection signal | Energy, humor, controversy, surprise | Topic coherence, problem→solution flow, depth |
| Transcript analysis | Word-level scanning for punchlines | Paragraph/topic-level analysis for theme boundaries |

### Topic Clustering Approaches

**TextTiling Algorithm (used by ClipsAI):**
- Segments text at sentence granularity using word distribution patterns
- Detects topic shifts rather than topics themselves
- Modern variant uses BERT embeddings for semantic similarity between blocks
- Particularly effective for narrative, audio-centric content (podcasts, talks, interviews)

**LLM-Based Narrative Segmentation:**
- Research (Michelmann et al., 2023) shows LLMs can segment narrative events similarly to humans
- GPT-derived annotations achieve good approximation of human consensus for event boundaries
- Our approach: Feed full transcript to LLM, ask it to identify topic boundaries and rate each topic's standalone value

**Recommended Approach — Hybrid:**
1. **Pre-processing:** Use embedding-based topic boundary detection to identify candidate segment boundaries
2. **LLM Selection:** Feed candidate segments to the LLM agent with context about what makes good medium-form content
3. **Scoring:** Have the LLM rate each potential segment on: standalone coherence, entertainment/educational value, hook potential, and clean entry/exit points

### Narrative Arc Detection

For medium-form, look for segments that contain a complete narrative arc:

- **Problem → Solution → Result** — someone describes a challenge and how they solved it
- **Question → Exploration → Insight** — a topic is raised, discussed, and a conclusion reached
- **Setup → Story → Lesson** — anecdote with a takeaway
- **Claim → Evidence → Implication** — argument structure common in educational content

The LLM should be prompted to identify these structures and prefer segments that have a natural beginning and end rather than cutting mid-thought.

### Highlight Reel vs Deep Dive Segments

Two types of medium-form clips should be generated:

1. **Highlight Reel:** Multiple best moments compiled with transitions — a "best of" the full video
2. **Deep Dive:** A single contiguous 1–3 minute section where the speaker goes deep on one topic

---

## 4. Technical Implementation

### Option A: Extend ShortsAgent (Not Recommended)

The existing `ShortsAgent` could be modified to accept a duration range parameter, but this conflates two different content strategies. Shorts and medium-form clips need fundamentally different selection criteria.

### Option B: New MediumVideoAgent (Recommended)

Create a new `MediumVideoAgent` that follows the same pattern as `ShortsAgent` but with:

- Different system prompt focused on complete topics rather than peak moments
- Duration constraint of 60–180 seconds
- Support for both single-segment and multi-segment (compilation) clips
- Different metadata (chapter markers, topic labels)

### Clip Extraction

Our existing `clipExtraction.ts` already supports everything needed:

- **`extractClip()`** — single contiguous segment with configurable buffer padding
- **`extractCompositeClip()`** — multiple non-contiguous segments concatenated via FFmpeg concat demuxer with re-encoding for clean joins

Both work identically for 1–3 min clips as they do for shorts. No changes needed to the extraction layer.

### Caption Generation

Existing caption tooling (`generateStyledASSForSegment`, `generateStyledASSForComposite`) generates ASS subtitle files from transcript data. For medium clips:

- Same approach works — caption burning via FFmpeg is length-agnostic
- Consider slightly different styling for medium clips vs shorts:
  - Shorts: Large, centered, 2–3 words at a time (TikTok style)
  - Medium: Slightly smaller, bottom-positioned, more words per line (YouTube style)
- This could be a `captionStyle` parameter on the generation function

### Editing Style Differences

For medium-form clips, consider:

| Feature | Shorts | Medium |
|---------|--------|--------|
| Caption style | Large, centered, animated | Standard subtitle positioning |
| Transitions | None (hard cuts) | Crossfade between non-contiguous segments (0.3–0.5s) |
| Title card | Optional | Recommended (topic title at start) |
| Lower third | No | Optional topic label |
| Aspect ratio | 9:16 (vertical) | 16:9 (horizontal) or 9:16 depending on platform |

---

## 5. Multi-Segment Compilation

### Combining Non-Contiguous Segments

For "highlight reel" type medium clips that pull from multiple parts of the video:

**FFmpeg Approaches:**

1. **Concat Demuxer (current approach):** Extract each segment → re-encode → concatenate via file list. Already implemented in `extractCompositeClip()`. Works well for hard cuts.

2. **xfade Filter (for transitions):** FFmpeg's `xfade` filter enables crossfade transitions between segments. Requires filter_complex graph:
   ```
   ffmpeg -i seg1.mp4 -i seg2.mp4 -i seg3.mp4 \
     -filter_complex "[0][1]xfade=transition=fade:duration=0.5:offset=<seg1_duration-0.5>[v01]; \
                      [v01][2]xfade=transition=fade:duration=0.5:offset=<combined-0.5>[vout]" \
     -map "[vout]" output.mp4
   ```
   Available transitions: fade, wipeleft, wiperight, slidedown, slideup, circlecrop, etc.

3. **Title Cards Between Segments:** Generate a simple title card frame (black bg, white text) as a short video clip, insert between segments during concatenation. Can be created with FFmpeg:
   ```
   ffmpeg -f lavfi -i "color=black:s=1920x1080:d=2" \
     -vf "drawtext=text='Topic Name':fontcolor=white:fontsize=48:x=(w-tw)/2:y=(h-th)/2" \
     title-card.mp4
   ```

### Maintaining Narrative Flow

When combining segments:

- **Same-topic segments:** Use short crossfade (0.3s) — feels like a natural edit
- **Different-topic segments (compilation):** Use title card or 0.5s fade-to-black between segments
- **Sequential segments with gap:** Brief crossfade works; the viewer won't notice small time jumps if the topic is coherent
- **Order matters:** The LLM should specify segment order based on narrative logic, not just chronological video order

### Implementation Additions Needed

1. **`extractCompositeClipWithTransitions()`** — new function that uses xfade instead of hard concat
2. **`generateTitleCard()`** — creates a short (1–2s) title card video segment
3. **Compilation builder** — orchestrates segments + transitions + optional title cards

---

## 6. Existing Tools & Approaches

### OpusClip
- Market leader; 12M+ users; processes 60-min videos in <5 minutes
- **ClipAnything:** Multimodal AI that analyzes visual, audio, and sentiment cues simultaneously
- Supports clip lengths up to 15 minutes (OpusClip 3.0+)
- Generates clips with auto-captions, speaker tracking, AI b-roll
- Uses prompt-based clipping — "give me the most viral moments" or "find all mentions of [topic]"
- **Key insight:** They moved beyond short-only; supporting longer clips was a major v3.0 feature

### ClipsAI (Open Source)
- Python library; MIT license; designed for narrative/audio-centric content
- Uses **TextTiling algorithm with BERT embeddings** for topic segmentation
- Segments transcript at sentence boundaries by detecting topic shifts
- Returns clips of varying lengths — naturally produces both short and medium segments
- Also handles aspect ratio conversion (16:9 → 9:16)
- **Key insight:** Topic-shift detection is the core algorithm; clip length is a natural output, not a forced constraint

### Vidyo.ai
- Similar to OpusClip but with less customization
- Supports YouTube links as input
- Text addition feature for captions/titles
- Less effective speaker tracking compared to OpusClip

### AssemblyAI Topic Segmentation
- API-based; uses auto chapters feature to split video into semantically isolated sections
- Generates chapter titles via LLM
- Outputs timestamp boundaries suitable for clip extraction
- **Key insight:** Treating video sections as "chapters" naturally maps to medium-form clip boundaries

### Munch
- AI-driven; focuses on identifying "key moments" with engagement prediction
- Analyzes social trends to recommend which clips will perform best
- Less focused on narrative coherence, more on virality signals

### Key Takeaways from Tools

1. **Topic segmentation is the foundation** — all successful tools start with transcript analysis to find topic boundaries
2. **Clip length should be flexible** — let the content determine length rather than forcing arbitrary cuts
3. **Multimodal analysis helps** — combining transcript analysis with audio energy/sentiment improves clip quality
4. **LLM-based selection is the trend** — prompt-driven clip selection (like OpusClip's ClipAnything) outperforms rule-based approaches

---

## 7. Shorts vs Medium vs Full-Length Comparison

| Dimension | Shorts (15–60s) | Medium (1–3 min) | Full-Length |
|-----------|-----------------|-------------------|-------------|
| **Purpose** | Attention grabber, discovery | Value delivery, engagement | Complete experience |
| **Content type** | Single moment | Complete topic | Full session/talk |
| **Selection criteria** | Peak energy, quotability | Topic coherence, narrative arc | N/A (entire recording) |
| **Platform fit** | TikTok, Reels, Shorts | TikTok, Reels, YouTube, LinkedIn | YouTube, website |
| **Editing effort** | Minimal (cut + caption) | Moderate (transitions, title cards) | Full production |
| **Viewer intent** | Browsing/discovery | Learning/engagement | Dedicated viewing |
| **Shareability** | High (low commitment) | High (delivers value) | Low (requires investment) |
| **Algorithm signal** | Completion rate, replays | Watch time, engagement | Session time |
| **Our pipeline stage** | `ShortsAgent` (existing) | `MediumVideoAgent` (proposed) | Full video (existing) |
| **Extraction method** | `extractClip` / `extractCompositeClip` | Same + transitions | Silence removal + captions |
| **Caption style** | Large centered, animated | Standard subtitles | Standard subtitles |

---

## 8. Agent Prompt Design

### MediumVideoAgent System Prompt (Draft)

```
You are a medium-form video content strategist. Your job is to analyze a video
transcript with word-level timestamps and identify the best 1–3 minute segments
to extract as standalone medium-form clips.

## What to look for

- **Complete topics** — a subject is introduced, explored, and concluded
- **Narrative arcs** — problem → solution → result; question → exploration → insight
- **Educational deep dives** — clear, thorough explanations of complex topics
- **Compelling stories** — anecdotes with setup, tension, and resolution
- **Strong arguments** — claim → evidence → implication sequences
- **Topic compilations** — multiple brief mentions of one theme across the video
  that can be compiled into a cohesive 1–3 minute segment

## Clip types

- **Deep Dive** — a single contiguous section (1–3 min) covering one topic in depth
- **Compilation** — multiple non-contiguous segments stitched together around a
  single theme or narrative thread (1–3 min total)
- **Highlight Reel** — the 3–5 best moments from the full video, compiled with
  transitions into a "best of" clip (2–3 min)

## Rules

1. Each clip must be 60–180 seconds total duration.
2. Timestamps must align to word boundaries from the transcript.
3. Prefer natural sentence and paragraph boundaries for clean entry/exit points.
4. Each clip must be self-contained — a viewer with no other context should
   understand and get value from the clip.
5. Aim for 2–5 medium clips per video, depending on length and richness.
6. Every clip needs a descriptive title (5–12 words) and a topic label.
7. For compilations, specify segments in the order they should appear in the
   final clip (which may differ from chronological order).
8. Tags should be lowercase, no hashes, 3–6 per clip.
9. Rate each clip's standalone value on a scale of 1–10.
10. A 1-second buffer is automatically added around each segment boundary.

## Differences from shorts

- Shorts capture *moments*; medium clips capture *complete ideas*.
- Don't just find the most exciting 60 seconds — find where a topic starts and
  where it naturally concludes.
- It's OK if a medium clip has slower pacing — depth and coherence matter more
  than constant high energy.

When you have identified the clips, call the **plan_medium_clips** tool with
your complete plan.
```

### Tool Schema (Draft)

```json
{
  "type": "object",
  "properties": {
    "clips": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "topicLabel": { "type": "string" },
          "description": { "type": "string" },
          "clipType": { "enum": ["deep-dive", "compilation", "highlight-reel"] },
          "tags": { "type": "array", "items": { "type": "string" } },
          "standaloneScore": { "type": "number", "minimum": 1, "maximum": 10 },
          "segments": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "start": { "type": "number" },
                "end": { "type": "number" },
                "description": { "type": "string" }
              },
              "required": ["start", "end", "description"]
            }
          },
          "suggestedPlatforms": {
            "type": "array",
            "items": { "enum": ["tiktok", "instagram", "youtube", "linkedin"] }
          }
        },
        "required": ["title", "topicLabel", "description", "clipType", "tags", "standaloneScore", "segments"]
      }
    }
  },
  "required": ["clips"]
}
```

---

## 9. Implementation Plan

### Phase 1: Core Agent (Minimal Viable)

1. **Create `MediumVideoAgent.ts`** — follows `ShortsAgent` pattern
   - New system prompt (see §8)
   - `plan_medium_clips` tool with schema
   - Duration constraint: 60–180s
   - `MediumClip` type (extends `ShortClip` with `clipType`, `topicLabel`, `standaloneScore`)

2. **Add `MediumClip` types to `types/index.ts`**
   - `MediumClip` interface
   - `MediumSegment` interface
   - `PipelineStage.MediumClips` enum value

3. **Reuse existing extraction tooling**
   - `extractClip()` for single-segment deep dives
   - `extractCompositeClip()` for compilations
   - Existing caption generation for subtitle files

### Phase 2: Enhanced Editing

4. **Add `extractCompositeClipWithTransitions()`** to `clipExtraction.ts`
   - xfade-based transitions between segments
   - Configurable transition type and duration

5. **Add `generateTitleCard()`** utility
   - FFmpeg drawtext on color source
   - Used for compilation clips between topic segments

6. **Caption style parameter**
   - Add `captionStyle: 'shorts' | 'standard'` to caption generation
   - Shorts: large centered animated text
   - Standard: bottom-positioned, more words per line

### Phase 3: Pipeline Integration

7. **Add `MediumClips` stage to `pipeline.ts`**
   - Runs after Shorts stage (or in parallel)
   - Uses original transcript (not adjusted) for timestamp accuracy
   - Outputs to `medium-clips/` directory alongside `shorts/`

8. **Social media post generation for medium clips**
   - Platform-specific posts with different angles than shorts
   - Include topic label and longer descriptions

### Phase 4: Refinement

9. **Pre-filtering with embeddings** (optional)
   - Use sentence embeddings to cluster transcript segments by topic
   - Pass topic clusters to LLM to reduce token usage on long transcripts

10. **Quality scoring and filtering**
    - Only output clips with `standaloneScore >= 7`
    - Log but skip lower-scoring clips

---

## 10. Pipeline Integration

### Current Pipeline Flow

```
Ingestion → Transcription → Silence Removal → Captions → Caption Burn
  → Shorts → Summary → Social Media → Short Posts → Blog → Git Push
```

### Proposed Pipeline Flow

```
Ingestion → Transcription → Silence Removal → Captions → Caption Burn
  → Shorts → Medium Clips → Summary → Social Media → Short Posts
  → Medium Posts → Blog → Git Push
```

### Output Directory Structure

```
recordings/<slug>/
├── <slug>.mp4                    # Original video
├── <slug>-captioned.mp4          # Full video with captions
├── shorts/
│   ├── catchy-title.mp4          # Raw short clip
│   ├── catchy-title-captioned.mp4
│   ├── catchy-title.ass
│   └── catchy-title.md
├── medium-clips/                 # NEW
│   ├── deep-dive-topic.mp4
│   ├── deep-dive-topic-captioned.mp4
│   ├── deep-dive-topic.ass
│   ├── deep-dive-topic.md
│   ├── highlight-reel.mp4
│   └── highlight-reel.md
├── social-posts/
├── transcript.json
├── transcript-edited.json
└── README.md
```

### Code Touchpoints

| File | Change |
|------|--------|
| `src/types/index.ts` | Add `MediumClip`, `MediumSegment`, `PipelineStage.MediumClips` |
| `src/agents/MediumVideoAgent.ts` | New file — core agent |
| `src/pipeline.ts` | Add medium clips stage, wire into pipeline |
| `src/tools/ffmpeg/clipExtraction.ts` | (Phase 2) Add transition-based composite extraction |
| `src/tools/captions/captionGenerator.ts` | (Phase 2) Add caption style parameter |

---

## References

- [Buffer: Longer TikToks Get More Views (1.1M TikToks analyzed)](https://buffer.com/resources/longer-tiktoks-get-more-views-data/)
- [Shortimize: Video Length Sweet Spots 2025](https://www.shortimize.com/blog/video-length-sweet-spots-tiktok-reels-shorts)
- [ClipsAI: Open-source Python clipping library](https://github.com/ClipsAI/clipsai)
- [ClipsAI Docs: TextTiling with BERT Embeddings](https://www.clipsai.com/references/clip)
- [AssemblyAI: Auto video sections with AI](https://www.assemblyai.com/blog/automatically-determine-video-sections-with-ai-using-python)
- [Michelmann et al. (2023): LLMs segment narrative events similarly to humans](https://arxiv.org/abs/2301.10297)
- [OpusClip 3.0: Clip Different (supports up to 15-min clips)](https://www.opus.pro/blog/opusclip-clip-different)
- [OpusClip ClipAnything: Multimodal AI clipping](https://www.opus.pro/clipanything)
- [Mux: Stitch multiple videos with FFmpeg](https://www.mux.com/articles/stitch-multiple-videos-together-with-ffmpeg)
- [Rickkorsten/ffmpeg-transitions: xfade transition library](https://github.com/Rickkorsten/ffmpeg-transitions)
- [PlayPlay: Best Video Length for Engagement](https://playplay.com/blog/video-length/)

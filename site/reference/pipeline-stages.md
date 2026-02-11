---
title: Pipeline Stages
---

# Pipeline Stages

VidPipe executes a 15-stage pipeline for each video. Each stage is wrapped in `runStage()` which catches errors — a stage failure does **not** abort the pipeline. Subsequent stages proceed with whatever data is available.

## Stage Overview

| # | Stage | Description |
|---|-------|-------------|
| 1 | [Ingestion](#_1-ingestion) | Copies video into the repo structure, extracts metadata with FFprobe |
| 2 | [Transcription](#_2-transcription) | Extracts audio and runs OpenAI Whisper for word-level transcription |
| 3 | [Silence Removal](#_3-silence-removal) | AI detects and removes dead-air segments, capped at 20% of video |
| 4 | [Captions](#_4-captions) | Generates SRT, VTT, and ASS subtitle files with karaoke highlighting |
| 5 | [Caption Burn](#_5-caption-burn) | Burns ASS captions into the video via FFmpeg |
| 6 | [Shorts](#_6-shorts) | AI identifies best 15–60s moments and extracts clip variants |
| 7 | [Medium Clips](#_7-medium-clips) | AI identifies 1–3 min standalone segments with crossfade transitions |
| 8 | [Chapters](#_8-chapters) | AI detects topic boundaries and outputs chapter markers |
| 9 | [Summary](#_9-summary) | AI writes a Markdown README with key-frame screenshots |
| 10 | [Social Media](#_10-social-media) | Generates platform-tailored posts for 5 platforms |
| 11 | [Short Posts](#_11-short-posts) | Generates per-short social media posts for all 5 platforms |
| 12 | [Medium Clip Posts](#_12-medium-clip-posts) | Generates per-medium-clip social media posts for all 5 platforms |
| 13 | [Queue Build](#_13-queue-build) | Copies posts and video variants into `publish-queue/` for review |
| 14 | [Blog](#_14-blog) | AI writes a dev.to-style blog post with web-sourced links |
| 15 | [Git Push](#_15-git-push) | Auto-commits and pushes all generated assets |

## Data Flow

Two transcripts flow through the pipeline:

- **Adjusted transcript** — timestamps shifted to match the silence-removed video. Used by **captions** (stages 4–5) so subtitles align with the edited video.
- **Original transcript** — unmodified Whisper output. Used by **shorts**, **medium clips**, and **chapters** (stages 6–8) because clips are cut from the original video.

Shorts and chapters are generated before the summary so the README can reference them.

## Stage Details

### 1. Ingestion

Copies the video file into the repo's `recordings/{slug}/` directory and extracts metadata using FFprobe.

| | |
|---|---|
| **Input** | Path to a `.mp4` video file |
| **Output** | `VideoFile` object with `slug`, `duration`, `size`, `repoPath`, `videoDir` |
| **Tools** | FFprobe (duration, resolution, file size) |
| **Skip flag** | — (required; pipeline aborts if ingestion fails) |
| **Enum** | `PipelineStage.Ingestion` |

### 2. Transcription

Extracts audio from the video as a 64 kbps mono MP3, then sends it to OpenAI Whisper for transcription. Files larger than 25 MB are automatically chunked and results are merged.

| | |
|---|---|
| **Input** | `VideoFile` (ingested video) |
| **Output** | `transcript.json` — segments, words with start/end timestamps, detected language, duration |
| **Tools** | FFmpeg (audio extraction), OpenAI Whisper API (`whisper-1`) |
| **Skip flag** | — |
| **Enum** | `PipelineStage.Transcription` |

### 3. Silence Removal

Detects silence regions in the audio using FFmpeg's `silencedetect` filter. An AI agent then decides which regions to remove, capping total removal at 20% of the video duration. The video is trimmed using `singlePassEdit()`.

| | |
|---|---|
| **Input** | `VideoFile`, `Transcript` |
| **Output** | `{slug}-edited.mp4`, `transcript-edited.json` (adjusted timestamps) |
| **Agent** | `SilenceRemovalAgent` — tools: `detect_silence`, `decide_removals` |
| **Tools** | FFmpeg (`silencedetect` filter, segment-based trim) |
| **Skip flag** | `--no-silence-removal` |
| **Enum** | `PipelineStage.SilenceRemoval` |

### 4. Captions

Generates subtitle files from the transcript. Uses the adjusted transcript (post silence-removal) when available, otherwise the original. No AI agent is needed — this is a direct format conversion.

| | |
|---|---|
| **Input** | Adjusted or original `Transcript` |
| **Output** | `captions/captions.srt`, `captions/captions.vtt`, `captions/captions.ass` |
| **Formats** | SRT (SubRip), VTT (WebVTT), ASS (Advanced SubStation Alpha with karaoke word highlighting) |
| **Skip flag** | `--no-captions` |
| **Enum** | `PipelineStage.Captions` |

### 5. Caption Burn

Burns the ASS subtitle file into the video using FFmpeg. When silence was also removed, uses `singlePassEditAndCaption()` to combine silence removal and caption burning in a single re-encode pass from the original video. Otherwise, uses `burnCaptions()` standalone.

| | |
|---|---|
| **Input** | ASS caption file, edited or original video, keep-segments (if silence was removed) |
| **Output** | `{slug}-captioned.mp4` |
| **Tools** | FFmpeg (`ass` subtitle filter) |
| **Skip flag** | `--no-captions` |
| **Enum** | `PipelineStage.CaptionBurn` |

### 6. Shorts

An AI agent analyzes the **original** transcript to identify the best 15–60 second moments. Clips can be single segments or composites (multiple non-contiguous segments concatenated). Each short is extracted and then rendered in platform-specific variants.

| | |
|---|---|
| **Input** | `VideoFile`, original `Transcript` |
| **Output** | Per short: `{slug}.mp4` (landscape), `-portrait.mp4` (9:16), `-square.mp4` (1:1), `-feed.mp4` (4:5), `-captioned.mp4`, `-portrait-captioned.mp4`, `{slug}.md` |
| **Agent** | `ShortsAgent` — tool: `plan_shorts` |
| **Tools** | FFmpeg (segment extraction, aspect-ratio variants, caption burning, portrait hook overlay) |
| **Skip flag** | `--no-shorts` |
| **Enum** | `PipelineStage.Shorts` |

### 7. Medium Clips

An AI agent identifies 1–3 minute standalone segments from the **original** transcript. Composite clips use crossfade (xfade) transitions between segments. Captions are burned with medium style (smaller, bottom-positioned).

| | |
|---|---|
| **Input** | `VideoFile`, original `Transcript` |
| **Output** | Per clip: `{slug}.mp4`, `{slug}-captioned.mp4`, `{slug}.md` |
| **Agent** | `MediumVideoAgent` — tool: `plan_medium_clips` |
| **Tools** | FFmpeg (segment extraction, xfade transitions, caption burning) |
| **Skip flag** | `--no-medium-clips` |
| **Enum** | `PipelineStage.MediumClips` |

### 8. Chapters

An AI agent analyzes the **original** transcript to detect topic boundaries, producing chapter markers in four formats.

| | |
|---|---|
| **Input** | `VideoFile`, original `Transcript` |
| **Output** | `chapters/chapters.json`, `chapters/chapters.md`, `chapters/chapters.ffmetadata`, `chapters/chapters-youtube.txt` |
| **Agent** | `ChapterAgent` — tool: `generate_chapters` |
| **Formats** | JSON (structured data), Markdown (table), FFmpeg metadata, YouTube description timestamps |
| **Skip flag** | — |
| **Enum** | `PipelineStage.Chapters` |

### 9. Summary

An AI agent captures key frames from the video and writes a narrative `README.md` with brand voice. Runs after shorts and chapters so it can reference them in the summary.

| | |
|---|---|
| **Input** | `VideoFile`, `Transcript`, `ShortClip[]`, `Chapter[]` |
| **Output** | `README.md` (with embedded screenshots), key-frame images |
| **Agent** | `SummaryAgent` — tools: `capture_frame`, `write_summary` |
| **Skip flag** | — |
| **Enum** | `PipelineStage.Summary` |

### 10. Social Media

An AI agent generates platform-specific posts for the full video across 5 platforms: TikTok, YouTube, Instagram, LinkedIn, and X. Uses Exa web search to find relevant links.

| | |
|---|---|
| **Input** | `VideoFile`, `Transcript`, `VideoSummary` |
| **Output** | `social-posts/tiktok.md`, `youtube.md`, `instagram.md`, `linkedin.md`, `x.md` |
| **Agent** | `SocialMediaAgent` — tools: `search_links`, `create_posts` |
| **Platforms** | TikTok (2200 chars), YouTube (5000), Instagram (2200), LinkedIn (3000), X (280) |
| **Skip flag** | `--no-social` |
| **Enum** | `PipelineStage.SocialMedia` |

### 11. Short Posts

For each short clip, generates per-platform social media posts. Posts are saved alongside the short clip.

| | |
|---|---|
| **Input** | `VideoFile`, `ShortClip`, `Transcript` |
| **Output** | `shorts/{slug}/posts/{platform}.md` for each platform |
| **Agent** | `ShortPostsAgent` (reuses `SocialMediaAgent` logic) |
| **Skip flag** | `--no-social` |
| **Enum** | `PipelineStage.ShortPosts` |

### 12. Medium Clip Posts

For each medium clip, generates per-platform social media posts. Posts are saved alongside the medium clip.

| | |
|---|---|
| **Input** | `VideoFile`, `MediumClip`, `Transcript` |
| **Output** | `medium-clips/{slug}/posts/{platform}.md` for each platform |
| **Agent** | `MediumClipPostsAgent` (reuses `SocialMediaAgent` logic) |
| **Skip flag** | `--no-social` |
| **Enum** | `PipelineStage.MediumClipPosts` |

### 13. Queue Build

Copies social media posts and video variants into a flat `publish-queue/` folder for review and scheduling before publishing. Only runs when social posts were generated.

| | |
|---|---|
| **Input** | `VideoFile`, `ShortClip[]`, `MediumClip[]`, `SocialPost[]`, captioned video path |
| **Output** | `publish-queue/` directory with flattened posts and video files |
| **Skip flag** | `--no-social-publish` |
| **Enum** | `PipelineStage.QueueBuild` |

### 14. Blog

An AI agent writes a dev.to-style blog post (800–1500 words) with YAML frontmatter. Uses Exa web search to find relevant links to include.

| | |
|---|---|
| **Input** | `VideoFile`, `Transcript`, `VideoSummary` |
| **Output** | `social-posts/devto.md` |
| **Agent** | `BlogAgent` — tools: `search_web`, `write_blog` |
| **Skip flag** | — |
| **Enum** | `PipelineStage.Blog` |

### 15. Git Push

Runs `git add -A`, `git commit`, and `git push` for all generated assets in the recording folder.

| | |
|---|---|
| **Input** | `slug` (recording folder name) |
| **Output** | Git commit on `origin main` |
| **Skip flag** | `--no-git` |
| **Enum** | `PipelineStage.GitPush` |

## Error Handling

Each stage is wrapped in `runStage()` which:

1. Records the current stage for cost tracking
2. Executes the stage function in a try/catch
3. Logs success or failure with wall-clock duration
4. Pushes a `StageResult` record (success, error message, duration in ms)
5. Returns `undefined` on failure so callers can null-check

This design produces partial results — if shorts generation fails, the summary and social posts can still be generated from the transcript. The only exception is **Ingestion** (stage 1), which aborts the pipeline if it fails since all subsequent stages depend on video metadata.

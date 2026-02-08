# Getting Started

Get up and running with **vidpipe** in under five minutes.

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|-----------------|-------|
| **Node.js** | 20+ | [Download](https://nodejs.org/) |
| **FFmpeg** | 6.0+ | Must be on `PATH` or configured via env vars. See [FFmpeg Setup](./ffmpeg-setup.md). |
| **OpenAI API key** | — | For Whisper transcription (and for agents only when `LLM_PROVIDER=openai`). [Get a key](https://platform.openai.com/api-keys) |
| **GitHub Copilot** | Active subscription | Default LLM provider for AI agents via [Copilot SDK](https://github.com/github/copilot-sdk). Alternative providers (OpenAI, Claude) are also supported — see [Configuration](./configuration.md#llm-provider). |
| **Git** | 2.x+ | Only needed if git auto-commit is enabled (on by default) |
| **Exa AI API key** | — | *Optional* — enables web-search links in social media posts |

---

## Installation

Install globally from npm:

```bash
npm install -g vidpipe
```

Or run directly with `npx`:

```bash
npx vidpipe --once /path/to/video.mp4
```

### From source

```bash
git clone https://github.com/htekdev/vidpipe.git
cd vidpipe
npm install
npm run build
npm start
```

---

## Quick Start

### 1. Process a single video

```bash
vidpipe --once /path/to/video.mp4
```

Or pass the file directly (implies `--once`):

```bash
vidpipe /path/to/video.mp4
```

### 2. Watch a folder for new recordings

```bash
vidpipe --watch-dir ~/Videos/Recordings
```

The tool monitors the folder and automatically processes any new `.mp4` that appears.

### 3. Full example with all options

```bash
vidpipe \
  --watch-dir ~/Videos/Recordings \
  --output-dir ~/Content/processed \
  --openai-key sk-... \
  --exa-key exa-... \
  --brand ./my-brand.json \
  --verbose
```

---

## First Run

### Pre-flight check

Before processing your first video, verify all prerequisites are installed:

```bash
vidpipe --doctor
```

This checks for Node.js, FFmpeg, API keys, and folder permissions in one shot.

### Expected processing time

| Stage | Time (per 10 min of video) |
|-------|---------------------------|
| Transcription (Whisper API) | 1–3 minutes |
| AI analysis (shorts, summaries, social posts) | 2–5 minutes |
| Video processing (FFmpeg clip extraction) | 1–3 minutes per short clip |
| **Total** | **~5–15 minutes** for a typical 10–30 min recording |

### What gets created

After the pipeline finishes, your output folder will contain:

- **Transcripts** — full word-level JSON transcripts (original + silence-removed)
- **Edited video** — silence-removed and captioned versions of the full recording
- **Shorts** — AI-selected highlight clips with captions and portrait variants
- **Summaries** — a Markdown README with embedded screenshots
- **Social posts** — platform-tailored drafts for TikTok, YouTube, Instagram, LinkedIn, and X
- **Blog post** — long-form Markdown article generated from the transcript

See the [full output structure](#what-it-produces) below for the complete directory layout.

### Common first-run issues

| Symptom | Fix |
|---------|-----|
| `Missing required: OPENAI_API_KEY` | Set `OPENAI_API_KEY` in your `.env` file or pass `--openai-key` |
| FFmpeg errors or codec failures | Run `vidpipe --doctor` to diagnose — usually a missing or outdated FFmpeg install |
| No videos detected | Verify your watch folder path matches the `WATCH_FOLDER` env var (or `--watch-dir` flag) |
| Processing takes a long time | Normal for first run — the Whisper API call dominates; subsequent runs with cached transcripts are faster |

---

## Configuration

There are three ways to configure the tool (highest priority first):

1. **CLI flags** — e.g. `--openai-key sk-...`
2. **Environment variables** — e.g. `OPENAI_API_KEY=sk-...`
3. **`.env` file** — automatically loaded from the current working directory

Create a `.env` file for convenience:

```env
OPENAI_API_KEY=sk-your-key-here
WATCH_FOLDER=/home/you/Videos/Recordings
OUTPUT_DIR=/home/you/Content/processed
# EXA_API_KEY=your-exa-key     # optional
```

> **Tip:** Copy the included `.env.example` as a starting point.

For the full configuration reference, see the [Configuration Guide](./configuration.md).

---

## What It Produces

After processing a video, the tool creates a rich output directory:

```
recordings/
└── my-awesome-demo/
    ├── my-awesome-demo.mp4              # Original video copy
    ├── my-awesome-demo-edited.mp4       # Silence-removed version
    ├── my-awesome-demo-captioned.mp4    # Captioned final video
    ├── README.md                        # AI-generated summary with screenshots
    ├── transcript.json                  # Full transcript (word-level timestamps)
    ├── transcript-edited.json           # Adjusted transcript (after silence removal)
    ├── blog-post.md                     # Long-form blog post
    ├── thumbnails/
    │   ├── snapshot-001.png             # Key-moment screenshots
    │   ├── snapshot-002.png
    │   └── ...
    ├── shorts/
    │   ├── catchy-clip-title.mp4        # Extracted short clip
    │   ├── catchy-clip-title-captioned.mp4
    │   ├── catchy-clip-title-portrait.mp4  # 9:16 platform variant
    │   ├── catchy-clip-title.ass        # Caption file
    │   ├── catchy-clip-title.md         # Clip metadata & description
    │   └── ...
    ├── medium-clips/
    │   ├── topic-deep-dive.mp4          # 1–3 minute topic clip
    │   ├── topic-deep-dive-captioned.mp4
    │   ├── topic-deep-dive.ass
    │   ├── topic-deep-dive.md
    │   └── ...
    ├── chapters/
    │   ├── chapters.json                # Canonical chapter data
    │   ├── chapters-youtube.txt         # YouTube description timestamps
    │   ├── chapters.md                  # Markdown table
    │   └── chapters.ffmetadata          # FFmpeg metadata format
    └── social-posts/
        ├── tiktok.md                    # TikTok post draft
        ├── youtube.md                   # YouTube description
        ├── instagram.md                 # Instagram caption
        ├── linkedin.md                  # LinkedIn post
        └── x.md                         # X (Twitter) post
```

### Pipeline stages

| # | Stage | What happens |
|---|-------|-------------|
| 1 | **Ingestion** | Copies video into output dir, extracts metadata with FFprobe |
| 2 | **Transcription** | Extracts audio → sends to OpenAI Whisper for word-level transcription |
| 3 | **Silence Removal** | AI detects dead-air segments and cuts them out |
| 4 | **Captions** | Generates `.ass` subtitle file from transcript |
| 5 | **Caption Burn** | Burns captions into the video with FFmpeg (single-pass when combined with silence removal) |
| 6 | **Shorts** | AI identifies compelling moments, FFmpeg cuts clips + generates platform variants |
| 7 | **Medium Clips** | AI extracts 1–3 minute standalone topic segments with crossfade transitions |
| 8 | **Chapters** | AI analyses transcript for topic boundaries, generates chapter markers in multiple formats |
| 9 | **Summary** | AI writes a Markdown README with embedded screenshots |
| 10 | **Social Media** | AI generates platform-tailored posts (TikTok, YouTube, Instagram, LinkedIn, X) |
| 11 | **Short Posts** | AI generates social posts for each short clip |
| 12 | **Medium Clip Posts** | AI generates social posts for each medium clip |
| 13 | **Blog Post** | AI writes a long-form blog post from the transcript |
| 14 | **Git Push** | Auto-commits and pushes all output to your repo |

---

## Next Steps

- [Configuration Guide](./configuration.md) — all CLI flags, env vars, and skip options
- [FFmpeg Setup](./ffmpeg-setup.md) — platform-specific installation instructions
- [Brand Customization](./brand-customization.md) — tailor AI output to your personal brand

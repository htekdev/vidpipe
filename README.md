[![CI](https://github.com/htekdev/vidpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/htekdev/vidpipe/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vidpipe)](https://www.npmjs.com/package/vidpipe)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-brightgreen)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)

# 🎬 VidPipe

**Drop a video. Get transcripts, summaries, short clips, captions, blog posts, and social media posts — automatically.**

An AI-powered CLI pipeline that watches for new video recordings and transforms them into rich, structured content using [GitHub Copilot SDK](https://github.com/github/copilot-sdk) agents and OpenAI Whisper.

```bash
npm install -g vidpipe
```

---

## ✨ Features

- 🎬 **14-Stage Automated Pipeline** — Drop a video and walk away; everything runs end-to-end
- 🎙️ **Whisper Transcription** — Word-level timestamps via OpenAI Whisper API
- 🔇 **AI-Driven Silence Removal** — Conservative, context-aware dead-air detection (capped at 20% removal)
- 📐 **Smart Split-Screen Layouts** — Webcam + screen content for 3 aspect ratios: portrait (9:16), square (1:1), and feed (4:5)
- 🔍 **Edge-Based Webcam Detection** — Detects webcam overlay position via skin-tone analysis and inter-frame edge refinement (no hardcoded margins)
- 🎯 **Face-Aware AR-Matched Cropping** — Webcam region is aspect-ratio-matched and center-cropped to fill each layout with no black bars
- 💬 **Karaoke Captions** — Opus Clips-style word-by-word highlighting with green active word on portrait, yellow on landscape
- 🪝 **Hook Overlays** — Animated title text burned into portrait short clips
- ✂️ **Short Clips** — AI identifies the best 15–60s moments, supports composite (multi-segment) shorts
- 🎞️ **Medium Clips** — 1–3 min standalone segments for deeper content with crossfade transitions
- 📑 **Chapter Detection** — AI-identified topic boundaries in 4 formats (JSON, Markdown, FFmetadata, YouTube timestamps)
- 📱 **Social Media Posts** — Platform-tailored content for TikTok, YouTube, Instagram, LinkedIn, and X
- 📰 **Dev.to Blog Post** — Long-form technical blog post with frontmatter and web-sourced links
- 🔗 **Web Search Integration** — Finds relevant links for social posts and blog content via Exa
- 🔄 **Git Automation** — Auto-commits and pushes all generated content after each video
- 🎨 **Brand Voice** — Customize AI tone, vocabulary, hashtags, and content style via `brand.json`
- 👁️ **Watch Mode** — Monitors a folder and processes new `.mp4` files on arrival
- 🧠 **Agent Architecture** — Powered by GitHub Copilot SDK with tool-calling agents

---

## 🚀 Quick Start

```bash
# Install globally
npm install -g vidpipe

# Set up your environment
# Unix/Mac
cp .env.example .env
# Windows (PowerShell)
Copy-Item .env.example .env

# Then edit .env and add your OpenAI API key (REQUIRED):
#   OPENAI_API_KEY=sk-your-key-here

# Verify all prerequisites are met
vidpipe --doctor

# Process a single video
vidpipe /path/to/video.mp4

# Watch a folder for new recordings
vidpipe --watch-dir ~/Videos/Recordings

# Full example with options
vidpipe \
  --watch-dir ~/Videos/Recordings \
  --output-dir ~/Content/processed \
  --openai-key sk-... \
  --brand ./brand.json \
  --verbose
```

> **Prerequisites:**
> - **Node.js 20+**
> - **FFmpeg 6.0+** — Automatically included via `npm install` (bundled by [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static)). Override with `FFMPEG_PATH` env var if you need a specific build.
> - **OpenAI API key** (**required**) — Get one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). Needed for Whisper transcription and all AI features.
> - **GitHub Copilot subscription** — Required for AI agent features (shorts generation, social media posts, summaries, blog posts). See [GitHub Copilot](https://github.com/features/copilot).
>
> See [Getting Started](./docs/getting-started.md) for full setup instructions.

---

## 🎮 CLI Usage

```
vidpipe [options] [video-path]
```

| Option | Description |
|--------|-------------|
| `--doctor` | Check that all prerequisites (FFmpeg, API keys, etc.) are installed and configured |
| `[video-path]` | Process a specific video file (implies `--once`) |
| `--watch-dir <path>` | Folder to watch for new recordings |
| `--output-dir <path>` | Output directory (default: `./recordings`) |
| `--openai-key <key>` | OpenAI API key |
| `--exa-key <key>` | Exa AI key for web search in social posts |
| `--brand <path>` | Path to `brand.json` (default: `./brand.json`) |
| `--once` | Process next video and exit |
| `--no-silence-removal` | Skip silence removal |
| `--no-shorts` | Skip short clip extraction |
| `--no-medium-clips` | Skip medium clip generation |
| `--no-social` | Skip social media posts |
| `--no-captions` | Skip caption generation/burning |
| `--no-git` | Skip git commit/push |
| `-v, --verbose` | Debug-level logging |

---

## 📁 Output Structure

```
recordings/
└── my-awesome-demo/
    ├── my-awesome-demo.mp4                  # Original video
    ├── my-awesome-demo-edited.mp4           # Silence-removed
    ├── my-awesome-demo-captioned.mp4        # With burned-in captions
    ├── transcript.json                      # Word-level transcript
    ├── transcript-edited.json               # Timestamps adjusted for silence removal
    ├── README.md                            # AI-generated summary with screenshots
    ├── captions/
    │   ├── captions.srt                     # SubRip subtitles
    │   ├── captions.vtt                     # WebVTT subtitles
    │   └── captions.ass                     # Advanced SSA (karaoke-style)
    ├── shorts/
    │   ├── catchy-title.mp4                 # Landscape base clip
    │   ├── catchy-title-captioned.mp4       # Landscape + burned captions
    │   ├── catchy-title-portrait.mp4        # 9:16 split-screen
    │   ├── catchy-title-portrait-captioned.mp4  # Portrait + captions + hook overlay
    │   ├── catchy-title-feed.mp4            # 4:5 split-screen
    │   ├── catchy-title-square.mp4          # 1:1 split-screen
    │   ├── catchy-title.md                  # Clip metadata
    │   └── catchy-title/
    │       └── posts/                       # Per-short social posts (5 platforms)
    ├── medium-clips/
    │   ├── deep-dive-topic.mp4              # Landscape base clip
    │   ├── deep-dive-topic-captioned.mp4    # With burned captions
    │   ├── deep-dive-topic.md               # Clip metadata
    │   └── deep-dive-topic/
    │       └── posts/                       # Per-clip social posts (5 platforms)
    ├── chapters/
    │   ├── chapters.json                    # Structured chapter data
    │   ├── chapters.md                      # Markdown table
    │   ├── chapters.ffmetadata              # FFmpeg metadata format
    │   └── chapters-youtube.txt             # YouTube description timestamps
    └── social-posts/
        ├── tiktok.md                        # Full-video social posts
        ├── youtube.md
        ├── instagram.md
        ├── linkedin.md
        ├── x.md
        └── devto.md                         # Dev.to blog post
```

---

## 🔄 Pipeline

```
Ingest → Transcribe → Silence Removal → Captions → Caption Burn → Shorts → Medium Clips → Chapters → Summary → Social Media → Short Posts → Medium Clip Posts → Blog → Git Push
```

| # | Stage | Description |
|---|-------|-------------|
| 1 | **Ingestion** | Copies video, extracts metadata with FFprobe |
| 2 | **Transcription** | Extracts audio → OpenAI Whisper for word-level transcription |
| 3 | **Silence Removal** | AI detects dead-air segments; context-aware removals capped at 20% |
| 4 | **Captions** | Generates `.srt`, `.vtt`, and `.ass` subtitle files with karaoke word highlighting |
| 5 | **Caption Burn** | Burns ASS captions into video (single-pass encode when silence was also removed) |
| 6 | **Shorts** | AI identifies best 15–60s moments; extracts single and composite clips with 6 variants per short |
| 7 | **Medium Clips** | AI identifies 1–3 min standalone segments with crossfade transitions |
| 8 | **Chapters** | AI detects topic boundaries; outputs JSON, Markdown, FFmetadata, and YouTube timestamps |
| 9 | **Summary** | AI writes a Markdown README with captured screenshots |
| 10 | **Social Media** | Platform-tailored posts for TikTok, YouTube, Instagram, LinkedIn, and X |
| 11 | **Short Posts** | Per-short social media posts for all 5 platforms |
| 12 | **Medium Clip Posts** | Per-medium-clip social media posts for all 5 platforms |
| 13 | **Blog** | Dev.to blog post with frontmatter, web-sourced links via Exa |
| 14 | **Git Push** | Auto-commits and pushes to `origin main` |

Each stage can be independently skipped with `--no-*` flags. A stage failure does not abort the pipeline — subsequent stages proceed with whatever data is available.

---

## 🤖 LLM Providers

VidPipe supports multiple LLM providers:

| Provider | Env Var | Default Model | Notes |
|----------|---------|---------------|-------|
| `copilot` (default) | — | Claude Sonnet 4 | Uses GitHub Copilot auth |
| `openai` | `OPENAI_API_KEY` | gpt-4o | Direct OpenAI API |
| `claude` | `ANTHROPIC_API_KEY` | claude-sonnet-4-20250514 | Direct Anthropic API |

Set `LLM_PROVIDER` in your `.env` or pass via CLI. Override model with `LLM_MODEL`.

The pipeline tracks token usage and estimated cost across all providers, displaying a summary at the end of each run.

---

## ⚙️ Configuration

Configuration is loaded from CLI flags → environment variables → `.env` file → defaults.

```env
# .env
OPENAI_API_KEY=sk-your-key-here
WATCH_FOLDER=/path/to/recordings
OUTPUT_DIR=/path/to/output
# EXA_API_KEY=your-exa-key       # Optional: enables web search in social/blog posts
# BRAND_PATH=./brand.json         # Optional: path to brand voice config
# FFMPEG_PATH=/usr/local/bin/ffmpeg
# FFPROBE_PATH=/usr/local/bin/ffprobe
```

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](./docs/getting-started.md) | Prerequisites, installation, and first run |
| [Configuration](./docs/configuration.md) | All CLI flags, env vars, skip options, and examples |
| [FFmpeg Setup](./docs/ffmpeg-setup.md) | Platform-specific install (Windows, macOS, Linux, ARM64) |
| [Brand Customization](./docs/brand-customization.md) | Customize AI voice, vocabulary, hashtags, and content style |

---

## 🏗️ Architecture

Agent-based architecture built on the [GitHub Copilot SDK](https://github.com/github/copilot-sdk):

```
BaseAgent (abstract)
├── SilenceRemovalAgent → detect_silence, decide_removals
├── SummaryAgent        → capture_frame, write_summary
├── ShortsAgent         → plan_shorts
├── MediumVideoAgent    → plan_medium_clips
├── ChapterAgent        → generate_chapters
├── SocialMediaAgent    → search_links, create_posts
└── BlogAgent           → search_web, write_blog
```

Each agent communicates with the LLM through structured tool calls, ensuring reliable, parseable outputs.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Language (ES2022, ESM) |
| [GitHub Copilot SDK](https://github.com/github/copilot-sdk) | AI agent framework |
| [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) | Speech-to-text |
| [FFmpeg](https://ffmpeg.org/) | Video/audio processing |
| [Sharp](https://sharp.pixelplumbing.com/) | Image analysis (webcam detection) |
| [Commander.js](https://github.com/tj/commander.js) | CLI framework |
| [Chokidar](https://github.com/paulmillr/chokidar) | File system watching |
| [Winston](https://github.com/winstonjs/winston) | Logging |
| [Exa AI](https://exa.ai/) | Web search for social posts and blog |

---

## 🗺️ Roadmap

- [ ] **Automated social posting** — Publish directly to platforms via their APIs
- [ ] **Multi-language support** — Transcription and summaries in multiple languages
- [ ] **Custom templates** — User-defined Markdown & social post templates
- [ ] **Web dashboard** — Browser UI for reviewing and editing outputs
- [ ] **Batch processing** — Process an entire folder of existing videos
- [ ] **Custom short criteria** — Configure what makes a "good" short for your content
- [ ] **Thumbnail generation** — Auto-generate branded thumbnails for shorts

---

## 📄 License

ISC © [htekdev](https://github.com/htekdev)

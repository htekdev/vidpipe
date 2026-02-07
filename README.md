[![CI](https://github.com/htekdev/video-auto-note-taker/actions/workflows/ci.yml/badge.svg)](https://github.com/htekdev/video-auto-note-taker/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/video-auto-note-taker)](https://www.npmjs.com/package/video-auto-note-taker)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-brightgreen)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/license-ISC-blue)](./LICENSE)

# 🎬 Video Auto Note Taker

**Drop a video. Get transcripts, summaries, short clips, captions, blog posts, and social media posts — automatically.**

An AI-powered CLI pipeline that watches for new video recordings and transforms them into rich, structured content using [GitHub Copilot SDK](https://github.com/github/copilot-sdk) agents and OpenAI Whisper.

```bash
npm install -g video-auto-note-taker
```

---

## ✨ Features

- 🎙️ **Automatic Transcription** — Word-level timestamps via OpenAI Whisper API
- 🔇 **Silence Removal** — AI-powered dead-air detection and removal
- 💬 **Auto Captions** — Generates and burns `.ass` subtitles into video
- 📝 **Smart Summaries** — Markdown READMEs with embedded screenshots
- ✂️ **Short Clip Extraction** — AI identifies the best 15–60s moments and cuts them
- 📱 **Social Media Posts** — Platform-tailored content for TikTok, YouTube, Instagram, LinkedIn, X
- 📰 **Blog Post Generation** — Long-form blog posts from transcripts
- 👁️ **Watch Mode** — Monitors a folder and processes new `.mp4` files on arrival
- 🔄 **Git Integration** — Auto-commits and pushes results after each video
- 🎨 **Brand Customization** — Configure AI voice, vocabulary, and content style via `brand.json`
- 🧠 **Agent Architecture** — Powered by GitHub Copilot SDK with tool-calling agents

---

## 🚀 Quick Start

```bash
# Install globally
npm install -g video-auto-note-taker

# Process a single video
video-auto-note-taker /path/to/video.mp4

# Watch a folder for new recordings
video-auto-note-taker --watch-dir ~/Videos/Recordings

# Full example with options
video-auto-note-taker \
  --watch-dir ~/Videos/Recordings \
  --output-dir ~/Content/processed \
  --openai-key sk-... \
  --brand ./brand.json \
  --verbose
```

> **Prerequisites:** Node.js 20+, FFmpeg 6.0+, and an OpenAI API key.
> See [Getting Started](./docs/getting-started.md) for full setup instructions.

---

## 🎮 CLI Usage

```
video-auto-note-taker [options] [video-path]
```

| Option | Description |
|--------|-------------|
| `[video-path]` | Process a specific video file (implies `--once`) |
| `--watch-dir <path>` | Folder to watch for new recordings |
| `--output-dir <path>` | Output directory (default: `./recordings`) |
| `--openai-key <key>` | OpenAI API key |
| `--exa-key <key>` | Exa AI key for web search in social posts |
| `--brand <path>` | Path to `brand.json` (default: `./brand.json`) |
| `--once` | Process next video and exit |
| `--no-silence-removal` | Skip silence removal |
| `--no-shorts` | Skip short clip extraction |
| `--no-social` | Skip social media posts |
| `--no-captions` | Skip caption generation |
| `--no-git` | Skip git commit/push |
| `-v, --verbose` | Debug-level logging |

---

## 📁 Output Structure

```
recordings/
└── my-awesome-demo/
    ├── my-awesome-demo.mp4              # Original video
    ├── my-awesome-demo-edited.mp4       # Silence-removed
    ├── my-awesome-demo-captioned.mp4    # With burned-in captions
    ├── README.md                        # AI-generated summary
    ├── transcript.json                  # Word-level transcript
    ├── blog-post.md                     # Long-form blog post
    ├── thumbnails/
    │   └── snapshot-*.png               # Key-moment screenshots
    ├── shorts/
    │   ├── catchy-title.mp4             # Short clips
    │   └── catchy-title.md              # Clip metadata
    └── social-posts/
        ├── tiktok.md
        ├── youtube.md
        ├── instagram.md
        ├── linkedin.md
        └── x.md
```

---

## 🔄 Pipeline

```
Ingest → Transcribe → Silence Removal → Captions → Shorts → Summary → Social → Blog → Git Push
```

| Stage | Description |
|-------|-------------|
| **Ingestion** | Copies video, extracts metadata with FFprobe |
| **Transcription** | Audio → OpenAI Whisper for word-level transcription |
| **Silence Removal** | AI detects and removes dead-air segments |
| **Captions** | Generates `.ass` subtitles, burns into video |
| **Shorts** | AI identifies best moments, FFmpeg cuts clips |
| **Summary** | AI writes Markdown README with screenshots |
| **Social Media** | Platform-tailored posts for 5 platforms |
| **Blog** | AI generates a long-form blog post |
| **Git Push** | Auto-commits and pushes to `origin main` |

Each stage can be independently skipped with `--no-*` flags.

---

## ⚙️ Configuration

Configuration is loaded from CLI flags → environment variables → `.env` file → defaults.

```env
# .env
OPENAI_API_KEY=sk-your-key-here
WATCH_FOLDER=/path/to/recordings
OUTPUT_DIR=/path/to/output
# EXA_API_KEY=your-exa-key       # optional
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
├── SummaryAgent       → capture_frame, write_summary
├── ShortsAgent        → plan_shorts
├── SocialMediaAgent   → search_links, create_posts
├── SilenceRemovalAgent → detect_silence, plan_cuts
└── BlogAgent          → write_blog_post
```

Each agent communicates with the LLM through structured tool calls, ensuring reliable, parseable outputs.

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [TypeScript](https://www.typescriptlang.org/) | Language |
| [GitHub Copilot SDK](https://github.com/github/copilot-sdk) | AI agent framework |
| [OpenAI Whisper](https://platform.openai.com/docs/guides/speech-to-text) | Speech-to-text |
| [FFmpeg](https://ffmpeg.org/) | Video/audio processing |
| [Commander.js](https://github.com/tj/commander.js) | CLI framework |
| [Chokidar](https://github.com/paulmillr/chokidar) | File system watching |
| [Winston](https://github.com/winstonjs/winston) | Logging |
| [Exa AI](https://exa.ai/) | Web search for social posts |

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

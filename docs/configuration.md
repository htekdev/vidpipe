# Configuration Guide

All the ways to configure **video-auto-note-taker** — CLI flags, environment variables, the `.env` file, and `brand.json`.

---

## Priority Order

Configuration values are resolved in this order (first match wins):

1. **CLI flags** — `--openai-key sk-...`
2. **Environment variables** — `OPENAI_API_KEY=sk-...`
3. **`.env` file** — loaded automatically from the current working directory
4. **Defaults** — built-in fallback values

---

## CLI Parameters

### Positional Argument

| Argument | Description |
|----------|-------------|
| `[video-path]` | Path to a video file to process. Implies `--once` mode. |

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `--watch-dir <path>` | Folder to watch for new `.mp4` recordings | `$WATCH_FOLDER` or `./watch` |
| `--output-dir <path>` | Base directory for processed output | `$OUTPUT_DIR` or `./recordings` |
| `--openai-key <key>` | OpenAI API key (Whisper + agents) | `$OPENAI_API_KEY` |
| `--exa-key <key>` | Exa AI API key for web search in social posts | `$EXA_API_KEY` |
| `--once` | Process a single video (or next arrival) and exit | Off |
| `--brand <path>` | Path to `brand.json` config file | `$BRAND_PATH` or `./brand.json` |
| `-v, --verbose` | Enable debug-level logging | Off |
| `-V, --version` | Print version and exit | — |

### Skip Flags

Disable individual pipeline stages:

| Flag | Skips |
|------|-------|
| `--no-git` | Git commit/push after processing |
| `--no-silence-removal` | Dead-silence detection and removal |
| `--no-shorts` | Short clip extraction |
| `--no-social` | Social media post generation |
| `--no-medium-clips` | Medium clip (1–3 min) extraction |
| `--no-captions` | Caption generation and burning |

**Examples:**

```bash
# Process without generating shorts or social posts
video-auto-note-taker --no-shorts --no-social /path/to/video.mp4

# Skip git (useful during testing)
video-auto-note-taker --no-git --watch-dir ./watch

# Transcription + summary only (skip everything optional)
video-auto-note-taker \
  --no-silence-removal \
  --no-shorts \
  --no-social \
  --no-captions \
  --no-git \
  /path/to/video.mp4
```

---

## Environment Variables

Set these in your shell or in a `.env` file in the working directory.

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OPENAI_API_KEY` | ✅ | OpenAI API key for Whisper and Copilot SDK agents | — |
| `WATCH_FOLDER` | ❌ | Directory to monitor for new video files | `./watch` |
| `OUTPUT_DIR` | ❌ | Base output directory for processed videos | `./recordings` |
| `REPO_ROOT` | ❌ | Repository root for git operations | Current working directory |
| `FFMPEG_PATH` | ❌ | Absolute path to `ffmpeg` binary | `ffmpeg` (from PATH) |
| `FFPROBE_PATH` | ❌ | Absolute path to `ffprobe` binary | `ffprobe` (from PATH) |
| `EXA_API_KEY` | ❌ | Exa AI API key for web search in social posts | — |
| `BRAND_PATH` | ❌ | Path to `brand.json` | `./brand.json` |

### Example `.env` file

```env
OPENAI_API_KEY=sk-your-api-key-here
WATCH_FOLDER=/home/you/Videos/Recordings
OUTPUT_DIR=/home/you/Content/processed
REPO_ROOT=/home/you/repos/video-auto-note-taker

# Optional: explicit FFmpeg paths
# FFMPEG_PATH=/usr/local/bin/ffmpeg
# FFPROBE_PATH=/usr/local/bin/ffprobe

# Optional: Exa AI for web search links in social posts
# EXA_API_KEY=your-exa-api-key-here
```

> A `.env.example` file is included in the repository — copy it to get started:
> ```bash
> cp .env.example .env
> ```

---

## brand.json

The `brand.json` file controls how AI agents write summaries, social posts, and blog content. It defines your voice, vocabulary, hashtags, and content guidelines.

By default, the tool looks for `brand.json` in the current working directory. Override with `--brand <path>` or the `BRAND_PATH` env var.

See the [Brand Customization Guide](./brand-customization.md) for the full format and examples.

---

## Output Directory Structure

The `--output-dir` (default `./recordings`) is the base directory. Each video creates a subdirectory named after a slugified version of the original filename:

```
<output-dir>/
└── <video-slug>/
    ├── <video-slug>.mp4              # Original video copy
    ├── <video-slug>-edited.mp4       # After silence removal
    ├── <video-slug>-captioned.mp4    # With burned-in captions
    ├── README.md                     # AI summary with screenshots
    ├── transcript.json               # Word-level transcript
    ├── transcript-edited.json        # Adjusted transcript (post-silence-removal)
    ├── blog-post.md                  # Long-form blog post
    ├── thumbnails/
    │   └── snapshot-*.png            # Key-moment screenshots
    ├── shorts/
    │   ├── <short-slug>.mp4          # Extracted short clips
    │   ├── <short-slug>-captioned.mp4
    │   ├── <short-slug>-portrait.mp4 # 9:16 platform variant
    │   ├── <short-slug>.ass          # Caption file
    │   └── <short-slug>.md           # Clip description & metadata
    ├── medium-clips/
    │   ├── <clip-slug>.mp4           # 1–3 minute topic clips
    │   ├── <clip-slug>-captioned.mp4
    │   ├── <clip-slug>.ass
    │   └── <clip-slug>.md
    ├── chapters/
    │   ├── chapters.json             # Canonical chapter data
    │   ├── chapters-youtube.txt      # YouTube description timestamps
    │   ├── chapters.md               # Markdown table
    │   └── chapters.ffmetadata       # FFmpeg metadata format
    └── social-posts/
        ├── tiktok.md
        ├── youtube.md
        ├── instagram.md
        ├── linkedin.md
        └── x.md
```

---

## Common Configurations

### Content creator (full pipeline)

```bash
video-auto-note-taker \
  --watch-dir ~/Videos/Recordings \
  --output-dir ~/Content/processed \
  --brand ./brand.json \
  --verbose
```

### Quick transcription only

```bash
video-auto-note-taker \
  --no-silence-removal \
  --no-shorts \
  --no-social \
  --no-captions \
  --no-git \
  /path/to/meeting.mp4
```

### CI/CD or automation (no interactive, no git)

```bash
OPENAI_API_KEY=sk-... video-auto-note-taker \
  --once \
  --no-git \
  --output-dir /tmp/output \
  /path/to/video.mp4
```

---

## Troubleshooting

### "Missing required: OPENAI_API_KEY"

The tool requires an OpenAI API key. Provide it via:
- `--openai-key sk-...` flag
- `OPENAI_API_KEY` environment variable
- `.env` file in the working directory

### "ffmpeg: command not found"

FFmpeg is not on your system PATH. Either:
- Install FFmpeg (see [FFmpeg Setup](./ffmpeg-setup.md))
- Set `FFMPEG_PATH` and `FFPROBE_PATH` to the absolute paths of the binaries

### Verbose mode shows too much output

Verbose mode (`-v`) sets the log level to `debug`. If you only need it temporarily, pass the flag on the command line rather than setting it in `.env`.

### Watch mode doesn't detect files

Ensure the `--watch-dir` path exists and is writable. The watcher monitors for new `.mp4` files only. Files that already exist when the watcher starts are not processed — only newly created files trigger the pipeline.

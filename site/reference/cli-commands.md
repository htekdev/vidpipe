---
title: CLI Commands
---

# CLI Commands

VidPipe is built with [Commander.js](https://github.com/tj/commander.js) and provides several subcommands alongside the default video processing mode.

## `vidpipe [video-path]`

The default command. Processes a video file or watches a folder for new recordings.

```bash
# Process a single video (implies --once)
vidpipe /path/to/video.mp4

# Watch a folder for new recordings
vidpipe --watch-dir ~/Videos/Recordings

# Full example
vidpipe \
  --watch-dir ~/Videos/Recordings \
  --output-dir ~/Content/processed \
  --openai-key sk-... \
  --brand ./brand.json \
  --verbose
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `[video-path]` | Path to a video file to process (implies `--once`) | — |
| `--watch-dir <path>` | Folder to watch for new recordings | `WATCH_FOLDER` env var |
| `--output-dir <path>` | Output directory for processed videos | `./recordings` |
| `--openai-key <key>` | OpenAI API key | `OPENAI_API_KEY` env var |
| `--exa-key <key>` | Exa AI API key for web search | `EXA_API_KEY` env var |
| `--once` | Process a single video and exit (no watching) | `false` |
| `--brand <path>` | Path to `brand.json` config | `./brand.json` |
| `--no-git` | Skip git commit/push stage | — |
| `--no-silence-removal` | Skip silence removal stage | — |
| `--no-shorts` | Skip shorts generation | — |
| `--no-medium-clips` | Skip medium clip generation | — |
| `--no-social` | Skip social media post generation | — |
| `--no-captions` | Skip caption generation/burning | — |
| `--no-social-publish` | Skip social media queue-build stage | — |
| `--late-api-key <key>` | Late API key for social publishing | `LATE_API_KEY` env var |
| `--late-profile-id <id>` | Late profile ID | `LATE_PROFILE_ID` env var |
| `-v, --verbose` | Enable debug-level logging | `false` |
| `--doctor` | Check all prerequisites and exit | — |
| `-V, --version` | Show version number | — |

## `vidpipe init`

Interactive setup wizard for first-time configuration. Walks you through setting up API keys, LLM providers, and social publishing credentials.

```bash
vidpipe init
```

## `vidpipe review`

Opens the built-in web app for reviewing, editing, and scheduling social media posts before publishing.

```bash
vidpipe review
vidpipe review --port 8080
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--port <number>` | Server port | `3847` |

The review app opens automatically in your default browser. Press `Ctrl+C` to stop the server.

## `vidpipe schedule`

Displays the current posting schedule across platforms.

```bash
vidpipe schedule
vidpipe schedule --platform tiktok
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--platform <name>` | Filter by platform (`tiktok`, `youtube`, `instagram`, `linkedin`, `twitter`) | all platforms |

## `vidpipe doctor`

Checks that all prerequisites and dependencies are correctly installed and configured. Verifies:

- Node.js version (20+)
- FFmpeg availability and version
- API key configuration
- Optional dependency status

```bash
vidpipe doctor
```

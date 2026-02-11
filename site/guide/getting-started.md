---
title: Getting Started
---

# Getting Started

From raw recording to social-ready content in under 2 minutes.

---

## 1. Install

```bash
npm install -g vidpipe
```

## 2. Set Up

```bash
vidpipe init
```

The setup wizard walks you through everything — API keys, FFmpeg verification, social accounts. Just follow the prompts.

## 3. Process Your First Video

```bash
vidpipe /path/to/video.mp4
```

That's it. Go grab a coffee — your AI editor will cut the dead air, generate highlight clips, burn captions, write social posts, and draft a blog while you wait.

---

## What Happens Next

After your AI editor finishes (~5–15 minutes for a 10–30 min video), you'll find:

| Output | Files |
|--------|-------|
| 📝 Transcripts | `transcript.json` — word-level timestamps |
| ✂️ Edited Video | `*-edited.mp4` — silence removed, `*-captioned.mp4` — with burned captions |
| 🎬 Shorts | 15–60s highlight clips in landscape, portrait (9:16), square, and feed (4:5) |
| 🎞️ Medium Clips | 1–3 min standalone segments with crossfade transitions |
| 📑 Chapters | YouTube timestamps, Markdown, JSON, and FFmpeg metadata |
| 📱 Social Posts | Drafts for TikTok, YouTube, Instagram, LinkedIn, and X |
| 📰 Blog Post | Dev.to-style article with web-sourced links |
| 📄 Summary | README.md with key-frame screenshots |

::: tip Want to see the full output tree?
```
recordings/my-video/
├── my-video.mp4
├── my-video-edited.mp4
├── my-video-captioned.mp4
├── README.md
├── transcript.json
├── blog-post.md
├── shorts/
│   ├── highlight-clip.mp4
│   ├── highlight-clip-portrait.mp4
│   └── highlight-clip/posts/
├── medium-clips/
│   └── topic-deep-dive.mp4
├── chapters/
│   ├── chapters.json
│   └── chapters-youtube.txt
└── social-posts/
    ├── tiktok.md
    ├── youtube.md
    ├── instagram.md
    ├── linkedin.md
    └── x.md
```
:::

---

## Watch Mode

Want continuous processing? Point vidpipe at a folder:

```bash
vidpipe --watch-dir ~/Videos/Recordings
```

Every new `.mp4` dropped in that folder is automatically processed.

---

## Verify Your Setup

Something not working? Run the doctor:

```bash
vidpipe --doctor
```

This checks Node.js, FFmpeg, API keys, and folder permissions in one shot.

---

## Prerequisites

::: details What do I need installed?

| Requirement | Version | How to Get It |
|-------------|---------|---------------|
| **Node.js** | 20+ | [nodejs.org](https://nodejs.org/) |
| **FFmpeg** | 6.0+ | Auto-bundled on Windows x64, macOS, Linux x64. Others: see [FFmpeg Setup](/guide/ffmpeg-setup) |
| **OpenAI API key** | — | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — needed for transcription |
| **GitHub Copilot** | Active subscription | Default AI provider. Alternatives: [OpenAI or Claude](/guide/configuration#llm-provider) |

**Optional:**

| Tool | Purpose |
|------|---------|
| **Git** | Auto-commit output (on by default, skip with `--no-git`) |
| **Exa AI key** | Web-search links in social posts and blog |

:::

---

## Common First-Run Issues

| Symptom | Fix |
|---------|-----|
| `Missing required: OPENAI_API_KEY` | Run `vidpipe init` or set `OPENAI_API_KEY` in `.env` |
| FFmpeg errors | Run `vidpipe --doctor` — usually a missing or outdated install |
| No videos detected | Check your `--watch-dir` path exists and contains `.mp4` files |
| Slow first run | Normal — Whisper API dominates. Cached transcripts speed up re-runs |

---

## Skip What You Don't Need

```bash
# Transcription only (fastest)
vidpipe --no-silence-removal --no-shorts --no-social --no-captions --no-git /path/to/video.mp4

# Everything except social media
vidpipe --no-social /path/to/video.mp4

# No git commits (useful during testing)
vidpipe --no-git /path/to/video.mp4
```

---

## Next Steps

- [Brand Customization](/guide/brand-customization) — tailor AI output to your voice
- [Social Publishing](/guide/social-publishing) — review, schedule, and publish posts
- [Configuration](/guide/configuration) — all CLI flags, env vars, and advanced options
- [FFmpeg Setup](/guide/ffmpeg-setup) — platform-specific installation instructions

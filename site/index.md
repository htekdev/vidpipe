---
layout: home

hero:
  name: vidpipe
  text: Your Agentic Video Editor
  tagline: Record once. Get shorts, reels, captions, social posts, and a blog — AI agents handle the editing.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/htekdev/vidpipe
  image:
    src: /features-infographic.png
    alt: VidPipe Pipeline Overview

features:
  - icon: 🎙️
    title: AI Transcription
    details: OpenAI Whisper with word-level timestamps and auto-chunking for large files.
  - icon: ✂️
    title: Smart Editing
    details: AI-driven silence removal with context-aware cuts, capped at 20%.
  - icon: 🎬
    title: Auto Clips
    details: Short (15-60s) and medium (1-3min) clips in portrait, square, and feed formats.
  - icon: 💬
    title: Karaoke Captions
    details: Word-by-word highlighting, SRT/VTT/ASS, burned into video.
  - icon: 📱
    title: Social Publishing
    details: Scheduled posting to TikTok, YouTube, Instagram, LinkedIn, X via Late API.
  - icon: 📰
    title: Blog & Summary
    details: Brand-voice README and dev.to-style blog with web-sourced links.
---

## Get Running in 60 Seconds

```bash
npm install -g vidpipe
vidpipe /path/to/video.mp4
```

That's it. Your AI agents will edit the video, cut highlight clips, burn captions, write social posts, and draft a blog — while you do literally anything else.

Want the full experience? Run the setup wizard:

```bash
vidpipe init
```

## What You Get

After your AI editor finishes, you'll have:

| Output | Description |
|--------|-------------|
| 📝 Transcripts | Word-level JSON with timestamps |
| ✂️ Edited Video | Silence-removed + captioned versions |
| 🎬 Short Clips | 15–60s highlights in portrait, square, and feed formats |
| 🎞️ Medium Clips | 1–3 min standalone segments with transitions |
| 📑 Chapters | YouTube timestamps, Markdown, JSON, FFmpeg metadata |
| 📱 Social Posts | Platform-tailored drafts for TikTok, YouTube, Instagram, LinkedIn, X |
| 📰 Blog Post | Dev.to-style article with web-sourced links |
| 📄 Summary | Markdown README with key-frame screenshots |

## Pipeline Overview

The 15-stage pipeline transforms a single video into a complete content package.

```mermaid
graph LR
    A[Video Input] --> B[Transcribe]
    B --> C[Silence Removal]
    C --> D[Captions]
    D --> E[Caption Burn]
    E --> F[Shorts]
    F --> G[Medium Clips]
    G --> H[Chapters]
    H --> I[Summary]
    I --> J[Social Posts]
    J --> K[Short Posts]
    K --> L[Medium Posts]
    L --> M[Queue Build]
    M --> N[Blog]
    N --> O[Git Push]

    style A fill:#238636,color:#fff
    style O fill:#a78bfa,color:#fff
```

## Review App

Review and approve social media posts before publishing.

![Review App](/review-ui.png)

---
layout: home

hero:
  name: vidpipe
  text: Automated Video Processing Pipeline
  tagline: Drop a video. Get transcripts, clips, captions, social posts, and blog — all automatically.
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

## Pipeline Overview

The 15-stage pipeline transforms a single video into a complete content package.

```mermaid
flowchart LR
    A[📁 Video Input] --> B[🎙️ Transcribe]
    B --> C[✂️ Silence Removal]
    C --> D[💬 Captions]
    D --> E[🔥 Caption Burn]
    E --> F[🎬 Shorts]
    F --> G[📹 Medium Clips]
    G --> H[📑 Chapters]
    H --> I[📝 Summary]
    I --> J[📱 Social Posts]
    J --> K[📱 Short Posts]
    K --> L[📱 Medium Posts]
    L --> M[📦 Queue Build]
    M --> N[📰 Blog]
    N --> O[🚀 Auto-Publish]

    style A fill:#238636,color:#fff
    style O fill:#a78bfa,color:#fff
```

## Review App

Review and approve social media posts before publishing.

![Review App](/review-ui.png)

## Quick Start

```bash
npm install -g vidpipe
vidpipe init
# Drop a .mp4 file into the watch folder
```

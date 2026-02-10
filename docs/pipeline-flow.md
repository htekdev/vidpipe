# Content Pipeline Flow

Visual documentation of the 14-stage video processing pipeline in vidpipe.

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    VIDEO INPUT (.mp4)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Ingestion                                          │
│ ────────────────────────────────────────────────────────── │
│ • Copy video to recordings/{slug}/                          │
│ • Extract metadata (duration, size, created date)           │
│ • Generate slug from filename                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Transcription                                      │
│ ────────────────────────────────────────────────────────── │
│ • Extract audio as MP3 (64kbps mono)                        │
│ • Send to OpenAI Whisper API                                │
│ • Get word-level timestamps                                 │
│ • Save transcript.json                                      │
│ Service: Whisper ($0.006/min)                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 3: Silence Removal (AI Agent)                        │
│ ────────────────────────────────────────────────────────── │
│ Agent: SilenceRemovalAgent                                  │
│ • Detect silence regions via FFmpeg                         │
│ • AI decides which silences to remove (conservative)        │
│ • Generate edited video with frame-accurate cuts            │
│ • Adjust transcript timestamps                              │
│ • Save transcript-edited.json                               │
│ Tool: decide_removals                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 4: Captions                                           │
│ ────────────────────────────────────────────────────────── │
│ • Generate SRT, VTT, ASS from adjusted transcript           │
│ • Word-by-word karaoke highlighting                         │
│ • Three caption styles: shorts, medium, portrait            │
│ • Save to captions/ directory                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 5: Caption Burn                                       │
│ ────────────────────────────────────────────────────────── │
│ • Burn ASS captions into video                              │
│ • Single-pass: silence removal + captions in one encode     │
│ • Montserrat Bold font (bundled)                            │
│ • Save as {slug}-captioned.mp4                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 6: Shorts Generation (AI Agent)                      │
│ ────────────────────────────────────────────────────────── │
│ Agent: ShortsAgent                                          │
│ • AI plans 3-8 short clips (15-60s each)                    │
│ • Single or composite segments                              │
│ • Extract clips from ORIGINAL video                         │
│ • Generate platform variants (9:16, 1:1, 4:5)               │
│ • Smart layout: split-screen for portrait                   │
│ • Burn portrait captions with hook overlay                  │
│ • Save to shorts/{slug}/ with metadata                      │
│ Tool: plan_shorts                                           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 7: Medium Clips Generation (AI Agent)                │
│ ────────────────────────────────────────────────────────── │
│ Agent: MediumVideoAgent                                     │
│ • AI plans 2-4 medium clips (60-180s each)                  │
│ • Complete topic coverage or narrative arcs                 │
│ • Extract clips with xfade transitions                      │
│ • Burn medium-style captions                                │
│ • Save to medium-clips/{slug}/ with metadata                │
│ Tool: plan_medium_clips                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 8: Chapters Generation (AI Agent)                    │
│ ────────────────────────────────────────────────────────── │
│ Agent: ChapterAgent                                         │
│ • AI identifies 3-10 chapter boundaries                     │
│ • Detect topic transitions                                  │
│ • Generate 4 formats:                                       │
│   - chapters.json (structured data)                         │
│   - chapters-youtube.txt (timestamp format)                 │
│   - chapters.md (Markdown table)                            │
│   - chapters.ffmetadata (FFmpeg metadata)                   │
│ Tool: generate_chapters                                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 9: Summary Generation (AI Agent)                     │
│ ────────────────────────────────────────────────────────── │
│ Agent: SummaryAgent                                         │
│ • AI captures 3-8 key frame screenshots                     │
│ • Generates narrative README.md                             │
│ • Brand voice and personality                               │
│ • References shorts and chapters                            │
│ • Includes quick reference table                            │
│ Tools: capture_frame, write_summary                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 10: Social Media Posts (AI Agent)                    │
│ ────────────────────────────────────────────────────────── │
│ Agent: SocialMediaAgent                                     │
│ • AI generates posts for 5 platforms:                       │
│   - TikTok (casual, hook-driven, emoji-heavy)               │
│   - YouTube (SEO-optimized, descriptive)                    │
│   - Instagram (visual, emoji-rich, 30 hashtags)             │
│   - LinkedIn (professional, thought-leadership)             │
│   - X/Twitter (concise, 280 chars, thread-ready)            │
│ • Web search for relevant links (via Exa MCP)               │
│ • Save to social-posts/ as YAML frontmatter + markdown      │
│ Tool: create_posts                                          │
│ MCP: Exa Web Search ($0.001/search)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 11: Short Posts Generation (AI Agent)                │
│ ────────────────────────────────────────────────────────── │
│ Agent: SocialMediaAgent (reused)                            │
│ • For each short clip: generate platform-specific posts     │
│ • Context: clip title, description, tags, duration          │
│ • Save to shorts/{slug}/posts/                              │
│ Tool: create_posts                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 12: Medium Clip Posts Generation (AI Agent)          │
│ ────────────────────────────────────────────────────────── │
│ Agent: SocialMediaAgent (reused)                            │
│ • For each medium clip: generate platform-specific posts    │
│ • Context: clip title, hook, topic, duration                │
│ • Save to medium-clips/{slug}/posts/                        │
│ Tool: create_posts                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 13: Blog Post Generation (AI Agent)                  │
│ ────────────────────────────────────────────────────────── │
│ Agent: BlogAgent                                            │
│ • AI writes dev.to-style blog post (800-1500 words)         │
│ • dev.to frontmatter + markdown body                        │
│ • Web search for relevant articles to link                  │
│ • Code snippets, key takeaways, conclusion                  │
│ • References video and shorts                               │
│ • Save to social-posts/devto.md                             │
│ Tool: write_blog                                            │
│ MCP: Exa Web Search ($0.001/search)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Stage 14: Git Push                                          │
│ ────────────────────────────────────────────────────────── │
│ • git add -A                                                │
│ • git commit -m "Add processed video: {slug}"               │
│ • git push origin main                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     PIPELINE COMPLETE                       │
│ ────────────────────────────────────────────────────────── │
│ Output directory: recordings/{slug}/                        │
│ • Video files (original, edited, captioned)                 │
│ • Transcripts (original, adjusted)                          │
│ • Shorts + variants (multiple aspect ratios)                │
│ • Medium clips + captions                                   │
│ • Chapters (4 formats)                                      │
│ • README.md summary + screenshots                           │
│ • Social media posts (5 platforms)                          │
│ • Per-clip posts (shorts + medium)                          │
│ • Blog post (dev.to format)                                 │
│ • Cost report (LLM + services)                              │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Transcripts

```
Original Transcript (transcript.json)
        │
        ├──► Used for: Shorts, Medium Clips, Chapters
        │
        ▼
Silence Removal (AI decides cuts)
        │
        ▼
Adjusted Transcript (transcript-edited.json)
        │
        └──► Used for: Captions (aligned to edited video)
```

### Video Processing

```
Original Video
        │
        ├──────────────────┐
        │                  │
        ▼                  ▼
  Silence Removal    Shorts Extraction
        │            (from original)
        ▼                  │
  Edited Video             │
        │                  ▼
        ▼            Platform Variants
  Caption Burn       (9:16, 1:1, 4:5)
        │                  │
        ▼                  ▼
  Captioned Video    Portrait Captions
                     + Hook Overlay
```

## Agent Interaction Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    LLM Provider Layer                        │
│ (Copilot SDK / OpenAI API / Anthropic API)                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
         ▼             ▼             ▼
   BaseAgent     BaseAgent     BaseAgent
         │             │             │
         ▼             ▼             ▼
   Agent Tool    Agent Tool    Agent Tool
   Handlers      Handlers      Handlers
         │             │             │
         └─────────────┼─────────────┘
                       │
                       ▼
         ┌─────────────────────────┐
         │   FFmpeg Operations     │
         │   • silence detection   │
         │   • clip extraction     │
         │   • caption burning     │
         │   • AR conversion       │
         │   • frame capture       │
         └─────────────────────────┘
```

## Service Dependencies

### External Services

| Service | Usage | Cost |
|---------|-------|------|
| OpenAI Whisper | Transcription | $0.006/min |
| Exa AI | Web search | $0.001/search |
| LLM Provider | All AI agents | Variable by model |

### LLM Model Selection

Agents use configurable models via `src/config/modelConfig.ts`:

- **Premium Tier**: claude-opus-4.6 (3 PRU)
- **Standard Tier**: gpt-5 (1 PRU)
- **Free Tier**: gpt-5-mini (0 PRU)

Override per-agent via `MODEL_{AGENT_NAME}` environment variable.

## Error Handling

```
Pipeline Stage Execution (runStage)
        │
        ├──► Try: Execute stage logic
        │           │
        │           ├──► Success: Record timing, continue
        │           │
        │           └──► Failure: Log error, continue to next stage
        │
        └──► Pipeline does NOT abort on stage failure
             (produces partial results)
```

## Output Directory Structure

```
recordings/
└── {slug}/
    ├── {slug}.mp4                    # Original video
    ├── {slug}-edited.mp4             # Silence-removed
    ├── {slug}-captioned.mp4          # With captions
    ├── transcript.json               # Original transcript
    ├── transcript-edited.json        # Adjusted timestamps
    ├── README.md                     # Generated summary
    ├── cost-report.md                # LLM usage costs
    ├── captions/
    │   ├── {slug}.srt
    │   ├── {slug}.vtt
    │   └── {slug}.ass
    ├── thumbnails/
    │   ├── snapshot-001.png
    │   ├── snapshot-002.png
    │   └── ...
    ├── shorts/
    │   ├── {short-slug}/
    │   │   ├── {short-slug}.mp4
    │   │   ├── {short-slug}-captioned.mp4
    │   │   ├── {short-slug}-tiktok.mp4
    │   │   ├── {short-slug}-youtube-shorts.mp4
    │   │   ├── {short-slug}-instagram-reels.mp4
    │   │   ├── {short-slug}-instagram-feed.mp4
    │   │   ├── {short-slug}-linkedin.mp4
    │   │   ├── metadata.json
    │   │   └── posts/
    │   │       ├── tiktok.md
    │   │       ├── youtube.md
    │   │       └── ...
    │   └── ...
    ├── medium-clips/
    │   ├── {clip-slug}/
    │   │   ├── {clip-slug}.mp4
    │   │   ├── {clip-slug}-captioned.mp4
    │   │   ├── metadata.json
    │   │   └── posts/
    │   │       ├── tiktok.md
    │   │       └── ...
    │   └── ...
    ├── chapters/
    │   ├── chapters.json
    │   ├── chapters-youtube.txt
    │   ├── chapters.md
    │   └── chapters.ffmetadata
    └── social-posts/
        ├── tiktok.md
        ├── youtube.md
        ├── instagram.md
        ├── linkedin.md
        ├── x.md
        └── devto.md
```

## Configuration

### Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...              # Whisper + OpenAI agents
LLM_PROVIDER=copilot|openai|claude # LLM backend

# Optional
ANTHROPIC_API_KEY=sk-...           # For Claude agents
EXA_API_KEY=...                    # For web search
WATCH_FOLDER=./watch               # Input directory
OUTPUT_DIR=./recordings            # Output directory
FFMPEG_PATH=/path/to/ffmpeg        # Custom FFmpeg
FFPROBE_PATH=/path/to/ffprobe      # Custom FFprobe
BRAND_PATH=./brand.json            # Brand config

# Stage control
SKIP_SILENCE_REMOVAL=false
SKIP_SHORTS=false
SKIP_MEDIUM_CLIPS=false
SKIP_SOCIAL=false
SKIP_CAPTIONS=false
SKIP_GIT=false

# Model overrides (per-agent)
MODEL_SILENCEREMOVALAGENT=gpt-5-mini
MODEL_SHORTSAGENT=claude-opus-4.6
MODEL_MEDIUMVIDEOAGENT=gpt-5
# ...
```

### Brand Configuration

`brand.json` defines:

- **Brand identity**: name, handle, website
- **Voice**: tone, personality, style
- **Vocabulary**: custom terms for Whisper
- **Content guidelines**: blog focus, hashtags, avoid topics
- **Advocacy**: interests and topics to emphasize

Used in: SummaryAgent, SocialMediaAgent, BlogAgent

## Performance Characteristics

### Typical Pipeline Duration

For a 10-minute video:

1. **Ingestion**: ~5 seconds (copy + metadata)
2. **Transcription**: ~30 seconds (Whisper API)
3. **Silence Removal**: ~45 seconds (AI + FFmpeg)
4. **Captions**: ~2 seconds (text generation)
5. **Caption Burn**: ~60 seconds (re-encode)
6. **Shorts**: ~120 seconds (AI + extraction + variants)
7. **Medium Clips**: ~90 seconds (AI + extraction)
8. **Chapters**: ~15 seconds (AI analysis)
9. **Summary**: ~30 seconds (AI + screenshots)
10. **Social Media**: ~20 seconds (AI + web search)
11. **Short Posts**: ~10 seconds per short × 5
12. **Medium Clip Posts**: ~10 seconds per clip × 3
13. **Blog**: ~25 seconds (AI + web search)
14. **Git Push**: ~5 seconds

**Total**: ~7-10 minutes for a 10-minute video

### Token Usage

Approximate token usage per 10-minute video:

- **SilenceRemovalAgent**: 2K tokens
- **ShortsAgent**: 5K tokens
- **MediumVideoAgent**: 4K tokens
- **ChapterAgent**: 3K tokens
- **SummaryAgent**: 4K tokens
- **SocialMediaAgent**: 3K × 3 calls = 9K tokens
- **BlogAgent**: 6K tokens

**Total**: ~33K tokens (~$0.15 with gpt-5 pricing)

## Testing

Run the analysis tool to verify pipeline configuration:

```bash
npm run analyze:prompts
```

Outputs:
- Agent breakdown with word counts
- Tool coverage
- Common patterns
- Tone distribution

## Related Documentation

- [Prompt Analysis Tool](./prompt-analysis-readme.md) — Analyze pipeline prompts
- [Prompt Analysis Report](./prompt-analysis.md) — Full agent analysis
- [Custom Instructions](../custom_instructions.md) — Development guidelines
- [Main README](../README.md) — Project overview

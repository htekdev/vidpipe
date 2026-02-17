---
name: video-review
description: Review and inspect video files using Gemini AI vision. Use this skill when asked to inspect, review, analyze, describe, or understand what's happening in a video file. Supports custom prompts for targeted analysis.
---

# Video Review Skill

Analyze any video file using Google Gemini's vision model. Upload the video, send a custom prompt (or use a default review prompt), and return Gemini's analysis.

## Prerequisites

- `GEMINI_API_KEY` environment variable set (get one at https://aistudio.google.com/apikey)
- Video file must exist on disk (mp4, webm, mov)

## How to Use

Run the `review-video.ts` script in this skill directory with the video path and an optional prompt:

```powershell
cd C:\Repos\htekdev\video-auto-note-taker
npx tsx .github/skills/video-review/review-video.ts "<video-path>" "<optional-prompt>"
```

### Arguments

1. **video-path** (required): Absolute or relative path to the video file
2. **prompt** (optional): Custom prompt to send alongside the video. If omitted, uses a general review prompt that describes what's happening in the video.

### Examples

```powershell
# General review — describe what's in the video
npx tsx .github/skills/video-review/review-video.ts "recordings/my-video/short-clip.mp4"

# Custom prompt — ask specific questions
npx tsx .github/skills/video-review/review-video.ts "recordings/my-video/short-clip.mp4" "Are the captions readable? Do they overlap with any important content on screen?"

# Check caption quality on a short
npx tsx .github/skills/video-review/review-video.ts "recordings/my-video/shorts/clip-square-captioned.mp4" "Describe what you see. Are there any visual issues, glitches, or misaligned elements?"

# Review editorial decisions
npx tsx .github/skills/video-review/review-video.ts "recordings/my-video/my-video-edited.mp4" "Does this video flow well? Are there any jarring cuts or awkward transitions?"
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google AI Studio API key |
| `GEMINI_MODEL` | No | Model to use (default: `gemini-2.5-pro`) |

### Output

The script prints Gemini's full analysis to stdout. For large outputs, pipe to a file:

```powershell
npx tsx .github/skills/video-review/review-video.ts "video.mp4" "What's wrong?" > review-output.md
```

## Default Prompt

When no custom prompt is provided, the script uses:

> Describe everything you see in this video in detail. Cover: visual layout, text/captions visible, any overlays or graphics, video quality, audio sync observations, pacing, and anything that looks wrong or could be improved. Be specific with timestamps.

## Troubleshooting

- **"GEMINI_API_KEY is required"**: Set the env var in your `.env` file or shell
- **Timeout on large videos**: Gemini processes uploads async — long videos may take 30-60s to become ready
- **Empty response**: Try a simpler prompt or a shorter video clip

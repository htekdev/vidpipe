---
title: Social Publishing
---

# Social Media Publishing

## Overview

vidpipe can automatically generate and schedule social media posts for your videos across 5 platforms: TikTok, YouTube, Instagram, LinkedIn, and X/Twitter.

**How it works:**
1. The pipeline generates posts and video variants for each platform
2. Posts are queued locally for review (nothing is published automatically)
3. You review, edit, approve, or reject posts via `vidpipe review`
4. Approved posts are scheduled at optimal times via [Late](https://getlate.dev)

## Prerequisites

- A [Late](https://getlate.dev) account (Build plan: $19/mo, 120 posts/mo)
- Social media accounts connected in the Late dashboard

## Setup

### Quick Setup (Recommended)

Run the interactive setup wizard:

```bash
vidpipe init
```

This walks you through:
- Verifying FFmpeg installation
- Setting up API keys (OpenAI, Late)
- Connecting social accounts
- Creating `schedule.json` with optimal posting times

### Manual Setup

1. **Sign up at [getlate.dev](https://getlate.dev)** — Choose the Build plan
2. **Connect your social accounts** in the Late dashboard
3. **Add your API key** to `.env`:
   ```
   LATE_API_KEY=sk_your_key_here
   ```
4. **Create `schedule.json`** (or run `vidpipe init` to auto-generate):
   ```json
   {
     "timezone": "America/Chicago",
     "platforms": {
       "linkedin": {
         "slots": [
           { "days": ["tue", "wed"], "time": "08:00", "label": "Morning thought leadership" },
           { "days": ["tue", "wed", "thu"], "time": "12:00", "label": "Lunch break engagement" }
         ],
         "avoidDays": ["sat", "sun"]
       },
       "tiktok": {
         "slots": [
           { "days": ["tue", "wed", "thu"], "time": "19:00", "label": "Prime entertainment hours" },
           { "days": ["fri", "sat"], "time": "21:00", "label": "Weekend evening" }
         ],
         "avoidDays": []
       },
       "instagram": {
         "slots": [
           { "days": ["tue", "wed", "thu"], "time": "10:00", "label": "Morning scroll" },
           { "days": ["wed", "thu", "fri"], "time": "19:30", "label": "Evening couch time" }
         ],
         "avoidDays": []
       },
       "youtube": {
         "slots": [
           { "days": ["fri"], "time": "15:00", "label": "Afternoon pre-weekend" },
           { "days": ["thu", "fri"], "time": "20:00", "label": "Prime evening viewing" }
         ],
         "avoidDays": ["mon"]
       },
       "twitter": {
         "slots": [
           { "days": ["mon", "tue", "wed", "thu", "fri"], "time": "08:30", "label": "Morning news check" },
           { "days": ["tue", "wed", "thu"], "time": "12:00", "label": "Lunch scroll" },
           { "days": ["mon", "tue", "wed", "thu", "fri"], "time": "17:00", "label": "Commute home" }
         ],
         "avoidDays": []
       }
     }
   }
   ```
5. **Verify setup:**
   ```bash
   vidpipe doctor
   ```

## Reviewing Posts

```bash
vidpipe review
```

This opens a web app at `http://localhost:3847` with a **grouped card-based review interface**:

### Grouped Approval

Posts are automatically grouped by their source video/clip. Instead of reviewing each platform separately, you now:

1. **See one card per video/clip** with platform checkboxes
2. **Select which platforms to publish to** using checkboxes
3. **Approve once** to publish to all selected platforms

**Benefits:**
- Review the same video once instead of 5 times
- Flexible platform selection per video
- Platforms without connected accounts are automatically disabled

### Review Actions

- **✅ Approve** — Schedules posts to all selected platforms at optimal times
- **❌ Reject All** — Removes all posts in the group from the queue
- **⏭️ Skip** — Leave for later review

**Keyboard shortcuts:**
- `→` (Right Arrow) = Approve selected
- `←` (Left Arrow) = Reject all
- `Space` = Skip

### Platform Selection

Each group card shows checkboxes for all available platforms:
- ✅ **Auto-selected**: Platforms with connected accounts are pre-selected
- ⚠️ **Disabled**: Platforms without connected accounts cannot be selected
- **Count badge**: Approve button shows how many platforms are selected

**Example workflow:**
1. Card loads with 5 platform checkboxes (TikTok, YouTube, Instagram, LinkedIn, X)
2. Connected accounts (e.g., TikTok, YouTube, Instagram) are auto-selected
3. Uncheck any platforms you don't want to post to
4. Click "Approve (3)" to schedule posts to the 3 selected platforms

## Schedule Configuration

`schedule.json` controls when posts are scheduled per platform:

```json
{
  "timezone": "America/Chicago",
  "platforms": {
    "linkedin": {
      "slots": [
        { "days": ["tue", "wed"], "time": "08:00", "label": "Morning thought leadership" },
        { "days": ["tue", "wed", "thu"], "time": "12:00", "label": "Lunch break engagement" }
      ],
      "avoidDays": ["sat", "sun"]
    }
  }
}
```

### Configuration Options

| Field | Description |
|-------|-------------|
| `timezone` | Your local timezone (IANA format) |
| `slots[].days` | Days of the week to post (mon-sun) |
| `slots[].time` | Time in HH:MM format |
| `slots[].label` | Human-readable description of the time slot |
| `avoidDays` | Days to never post |

### Default Times (Research-Backed)

| Platform | Best Times | Best Days |
|----------|-----------|-----------|
| LinkedIn | 8 AM, 12 PM | Tue–Wed |
| TikTok | 7 PM | Tue–Thu |
| Instagram | 10 AM, 7:30 PM | Tue–Thu |
| YouTube | 3 PM, 8 PM | Thu–Fri |
| X/Twitter | 8:30 AM, 12 PM, 5 PM | Mon–Fri |

## Viewing the Schedule

```bash
vidpipe schedule
vidpipe schedule --platform linkedin
```

## Queue Structure

Posts are stored in `{OUTPUT_DIR}/publish-queue/`:

```
publish-queue/
├── my-tip-tiktok/
│   ├── media.mp4        # Platform-optimized video
│   ├── metadata.json    # Scheduling and platform data
│   └── post.md          # Post text content
```

Each post folder contains:
- **sourceVideo**: Path to the original video directory
- **sourceClip**: Path to the short/medium clip directory (null for full video posts)
- **clipType**: `video`, `short`, or `medium-clip`

Posts with the same `sourceVideo` + `sourceClip` are automatically grouped in the review UI.

Approved posts move to `published/`. Rejected posts are deleted.

### Backward Compatibility

The original single-post review UI is preserved at `src/review/public/index-single.html` for reference. The new grouped UI is fully backward compatible with existing queue data.

## Troubleshooting

### "No Late API key configured"
Run `vidpipe init` or add `LATE_API_KEY=...` to `.env`

### "No social accounts connected"
Log into [getlate.dev](https://getlate.dev) and connect your social accounts

### "No available schedule slots"
Your `schedule.json` may be too restrictive. Add more time slots.

### "Upload failed"
Check your internet connection. Late API requires network access to upload media.

### Token expiry
Some platforms (e.g., TikTok) have short-lived tokens. Late handles refresh automatically, but you may need to reconnect in the Late dashboard if you see auth errors.

## CLI Reference

| Command | Description |
|---------|-------------|
| `vidpipe init` | Interactive setup wizard |
| `vidpipe review` | Open post review web app |
| `vidpipe review --port 3847` | Custom port |
| `vidpipe schedule` | View posting schedule |
| `vidpipe schedule --platform X` | Filter by platform |
| `vidpipe doctor` | Verify setup |
| `--no-social-publish` | Skip queue-build stage |

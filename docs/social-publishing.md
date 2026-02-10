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

This opens a web app at `http://localhost:3847` with a card-based review interface:

- **✅ Approve** — Schedules the post at the next optimal time
- **❌ Reject** — Removes the post from the queue
- **✏️ Edit** — Inline text editing with character count
- **⏭️ Skip** — Leave for later review

**Keyboard shortcuts:**
- `→` (Right Arrow) = Approve
- `←` (Left Arrow) = Reject
- `E` = Edit
- `Space` = Skip

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

Approved posts move to `published/`. Rejected posts are deleted.

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

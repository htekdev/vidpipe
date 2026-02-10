# Scheduling System Debug Guide

> **Last updated**: 2026-02-09

## Overview

The scheduling system (`src/services/scheduler.ts`) finds the next available posting slot for each platform based on configured time slots, existing bookings, and per-day limits.

---

## How It Works

### Flow: Approve → Schedule → Late API

```
User clicks Approve
  → routes.ts: findNextSlot(platform)
  → scheduler.ts: loads schedule.json config
  → scheduler.ts: queries Late API for existing scheduled posts
  → scheduler.ts: queries local published/ folder for already-scheduled items
  → scheduler.ts: iterates in 14-day chunks up to 730 days ahead, finds first open slot
  → routes.ts: creates post in Late API with that datetime
  → postStore.ts: moves item to published/ folder
```

### Slot Selection Algorithm (`findNextSlot`)

1. Load platform config from `schedule.json` (slots, avoidDays)
2. Fetch booked slots from:
   - **Late API** (`GET /posts?status=scheduled&platform=X`) — already scheduled posts
   - **Local** (`recordings/published/`) — items approved in this session
3. Build normalized timestamps of booked datetimes for O(1) collision lookup
4. Iterate in 14-day chunks from tomorrow, up to 730 days (~2 years):
   - Get day-of-week in configured timezone
   - Skip `avoidDays`
   - Collect all slot times that match this day-of-week, sort chronologically
   - For each candidate time: build ISO datetime, check if already booked
   - Return first available slot
5. If nothing found in 730 days → return `null` (409 error)

---

## Configuration (`schedule.json`)

```json
{
  "timezone": "America/Chicago",
  "platforms": {
    "tiktok": {
      "slots": [
        { "days": ["tue", "wed", "thu"], "time": "19:00", "label": "Prime entertainment hours" },
        { "days": ["fri", "sat"], "time": "21:00", "label": "Weekend evening" }
      ],
      "avoidDays": []
    }
  }
}
```

### Fields

| Field | Description |
|-------|-------------|
| `timezone` | IANA timezone (e.g., `America/Chicago`). All slot times are in this timezone. |
| `slots[].days` | Array of 3-letter day abbreviations: `mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun` |
| `slots[].time` | `HH:MM` in 24h format, interpreted in the configured timezone |
| `avoidDays` | Days to never schedule on (e.g., `["sat", "sun"]` for LinkedIn) |

---

## Observed Issue: Skipped Days (2026-02-09)

### What happened

Approved 4 TikTok posts. Expected consecutive days (Tue–Fri), but got gaps:

| # | Expected | Actual | Status |
|---|----------|--------|--------|
| 1 | Feb 10 (Tue) 19:00 | Feb 10 (Tue) 19:00 ✅ | Correct |
| 2 | Feb 11 (Wed) 19:00 | **Feb 12 (Thu) 19:00** ❌ | Wed skipped |
| 3 | Feb 12 (Thu) 19:00 | **Feb 14 (Sat) 21:00** ❌ | Fri skipped |
| 4 | Feb 13 (Fri) 21:00 | Not scheduled | — |

### Root Cause: UTC vs Local Date in Collision Detection

**The bug** was in collision detection logic. It compared calendar dates using **UTC** date components instead of properly handling timezones.

**The fix**: The scheduler now uses normalized timestamp comparison via `normalizeDateTime()` which converts ISO strings to milliseconds since epoch for collision detection, properly handling different ISO formats and timezone offsets.

---

## How to Debug Scheduling Issues

### 1. Check the schedule config

```bash
cat schedule.json | jq '.platforms.tiktok'
```

### 2. Check what's already scheduled in Late API

```bash
curl -s "https://getlate.dev/api/v1/posts?status=scheduled&platform=tiktok" \
  -H "Authorization: Bearer $LATE_API_KEY" | jq '.posts[] | {scheduledFor, status}'
```

### 3. Check local published items

```powershell
Get-ChildItem recordings\published\*tiktok* | ForEach-Object {
  $meta = Get-Content "$($_.FullName)\metadata.json" | ConvertFrom-Json
  [PSCustomObject]@{ Id = $meta.id; ScheduledFor = $meta.scheduledFor; Platform = $meta.platform }
}
```

### 4. Check the schedule calendar endpoint

```bash
curl -s http://localhost:3847/api/schedule | jq '.slots[] | select(.platform == "tiktok")'
```

### 5. Check next available slot

```bash
curl -s http://localhost:3847/api/schedule/next-slot/tiktok | jq
```

### 6. Enable debug logging

Set `LOG_LEVEL=debug` to see scheduler decisions:
```
[DEBUG] Found available slot for tiktok: 2026-02-10T19:00:00-06:00
```

---

## Key Collision Detection Details

### Booked Slot Sources

| Source | What it checks | When |
|--------|---------------|------|
| Late API (`GET /posts?status=scheduled`) | Posts scheduled in Late dashboard or via API | Always (with graceful fallback) |
| Local published (`recordings/published/`) | Posts approved in this session | Always |

### String-Based Collision

Collisions use **normalized timestamp matching**:

```typescript
const bookedDatetimes = new Set(bookedSlots.map(s => normalizeDateTime(s.scheduledFor)))
if (!bookedDatetimes.has(normalizeDateTime(slotDatetime))) { /* slot is free */ }
```

This normalizes ISO strings to milliseconds since epoch, so different ISO format variations (e.g., `2026-02-10T19:00:00-06:00` vs `2026-02-10T19:00:00-0600`) will correctly match. The `buildSlotDatetime()` function produces consistent format `YYYY-MM-DDTHH:MM:00±HH:MM`.

### Slot Availability

The scheduler looks ahead up to 730 days (~2 years) in 14-day chunks. If all configured slots are booked in this window, `findNextSlot()` returns `null` and the approve fails with 409.

---

## Timezone Handling

| Function | Purpose |
|----------|---------|
| `getTimezoneOffset(tz, date)` | Gets UTC offset string (e.g., `-06:00`) for a date in a timezone |
| `buildSlotDatetime(date, time, tz)` | Builds ISO string like `2026-02-10T19:00:00-06:00` |
| `getDayOfWeekInTimezone(date, tz)` | Gets day-of-week key (`tue`, `wed`, etc.) in timezone |
| `getDateInTimezone(date, tz)` | Gets `{year, month, day}` components in timezone |
| `isSameDayInTimezone(a, b, tz)` | Checks if two Dates are the same calendar day in timezone |

All timezone operations use `Intl.DateTimeFormat` which handles DST correctly.

---

## Known Edge Cases

1. **DST transitions**: If a slot falls exactly during a DST change (e.g., March "spring forward"), the offset might be ambiguous. The code handles this by using `Intl.DateTimeFormat` with the actual date.

2. **Late API downtime**: If the Late API is unreachable, `fetchScheduledPostsSafe()` returns `[]`. The scheduler will only use local data, potentially double-booking slots that exist in Late but not locally.

3. **Queue race condition**: Late has a built-in queue system (`queuedFromProfile`). Our manual slot selection could conflict with Late's queue if both are used simultaneously.

4. **730-day limit**: If all slots in the next 730 days (~2 years) are booked, `findNextSlot()` returns `null` and the approve fails with 409.

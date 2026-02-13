---
name: late-api
description: Manage Late.co social media scheduling API — list, reschedule, bulk delete, and sync scheduled posts. Use this skill when asked to manage scheduled posts, clean up the Late queue, reschedule posts, inspect Late API state, or troubleshoot Late API issues.
---

# Late API Management Skill

Operational workflows for managing scheduled social media posts via the Late.co API (`https://getlate.dev/api/v1`). This skill helps you list, reschedule, bulk delete, and sync posts when the posting schedule changes or issues arise.

## Prerequisites

- `LATE_API_KEY` environment variable set (Bearer token, format: `sk_...`)
- The project's `schedule.json` in the repo root defines posting time slots per platform

## Authentication

All requests use Bearer auth:
```bash
curl -H "Authorization: Bearer $env:LATE_API_KEY" https://getlate.dev/api/v1/posts
```

## API Base URL

```
https://getlate.dev/api/v1
```

---

## API Reference

### Posts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/posts` | List posts. Supports query params: `status` (draft/scheduled/published/failed), `platform`, `profileId`, `dateFrom`, `dateTo`, `createdBy`, `includeHidden` |
| `POST` | `/v1/posts` | Create a post. Fields: `content`, `platforms` (array of `{platform, accountId}`), `scheduledFor` (ISO datetime), `timezone`, `isDraft`, `publishNow`, `mediaItems`, `queuedFromProfile`, `queueId`, `tags`, `hashtags`, `tiktokSettings`, `platformSpecificData` |
| `GET` | `/v1/posts/{postId}` | Get a single post by ID |
| `PUT` | `/v1/posts/{postId}` | Update a post. Only draft/scheduled/failed/partial posts can be edited. Fields: `content`, `scheduledFor`, `tiktokSettings` |
| `DELETE` | `/v1/posts/{postId}` | Delete a post. Published posts cannot be deleted. Refunds upload quota |
| `POST` | `/v1/posts/bulk-upload` | Bulk upload from CSV. Optional `dryRun` query param |

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/accounts` | List connected social media accounts |

### Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/profiles` | List profiles |
| `POST` | `/v1/profiles` | Create a profile |

### Queue (Late's built-in scheduling)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/queue/slots?profileId=X` | Get queue schedules for a profile. Add `all=true` for all queues |
| `POST` | `/v1/queue/slots` | Create a new queue. Body: `profileId`, `name`, `timezone`, `slots`, `active` |
| `PUT` | `/v1/queue/slots` | Update queue. Body: `profileId`, `queueId`, `timezone`, `slots`, `reshuffleExisting` (auto-reschedule existing posts) |
| `DELETE` | `/v1/queue/slots?profileId=X&queueId=Y` | Delete a queue |
| `GET` | `/v1/queue/preview?profileId=X&count=N` | Preview upcoming N queue slots |
| `GET` | `/v1/queue/next-slot?profileId=X` | Preview next available slot (informational only — do NOT use with `scheduledFor`) |

### Media

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/media/presign` | Get presigned upload URL. Body: `{filename, contentType}` → `{uploadUrl, publicUrl, key, expiresIn}` |
| `PUT` | `{uploadUrl}` | Upload file bytes to the presigned URL with `Content-Type` header |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/analytics` | Get post performance metrics and engagement data |

### Publishing Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/logs` | View publishing attempt logs (API endpoint, status, request/response, retries). Retained 7 days |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/webhooks` | List configured webhooks |
| `POST` | `/v1/webhooks` | Create a webhook. Events: `post.scheduled`, `post.published`, `post.failed`, `post.partial`, `account.connected`, `account.disconnected`, `message.received` |

---

## Rate Limits

| Plan | Requests/min |
|------|-------------|
| Free | 60 |
| Build | 120 |
| Accelerate | 600 |
| Unlimited | 1,200 |

Additional limits:
- **Velocity**: 15 posts/hour/account
- **Daily**: Platform-specific (X: 20, Pinterest: 25, Instagram/Facebook: 100, Threads: 250, others: 50)
- **Cooldown**: Escalating backoff on repeated errors (10min → 20min → 40min → 24h)

---

## Project-Specific Context

### schedule.json Format

The project's `schedule.json` (repo root) defines local posting time slots:

```json
{
  "timezone": "America/Chicago",
  "platforms": {
    "linkedin": {
      "slots": [
        { "days": ["tue", "wed"], "time": "08:00", "label": "Morning thought leadership" }
      ],
      "avoidDays": ["sat", "sun"]
    }
  }
}
```

### Existing LateApiClient (src/services/lateApi.ts)

The project has a TypeScript client with these methods:
- `listProfiles()` → `LateProfile[]`
- `listAccounts()` → `LateAccount[]`
- `getScheduledPosts(platform?)` → `LatePost[]`
- `getDraftPosts(platform?)` → `LatePost[]`
- `createPost(params)` → `LatePost`
- `updatePost(postId, updates)` → `LatePost`
- `deletePost(postId)` → `void`
- `uploadMedia(filePath)` → `{url, type}`
- `validateConnection()` → `{valid, profileName?, error?}`

### Local Queue (src/services/postStore.ts)

Published posts are tracked locally in `publish-queue/` (pending) and `published/` (done). Each item has `metadata.json` with `latePostId`, `scheduledFor`, `platform`, `accountId`, `status`.

### Scheduler (src/services/scheduler.ts)

`findNextSlot(platform)` finds the next available time slot by:
1. Loading `schedule.json` config
2. Fetching booked slots from Late API + local published items
3. Generating candidates in 14-day chunks, sorted chronologically
4. Returning the first unbooked candidate

---

## Operational Workflows

### 1. List All Scheduled Posts

```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/posts?status=scheduled" | python -m json.tool
```

Filter by platform:
```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/posts?status=scheduled&platform=linkedin"
```

Filter by date range:
```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/posts?status=scheduled&dateFrom=2026-02-01&dateTo=2026-03-01"
```

### 2. Reschedule a Single Post

```bash
curl -s -X PUT -H "Authorization: Bearer $env:LATE_API_KEY" \
  -H "Content-Type: application/json" \
  "https://getlate.dev/api/v1/posts/{postId}" \
  -d '{"scheduledFor": "2026-02-20T08:00:00-06:00"}'
```

### 3. Bulk Reschedule All Posts (Schedule Change)

When `schedule.json` changes, use this workflow:

1. **Read the new schedule** from `schedule.json`
2. **Fetch all scheduled posts** from Late API
3. **For each post**, compute the new optimal time slot based on the updated schedule
4. **Update each post** with the new `scheduledFor` datetime via `PUT /v1/posts/{postId}`
5. **Report** what changed (old time → new time for each post)

**Important**: Always confirm with the user before executing bulk reschedule. Show them the proposed changes first.

### 4. Bulk Delete Scheduled Posts

```bash
# First list to confirm what will be deleted
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/posts?status=scheduled&platform=twitter"

# Then delete each post by ID (published posts CANNOT be deleted)
curl -s -X DELETE -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/posts/{postId}"
```

**Important**: Always list and confirm with the user before deleting. Show post content previews.

### 5. Sync Local Queue with Late API

Compare local `published/` metadata with Late API state:

1. Read all local published items from `recordings/*/publish-queue/` and `published/`
2. For each item with a `latePostId`, fetch the Late post via `GET /v1/posts/{postId}`
3. Report mismatches:
   - **Orphaned in Late**: Posts in Late API with no matching local item
   - **Orphaned locally**: Local items with `latePostId` that no longer exists in Late
   - **Schedule mismatch**: `scheduledFor` differs between local metadata and Late API

### 6. Validate Late API Connection

```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/profiles"
```

If this returns profiles, the connection is valid. If 401, the API key is invalid or expired.

### 7. View Publishing Logs

```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/logs"
```

Shows publishing attempts with platform API endpoint, HTTP status, request/response bodies, and retry info. Logs are retained for 7 days.

### 8. Inspect Connected Accounts

```bash
curl -s -H "Authorization: Bearer $env:LATE_API_KEY" \
  "https://getlate.dev/api/v1/accounts" | python -m json.tool
```

Returns all connected social accounts with `_id`, `platform`, `username`, `displayName`, `isActive`, `profileId`.

### 9. Update Late Queue Slots (with auto-reshuffle)

If you want Late's built-in queue (not the local `schedule.json`) to reschedule existing posts:

```bash
curl -s -X PUT -H "Authorization: Bearer $env:LATE_API_KEY" \
  -H "Content-Type: application/json" \
  "https://getlate.dev/api/v1/queue/slots" \
  -d '{
    "profileId": "PROFILE_ID",
    "timezone": "America/Chicago",
    "slots": [
      {"day": "tue", "time": "08:00"},
      {"day": "wed", "time": "12:00"}
    ],
    "reshuffleExisting": true
  }'
```

The `reshuffleExisting: true` flag tells Late to automatically move existing queued posts to match the new slots.

---

## Safety Rules

1. **Never delete published posts** — the API will reject it anyway (400 error)
2. **Always list before bulk operations** — show the user what will be affected
3. **Confirm destructive actions** — ask the user to approve before deleting or rescheduling multiple posts
4. **Use `dryRun` for bulk uploads** — test with `?dryRun=true` query param first
5. **Respect rate limits** — add delays between bulk API calls (60 req/min on free plan)
6. **Handle 429 responses** — check `Retry-After` header and wait before retrying

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| 401 Unauthorized | Invalid or expired API key | Check `LATE_API_KEY` env var, regenerate key at getlate.dev settings |
| 429 Rate Limited | Too many requests | Wait for `Retry-After` period, add delays between bulk calls |
| 400 on DELETE | Trying to delete a published post | Published posts cannot be deleted — only draft/scheduled/failed |
| 400 on PUT | Trying to update a published post | Published/publishing/cancelled posts cannot be edited |
| Empty posts list | Wrong status filter or no posts exist | Try without status filter, check platform filter matches account |
| Media upload fails | Presigned URL expired (1 hour) | Request a new presigned URL and retry upload |
| Duplicate 409 | Same content posted to same account within 24h | Change content or wait 24 hours |
| Account cooldown | Repeated publishing errors | Wait for cooldown to expire (escalating: 10min → 24h) |

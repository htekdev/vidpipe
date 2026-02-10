---
title: Late API Reference
---

# Late.dev API Reference (Grounding Document)

> **Source**: [docs.getlate.dev](https://docs.getlate.dev) — Official Late API Documentation
>
> **Last verified**: 2026-02-09
>
> **Base URL**: `https://getlate.dev/api/v1`

---

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer YOUR_API_KEY
```

API keys are generated from the [Late Dashboard](https://getlate.dev/dashboard).

---

## Endpoints Overview

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/posts` | List posts (paginated, filterable) |
| `POST` | `/v1/posts` | Create draft, scheduled, or immediate post |
| `GET` | `/v1/posts/{postId}` | Get single post |
| `PUT` | `/v1/posts/{postId}` | Update draft/scheduled/failed post |
| `DELETE` | `/v1/posts/{postId}` | Delete draft/scheduled post |
| `POST` | `/v1/posts/{postId}/retry` | Retry a failed post |
| `POST` | `/v1/posts/bulk-upload` | Bulk create from CSV |
| `GET` | `/v1/accounts` | List connected social accounts |
| `DELETE` | `/v1/accounts/{accountId}` | Disconnect account |
| `PUT` | `/v1/accounts/{accountId}` | Update account display info |
| `GET` | `/v1/accounts/health` | Check health of all accounts |
| `GET` | `/v1/accounts/{accountId}/health` | Check health of specific account |
| `GET` | `/v1/accounts/follower-stats` | Follower growth metrics (requires analytics) |
| `GET` | `/v1/connect/{platform}` | Start OAuth connection flow |
| `GET` | `/v1/profiles` | List profiles |
| `POST` | `/v1/profiles` | Create profile |
| `GET` | `/v1/analytics` | Post analytics (requires analytics add-on) |

### Utilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/media/presign` | Get presigned upload URL (up to 5GB) |
| `GET` | `/v1/queue/next-slot` | Get next queue slot |

---

## Create Post (POST /v1/posts)

### Request Body

```typescript
{
  // Content
  title?: string                    // Post title (used by YouTube, Pinterest)
  content?: string                  // Caption/text. Optional when media attached or customContent set.
                                    // Required for text-only posts.

  // ⚠️ MEDIA — Use mediaItems, NOT mediaUrls
  mediaItems?: MediaItem[]          // Array of media objects (see below)

  // Targeting
  platforms: PlatformTarget[]       // Required — at least one platform

  // Scheduling
  scheduledFor?: string             // ISO 8601 datetime (e.g. "2024-11-01T10:00:00Z")
  publishNow?: boolean              // Default: false. Set true for immediate publish.
  isDraft?: boolean                 // Default: false. Saves without scheduling.
  timezone?: string                 // Default: "UTC" (e.g. "America/New_York")

  // Queue scheduling (alternative to scheduledFor)
  queuedFromProfile?: string        // Profile ID — auto-assigns next slot
  queueId?: string                  // Specific queue (optional, uses default if omitted)
  // ⚠️ Do NOT call /queue/next-slot then use scheduledFor — that bypasses queue locking

  // Metadata
  tags?: string[]                   // Tags/keywords (YouTube: ≤100 chars each, ≤500 total)
  hashtags?: string[]
  mentions?: string[]
  crosspostingEnabled?: boolean     // Default: true
  metadata?: object

  // TikTok shorthand (merged into each TikTok platform entry)
  tiktokSettings?: TikTokSettings
}
```

### MediaItem Object

```typescript
interface MediaItem {
  type: 'image' | 'video'          // Required
  url: string                       // Public URL (from presign flow)
  thumbnail?: {                     // Optional — YouTube custom thumbnail
    url: string                     // Thumbnail public URL
  }
}
```

**Example:**
```json
{
  "mediaItems": [
    { "type": "video", "url": "https://media.getlate.dev/temp/123_abc_video.mp4" }
  ]
}
```

### PlatformTarget Object

```typescript
interface PlatformTarget {
  platform: string                  // "twitter" | "instagram" | "tiktok" | "youtube" | "linkedin" | etc.
  accountId: string                 // Account ID from GET /v1/accounts
  platformSpecificData?: object     // Platform-specific settings (see below)
  customContent?: string            // Override content for this platform
  customMedia?: MediaItem[]         // Override media for this platform
}
```

### Response Shape

```json
// 201 Created
{
  "post": {
    "_id": "65f1c0a9e2b5af0012ab34cd",
    "content": "...",
    "status": "scheduled",
    "scheduledFor": "2024-11-01T10:00:00Z",
    "platforms": [{
      "platform": "twitter",
      "accountId": { "_id": "64e1f0...", "platform": "twitter", "username": "@acme", ... },
      "status": "pending"
    }]
  },
  "message": "Post scheduled successfully"
}
```

### Error Responses

| Status | Meaning | Example |
|--------|---------|---------|
| 400 | Validation error | `{"error": "Tiktok posts require media content (images or videos)"}` |
| 401 | Bad/missing API key | `{"error": "Unauthorized"}` |
| 403 | Permission denied | `{"error": "..."}` |
| 409 | Duplicate content | `{"error": "This exact content was already posted...", "details": {...}}` |
| 429 | Rate limited | `{"error": "...", "details": {}}` — check `Retry-After` header |

---

## List Posts (GET /v1/posts)

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `page` | integer | Page number (1-based). Default: 1 |
| `limit` | integer | Page size (1–100). Default: 10 |
| `status` | string | `"draft"` \| `"scheduled"` \| `"published"` \| `"failed"` |
| `platform` | string | Filter by platform |
| `profileId` | string | Filter by profile |
| `createdBy` | string | Filter by creator |
| `dateFrom` | string | ISO date filter |
| `dateTo` | string | ISO date filter |
| `includeHidden` | boolean | Default: false |

### Response Shape

```json
{
  "posts": [...],
  "pagination": { "page": 1, "limit": 10, "total": 42, "pages": 5 }
}
```

---

## Media Upload (Presign Flow)

### Step 1: Get presigned URL

```
POST /v1/media/presign
{
  "filename": "my-video.mp4",
  "contentType": "video/mp4",
  "size": 702000000           // Optional — pre-validate size (max 5GB)
}
```

**Allowed content types:** `image/jpeg`, `image/jpg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, `video/mpeg`, `video/quicktime`, `video/avi`, `video/x-msvideo`, `video/webm`, `video/x-m4v`, `application/pdf`

**Response:**
```json
{
  "uploadUrl": "<presigned-r2-url>",
  "publicUrl": "https://media.getlate.dev/temp/1234567890_abc123_my-video.mp4",
  "key": "temp/1234567890_abc123_my-video.mp4",
  "type": "video"
}
```

### Step 2: Upload file to presigned URL

```
PUT {uploadUrl}
Content-Type: video/mp4
Content-Length: 702000000
Body: <file bytes>
```

- Presigned URLs expire in **3600 seconds** (1 hour)
- Public URLs are served from `media.getlate.dev` CDN
- URLs are **immediately accessible** after upload — no confirmation step needed

### Step 3: Use publicUrl in createPost

```json
{
  "mediaItems": [{ "type": "video", "url": "https://media.getlate.dev/temp/..." }]
}
```

---

## Accounts (GET /v1/accounts)

### Response Shape

```json
{
  "accounts": [
    {
      "_id": "64e1...",
      "platform": "twitter",
      "profileId": { "_id": "64f0...", "name": "My Brand", "slug": "my-brand" },
      "username": "@acme",
      "displayName": "Acme",
      "profileUrl": "https://x.com/acme",
      "isActive": true
    }
  ],
  "hasAnalyticsAccess": false
}
```

### Query Parameters

| Param | Type | Description |
|-------|------|-------------|
| `profileId` | string | Filter by profile |
| `includeOverLimit` | boolean | Include over-plan-limit accounts |

---

## Profiles (GET /v1/profiles)

### Response Shape

```json
{
  "profiles": [
    {
      "_id": "prof_abc123",
      "name": "My First Profile",
      "description": "...",
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

---

## Platform-Specific Settings

Settings go in `platformSpecificData` within each `platforms[]` entry:

```json
{
  "platforms": [{
    "platform": "youtube",
    "accountId": "acc_123",
    "platformSpecificData": {
      "title": "My Video Title",
      "visibility": "public"
    }
  }]
}
```

### Twitter/X

| Property | Type | Description |
|----------|------|-------------|
| `threadItems` | array | `[{content, mediaItems?}]` — multi-tweet thread |

### Instagram

| Property | Type | Description |
|----------|------|-------------|
| `contentType` | `"story"` | Publish as Instagram Story |
| `shareToFeed` | boolean | For Reels: show on profile feed (default: true) |
| `collaborators` | string[] | Up to 3 usernames as collaborators |
| `firstComment` | string | Auto-post first comment |
| `userTags` | array | `[{username, x, y}]` — tag users in photos |
| `audioName` | string | Custom audio name for Reels |
| `thumbOffset` | integer | Millisecond offset for Reel thumbnail |

### YouTube

| Property | Type | Description |
|----------|------|-------------|
| `title` | string | Video title (max 100 chars, defaults to first line of content) |
| `visibility` | `"public"` \| `"private"` \| `"unlisted"` | Default: `"public"` |
| `madeForKids` | boolean | COPPA flag (default: false) |
| `firstComment` | string | Auto-post first comment (max 10k chars) |
| `tags` | string[] | Video tags (≤100 chars each, ≤500 total) |
| `containsSyntheticMedia` | boolean | AI content disclosure |
| `categoryId` | string | Category (default: "22" People & Blogs). Common: "27" Education, "28" Science & Technology |

**Auto-detection:** Videos ≤3 min → YouTube Shorts. Videos >3 min → Regular video.

### TikTok

> ⚠️ **Required consent fields**: Posts WILL FAIL without `content_preview_confirmed: true` and `express_consent_given: true`.

TikTok settings use a nested structure: `platformSpecificData.tiktokSettings` (or root-level `tiktokSettings` shorthand):

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `privacy_level` | string | **Yes** | Must match account's allowed values |
| `allow_comment` | boolean | **Yes** | Allow comments |
| `allow_duet` | boolean | Videos | Allow duets |
| `allow_stitch` | boolean | Videos | Allow stitches |
| `content_preview_confirmed` | boolean | **Yes** | Must be `true` |
| `express_consent_given` | boolean | **Yes** | Must be `true` |
| `draft` | boolean | No | Send to Creator Inbox |
| `video_cover_timestamp_ms` | integer | No | Thumbnail frame (default: 1000ms) |
| `video_made_with_ai` | boolean | No | AI disclosure |
| `media_type` | `"video"` \| `"photo"` | No | Override auto-detection |

**Example:**
```json
{
  "platforms": [{
    "platform": "tiktok",
    "accountId": "tiktok_123",
    "platformSpecificData": {
      "tiktokSettings": {
        "privacy_level": "PUBLIC_TO_EVERYONE",
        "allow_comment": true,
        "allow_duet": true,
        "allow_stitch": true,
        "content_preview_confirmed": true,
        "express_consent_given": true
      }
    }
  }]
}
```

### LinkedIn

| Property | Type | Description |
|----------|------|-------------|
| `organizationUrn` | string | Target org: `urn:li:organization:123456789` |
| `firstComment` | string | Auto-post first comment |
| `disableLinkPreview` | boolean | Disable URL previews |

### Facebook

| Property | Type | Description |
|----------|------|-------------|
| `contentType` | `"story"` | Publish as Facebook Story (24h ephemeral) |
| `firstComment` | string | Auto-post first comment |
| `pageId` | string | Target Page ID for multi-page posting |

### Pinterest

| Property | Type | Description |
|----------|------|-------------|
| `title` | string | Pin title (max 100 chars) |
| `boardId` | string | Target board ID (**required**) |
| `link` | string | Destination URL |

---

## Platform Media Requirements

| Platform | Media Required? | Max Items | Video Max | Formats | Notes |
|----------|----------------|-----------|-----------|---------|-------|
| **TikTok** | **Yes** | 1 video or 35 photos | 4GB, 10 min | MP4, MOV, WebM | Cannot mix photos/videos |
| **YouTube** | **Yes** | 1 video | 256GB, 12h | MP4, MOV, AVI, WMV, FLV | ≤3min = Shorts, >3min = Regular |
| **Instagram** | **Yes** | 10 (carousel) | Feed: 300MB, Story: 100MB | See platform docs | 9:16 images → use Story |
| **Twitter/X** | No | 4 images or 1 video | - | - | Text-only OK |
| **LinkedIn** | No | 20 images or 1 video | - | + PDF (100MB) | Text-only OK |
| **Facebook** | No (Stories: Yes) | 10 images | - | - | Cannot mix photos/videos |
| **Bluesky** | No | 4 images | - | - | Images >1MB auto-recompressed |
| **Snapchat** | **Yes** | 1 | 500MB, 5-60s | MP4 (9:16) | Stories, Saved Stories, Spotlight |
| **Pinterest** | **Yes** | 1 image or 1 video | - | - | boardId required |
| **Threads** | No | 10 images (carousel) | - | - | No videos in carousels |

### TikTok Video Specs

| Property | Requirement | Recommended |
|----------|-------------|-------------|
| Resolution | 720×1280 min | 1080×1920 |
| Aspect Ratio | 9:16 | 9:16 |
| Duration | 3s – 10min | - |
| Frame Rate | 24-60 fps | 30 fps |
| Codec | H.264 | H.264 |
| File Size | ≤4GB | - |

### YouTube Video Specs

| Property | Shorts (≤3 min) | Regular (>3 min) |
|----------|-----------------|-------------------|
| Max Duration | 3 minutes | 12 hours |
| Max File Size | 256 GB | 256 GB |
| Aspect Ratio | 9:16 | 16:9 |
| Resolution | 1080×1920 | 1920×1080 (1080p) / 3840×2160 (4K) |
| Custom Thumbnail | ❌ Not via API | ✅ JPEG/PNG/GIF, 1280×720, ≤2MB |

---

## Rate Limiting

- Status `429` returned when rate limited
- `Retry-After` header indicates wait time in seconds
- Recommended: retry with backoff, max 3 retries

---

## Complete Post Example (Multi-Platform with Media)

```json
{
  "content": "Excited to announce our new product! 🎉",
  "mediaItems": [
    { "url": "https://media.getlate.dev/temp/123_product.mp4", "type": "video" }
  ],
  "platforms": [
    {
      "platform": "youtube",
      "accountId": "yt_123",
      "platformSpecificData": {
        "title": "New Product Announcement",
        "visibility": "public",
        "categoryId": "28",
        "firstComment": "Thanks for watching! 🔔"
      }
    },
    {
      "platform": "tiktok",
      "accountId": "tt_456",
      "platformSpecificData": {
        "tiktokSettings": {
          "privacy_level": "PUBLIC_TO_EVERYONE",
          "allow_comment": true,
          "allow_duet": true,
          "allow_stitch": true,
          "content_preview_confirmed": true,
          "express_consent_given": true
        }
      }
    },
    {
      "platform": "instagram",
      "accountId": "ig_789",
      "platformSpecificData": {
        "firstComment": "Link in bio! 🔗"
      }
    },
    {
      "platform": "linkedin",
      "accountId": "li_012",
      "platformSpecificData": {
        "firstComment": "What do you think? 👇"
      }
    },
    {
      "platform": "twitter",
      "accountId": "tw_345"
    }
  ],
  "scheduledFor": "2024-11-01T10:00:00Z",
  "timezone": "America/New_York"
}
```

---

## ⚠️ Known Code Mismatches (vidpipe)

These issues were identified by comparing our `lateApi.ts` against the official docs:

### 1. `mediaUrls` → `mediaItems` (CRITICAL)

Our code sends `mediaUrls: string[]` but the API expects `mediaItems: Array<{type, url}>`.

**Wrong (our code):**
```json
{ "mediaUrls": ["https://media.getlate.dev/temp/..."] }
```

**Correct (API):**
```json
{ "mediaItems": [{ "type": "video", "url": "https://media.getlate.dev/temp/..." }] }
```

### 2. Missing TikTok Required Fields

TikTok posts require `tiktokSettings` with consent fields. Without them, posts fail with validation errors.

### 3. YouTube Missing `title` in platformSpecificData

YouTube uses `platformSpecificData.title` for the video title. Without it, falls back to first line of `content` or "Untitled Video".

### 4. Queue Scheduling

Late has a built-in queue system (`queuedFromProfile`). Using `scheduledFor` with manually calculated slots bypasses queue locking and can cause duplicates.

---

## API Reference Links

- [Overview](https://docs.getlate.dev)
- [Authentication](https://docs.getlate.dev/authentication)
- [Quickstart](https://docs.getlate.dev/quickstart)
- [Posts](https://docs.getlate.dev/core/posts)
- [Accounts](https://docs.getlate.dev/core/accounts)
- [Platform Settings](https://docs.getlate.dev/core/platform-settings)
- [Media Upload](https://docs.getlate.dev/utilities/media)
- [Platforms Overview](https://docs.getlate.dev/platforms)
- [TikTok Guide](https://docs.getlate.dev/platforms/tiktok)
- [YouTube Guide](https://docs.getlate.dev/platforms/youtube)
- [Instagram Guide](https://docs.getlate.dev/platforms/instagram)
- [OpenAPI Spec](https://docs.getlate.dev/openapi)
- [LLMs.txt](https://docs.getlate.dev/llms.txt)
# Grouped Approval UI Design

## Overview

The grouped approval UI consolidates posts for the same video/clip into a single card with platform checkboxes, allowing users to approve multiple platforms at once.

## UI Layout

```
┌──────────────────────────────────────────────────────┐
│  vidpipe    Review Queue                             │
│  ← Reject  → Approve  E Edit  Space Skip            │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  ⚡ Short                                      │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐ │  │
│  │  │                                          │ │  │
│  │  │         Video Preview (16:9)             │ │  │
│  │  │                                          │ │  │
│  │  └──────────────────────────────────────────┘ │  │
│  │                                                │  │
│  │  Select platforms to publish:                  │  │
│  │                                                │  │
│  │  ☑ 🎵 TikTok      ☑ ▶️ YouTube               │  │
│  │  ☑ 📸 Instagram   ☐ 💼 LinkedIn (⚠ no acct)  │  │
│  │  ☑ 🐦 X/Twitter                              │  │
│  │                                                │  │
│  │  3 of 5 selected                               │  │
│  │                                                │  │
│  │  Post preview:                                 │  │
│  │  Check out this quick tip about...            │  │
│  │                                                │  │
│  │  📹 /recordings/my-video-2024-01-15            │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐ │  │
│  │  │ ❌ Reject All  ⏭️ Skip  ✅ Approve (3)   │  │
│  │  └──────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
├──────────────────────────────────────────────────────┤
│  Group 1 of 3              ✅ 0  ❌ 0  ⏭️ 0         │
└──────────────────────────────────────────────────────┘
```

## Key UI Elements

### 1. Video Preview
- Shared across all platforms in the group
- Displays the first available media file (typically the captioned landscape variant)
- Shows "Text Only" badge for posts without media

### 2. Platform Checkboxes
- One checkbox per platform in the group
- Pre-selected for connected accounts (detected via Late API)
- Disabled with ⚠️ warning for platforms without connected accounts
- Visual feedback: selected boxes have colored border matching platform theme

### 3. Selection Counter
- "3 of 5 selected" - shows how many platforms are currently selected
- Updates in real-time as checkboxes are toggled

### 4. Post Preview
- Truncated view of post content (first 300 characters)
- Same content used across all platforms in the group

### 5. Action Buttons
- **Reject All**: Removes all posts in the group (all platforms)
- **Skip**: Moves to next group without taking action
- **Approve (N)**: Publishes to N selected platforms
  - Button shows count of selected platforms
  - Disabled (grayed out) when no platforms are selected

## Interaction Flow

### 1. Initial Load
```
User opens review UI
  ↓
Fetch grouped posts from /api/init
  ↓
Groups displayed one at a time
  ↓
First group shown with auto-selected platforms
```

### 2. Platform Selection
```
User sees checkboxes
  ↓
Connected accounts are pre-checked
  ↓
User clicks checkbox to toggle selection
  ↓
Selection counter updates immediately
  ↓
Approve button shows "(N)" with current count
```

### 3. Approval
```
User clicks "Approve (3)"
  ↓
POST /api/posts/bulk-approve with [id1, id2, id3]
  ↓
Backend schedules each platform:
  - Find next available slot
  - Upload media (once, shared URL)
  - Create scheduled post in Late API
  ↓
Move all approved posts to published/
  ↓
Show success toast: "Approved 3 post(s)!"
  ↓
Card animates out, next group appears
```

### 4. Rejection
```
User clicks "Reject All"
  ↓
POST /api/posts/bulk-reject with all item IDs
  ↓
Backend deletes all post folders
  ↓
Show toast: "Group rejected"
  ↓
Card animates out, next group appears
```

## Grouping Logic

Posts are grouped by:
```javascript
groupKey = `${sourceVideo}::${sourceClip ?? 'video'}`
```

**Examples:**
- `/videos/demo::null` → Full video posts (all platforms for the main video)
- `/videos/demo::/clips/short-1` → Short clip posts (all platforms for short #1)
- `/videos/demo::/clips/medium-1` → Medium clip posts (all platforms for medium clip #1)

Each group contains:
- `groupKey`: Unique identifier
- `sourceVideo`: Path to video directory
- `sourceClip`: Path to clip directory (or null)
- `clipType`: 'video', 'short', or 'medium-clip'
- `hasMedia`: Boolean (true if video files exist)
- `items[]`: Array of QueueItems (one per platform)

## Keyboard Shortcuts

- `→` (Right Arrow): Approve selected platforms
- `←` (Left Arrow): Reject all posts in group
- `Space`: Skip to next group

## Visual States

### Default State
- Checkboxes: Platform icon + name + auto-checked for connected accounts
- Approve button: Green with count badge "(3)"

### No Selection
- Approve button: Grayed out, disabled
- Text: "Approve" (no count)

### Platform Warning
- Checkbox: Disabled
- Badge: "⚠" next to platform name
- Tooltip: "No account connected"

### Loading
- Skeleton card with pulsing placeholders
- Shown while fetching groups from API

### Empty Queue
- 🎬 icon
- "No posts pending review"
- "Run your pipeline first!"

### All Complete
- 🎉 icon
- "All caught up!"
- Stats: "✅ 5 approved, ❌ 0 rejected, ⏭️ 0 skipped"
- "Refresh Queue" button

## Backend Changes

### New Endpoints

**GET /api/posts/grouped**
- Returns: `{ groups: GroupedQueueItem[], total: number }`
- Groups posts by sourceVideo + sourceClip

**GET /api/init** (updated)
- Now returns `groups` instead of `items`
- Still returns `accounts` and `profile`

**POST /api/posts/bulk-approve**
- Body: `{ itemIds: string[] }`
- For each item: schedule → upload media → create Late post
- Returns: `{ success: true, results: BulkApprovalResult[], count: number }`

**POST /api/posts/bulk-reject**
- Body: `{ itemIds: string[] }`
- Deletes all specified post folders
- Returns: `{ success: true, results: [], count: number }`

## Migration Notes

### Backward Compatibility
- ✅ Existing queue data works without changes
- ✅ All metadata fields preserved
- ✅ Original single-post UI saved as `index-single.html`
- ✅ No breaking changes to pipeline or data structures

### Data Structure
No changes to `QueueItemMetadata` — existing fields used for grouping:
- `sourceVideo`: Already tracked
- `sourceClip`: Already tracked
- `clipType`: Already tracked

New interface `GroupedQueueItem` is a view/aggregation layer, not persisted storage.

## Testing

### Integration Tests
- ✅ Grouping logic validates correct grouping by source
- ✅ Bulk approve schedules all selected platforms
- ✅ Bulk reject removes all posts in group
- ✅ Connected account detection works correctly
- ✅ Empty item IDs array returns 400 error

### Manual Testing Checklist
- [ ] Video preview loads for first item in group
- [ ] Platform checkboxes render for all platforms
- [ ] Connected accounts are pre-selected
- [ ] Unconnected platforms show warning badge
- [ ] Selection counter updates on toggle
- [ ] Approve button shows correct count
- [ ] Approve button is disabled when nothing selected
- [ ] Bulk approve publishes to all selected platforms
- [ ] Bulk reject removes all posts
- [ ] Skip advances to next group
- [ ] Keyboard shortcuts work correctly
- [ ] Empty state shows when no groups
- [ ] Summary state shows after completing all groups

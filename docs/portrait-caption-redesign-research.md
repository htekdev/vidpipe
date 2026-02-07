# Portrait Mode & Caption Redesign Research

## Current Issues (from user screenshot)

1. **Face visible twice**: Top section shows full 16:9 frame (including webcam corner) → face appears in both top and bottom sections
2. **Top section not cropped properly**: Should show only the screen content, excluding the webcam bounding box area
3. **Captions at bottom**: Should be centered in the middle of the portrait frame (between screen and webcam)
4. **Caption style is basic**: Needs Opus Clips-style green highlight, font size animation, and more engaging visual treatment
5. **No hook text overlay**: Missing the opening hook text with rounded background

## Research Findings

### Opus Clips Caption Style
- **Font**: Sans-serif bold (Mont Bold, Roboto Bold) — we use Montserrat Bold ✓
- **Active word color**: Green highlight (`#00FF00` / ASS BGR `&H0000FF00&`)
- **Font size**: 18-24pt for mobile (our 1080px wide portrait = ~54-60pt effective)
- **Animation**: Active word scales up 10-20% over 100-150ms, then returns to normal in 50ms
- **Multi-line**: Max 30-35 chars per line, 2 lines max, centered horizontally
- **Positioning**: Lower-middle area in portrait mode, NOT at the very bottom
- **Background**: Semi-transparent black plate (70% opacity) behind caption text

### ASS Animation Tags for Pop Effect
```ass
# Scale active word up 120% over 100ms, then back to 100% in 50ms
{\fscx100\fscy100\t(0,100,\fscx120\fscy120)\t(100,150,\fscx100\fscy100)}ActiveWord
```

Key tags:
- `\fscx` / `\fscy` — X/Y scale factor (100 = normal)
- `\t(start,end,tags)` — Transform/animate tags over time range (ms)
- `\c&H0000FF00&` — Green color (BGR format for green = `00FF00`)
- `\3c&H00000000&` — Black outline color
- `\bord3` — Border/outline width
- `\fad(50,50)` — Fade in/out 50ms

### Split-Screen Layout Fix

**Current (broken)**:
```
┌─────────────────┐
│  Full 16:9 frame │ ← Face visible here too!
│  (scaled down)   │
├─────────────────┤
│   Webcam crop    │ ← Face here (correct)
└─────────────────┘
```

**Proposed (fixed)**:
```
┌─────────────────┐
│  Screen content  │ ← Crop LEFT of webcam bounding box
│  (no webcam)     │
├─────────────────┤
│  Caption zone    │ ← Centered, Opus Clips style
├─────────────────┤
│   Face zoom      │ ← Tight crop around face, zoomed in
└─────────────────┘
```

**Implementation**:
1. Detect webcam bounding box (we already do this)
2. **Screen crop**: Crop the screen area EXCLUDING the webcam region — crop from left edge to just before the webcam's x position
3. **Face crop**: Zoom into the webcam bounding box more tightly (center on face, add small padding)
4. **Caption zone**: Leave a band in the middle for captions (or overlay on the junction)

### Hook Text Overlay
- Show main hook/title at the top of the video for first 3-5 seconds
- Rounded pill/badge background (colored, e.g., brand color or green)
- White bold text inside
- Implementation: ASS drawing commands with `\p1` for vector shapes, or overlay a pre-rendered PNG
- Simpler approach: Use ASS `\bord0\shad0` with `BackColour` set to green with rounded `\be` (blur edge)

### Recommended Approach

**For portrait generation (no captions first)**:
1. Extract clip (uncaptioned)
2. Generate portrait split-screen layout (screen + face zoom)
3. Generate ASS captions targeting portrait resolution (1080x1920)
4. Burn captions onto portrait video

**New ASS caption style targeting portrait (1080x1920)**:
- PlayResX: 1080, PlayResY: 1920
- Alignment: 5 (middle-center) — places text in vertical center
- MarginV: ~200 (adjust to position between screen and face)
- Active word: green (`\c&H0000FF00&`), scaled 120% with `\t` animation
- Inactive words: white, normal size
- Font size: ~50pt active, ~40pt base (tuned for 1080px width)
- Outline: 3px black, shadow: 1px
- Background: Semi-transparent black box via BackColour

**Hook text**:
- Separate ASS style "Hook" with larger font, Alignment=8 (top-center)
- Green/brand-colored BackColour with BorderStyle=3 (opaque box)
- Display for first 3-5 seconds with fade in/out

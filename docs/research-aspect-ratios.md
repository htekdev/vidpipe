# Research: Platform-Specific Aspect Ratios & Split-Screen Layouts

> **✅ Implementation Status**
>
> Major features from this research are now **implemented**. The system uses a pure-Node.js approach
> (sharp + FFmpeg) rather than the OpenCV approach originally proposed.
>
> | Recommendation | Status | Location |
> |---|---|---|
> | Platform dimension presets (9:16, 1:1, 4:5, 16:9) | ✅ Implemented | `src/tools/ffmpeg/aspectRatio.ts` — `DIMENSIONS`, `PLATFORM_RATIOS` |
> | Center-crop fallback (16:9 → 9:16, 1:1, 4:5) | ✅ Implemented | `convertAspectRatio()` with `buildCropFilter()` |
> | Split-screen layout (65% screen / 35% webcam) | ✅ Implemented | `convertToPortraitSmart()` — 1248px screen / 672px webcam |
> | Webcam detection | ✅ Implemented (different approach) | `src/tools/ffmpeg/faceDetection.ts` — skin-tone analysis via `sharp`, not OpenCV |
> | Edge-based bounding box refinement | ✅ Implemented | `refineBoundingBox()` — inter-column/row intensity differences |
> | AR-matched webcam crop (no black bars) | ✅ Implemented | `convertWithSmartLayout()` — webcam cropped to match target section AR |
> | Multiple output presets per clip | ✅ Implemented | `generatePlatformVariants()` — deduplicates by aspect ratio |
> | Smart square (1:1) layout | ✅ Implemented | `convertToSquareSmart()` — 700px screen / 380px webcam |
> | Smart feed (4:5) layout | ✅ Implemented | `convertToFeedSmart()` — 878px screen / 472px webcam |
> | Scale + Pad (letterbox) | ✅ Implemented | `convertAspectRatio()` with `letterbox: true` option |
> | Mouse/activity tracking | ❌ Not implemented | Research Phase 2 — not yet needed |
> | MediaPipe/AI person detection | ❌ Not implemented | Research Phase 3 — skin-tone + edge approach sufficient |
> | Scene change detection | ❌ Not implemented | Research Phase 2 |
>
> **Key differences from research:**
> - **No OpenCV dependency** — webcam detection uses `sharp` for pixel-level skin-tone analysis
>   and variance scoring across sampled frames, rather than Haar Cascades
> - **Edge-based refinement** — `refineBoundingBox()` averages inter-pixel intensity gradients
>   across multiple frames to find the persistent overlay boundary (content edges cancel out)
> - **Confidence scoring** — `calculateCornerConfidence()` combines consistency (fraction of
>   frames detecting skin) with average score, requiring ≥30% confidence
> - **Smart layout for all ratios** — research only detailed 9:16; implementation extends
>   the same `convertWithSmartLayout()` pattern to 1:1 and 4:5

> **Last updated:** 2025-10  
> **Purpose:** Inform the video-auto-note-taker pipeline on how to reformat landscape screen recordings into platform-optimized short-form video.

---

## 1. Platform Dimension Requirements

| Platform | Content Type | Aspect Ratio | Resolution (px) | Max Duration | Notes |
|---|---|---|---|---|---|
| **TikTok** | Standard | 9:16 | 1080×1920 | 10 min | Portrait-first; 9:16 is strongly preferred |
| **YouTube Shorts** | Shorts | 9:16 | 1080×1920 | 60 sec | Must be ≤60s and 9:16 to qualify as Short |
| **YouTube** | Long-form | 16:9 | 1920×1080 | 12 hr | Standard HD landscape |
| **Instagram Reels** | Reels | 9:16 | 1080×1920 | 90 sec | 9:16 required for full-screen Reels |
| **Instagram** | Feed Video | 1:1 or 4:5 | 1080×1080 / 1080×1350 | 60 sec | 4:5 gets more screen real estate in feed |
| **Instagram** | Stories | 9:16 | 1080×1920 | 15 sec | Full-screen vertical |
| **LinkedIn** | Feed Video | 16:9 or 1:1 | 1920×1080 / 1080×1080 | 10 min | Square performs well; vertical (9:16) also supported |
| **Twitter/X** | Feed Video | 16:9 or 1:1 | 1920×1080 / 1080×1080 | 2 min 20 sec | 16:9 landscape or 1:1 square |
| **Facebook** | Feed Video | 16:9 or 1:1 or 4:5 | 1280×720 / 1080×1080 | 240 min | 4:5 vertical recommended for mobile |
| **Facebook** | Stories/Reels | 9:16 | 1080×1920 | 60 sec (Reels) | Full-screen vertical |

### Key Takeaway
The **primary target** for short-form is **1080×1920 (9:16)** — it covers TikTok, YouTube Shorts, Instagram Reels, and Stories. Secondary targets are **1080×1080 (1:1)** for LinkedIn/Twitter feed and **1920×1080 (16:9)** for YouTube long-form.

### Output Presets for Our Pipeline

```python
OUTPUT_PRESETS = {
    "shorts_portrait": {"width": 1080, "height": 1920, "aspect": "9:16"},
    "square":          {"width": 1080, "height": 1080, "aspect": "1:1"},
    "landscape":       {"width": 1920, "height": 1080, "aspect": "16:9"},
    "feed_portrait":   {"width": 1080, "height": 1350, "aspect": "4:5"},
}
```

---

## 2. Split-Screen Layout for Screen Recordings

### How the Industry Does It

Tools like **OpusClip**, **Descript**, **Riverside**, and **Vidyo.ai** handle the landscape-to-portrait conversion using these common layout patterns:

#### Layout A: Speaker-Focused (Full Reframe)
- Detects the speaker's face and crops/zooms the 16:9 frame into a 9:16 portrait centered on the speaker.
- Best for: talking-head videos, podcasts, interviews.
- OpusClip calls this "Subject Tracking" — AI follows the active speaker.

#### Layout B: Split-Screen (Screen + Webcam)
- **Top portion:** Screen share / slides / demo content (cropped/zoomed to fit width).
- **Bottom portion:** Speaker webcam footage.
- Typical split ratios:
  - **65% screen / 35% webcam** — most common default
  - **70% screen / 30% webcam** — prioritizes content visibility
  - **50% / 50%** — equal emphasis, used for reaction/commentary
  - **60% / 40%** — balanced compromise
- Best for: tutorials, coding demos, presentations with screen share.

#### Layout C: Picture-in-Picture
- Full-frame screen content with a small circular/rectangular webcam overlay in a corner.
- Webcam overlay typically 15-25% of frame width.
- Best for: when screen content is primary and speaker is secondary.

#### Layout D: Side-by-Side
- Left/right split in landscape (16:9) — not typically used for portrait output.

### Recommended Default for Our Pipeline

For screen recordings with webcam (our primary use case):

```
┌─────────────────────┐
│                     │
│   SCREEN CONTENT    │  ← 65% of height (1248px)
│   (cropped/zoomed)  │
│                     │
├─────────────────────┤
│                     │
│   WEBCAM / SPEAKER  │  ← 35% of height (672px)
│                     │
└─────────────────────┘
     1080 × 1920
```

**Dimensions for 9:16 (1080×1920):**
| Split Ratio | Screen Height | Webcam Height |
|---|---|---|
| 70/30 | 1344 px | 576 px |
| 65/35 | 1248 px | 672 px |
| 60/40 | 1152 px | 768 px |
| 50/50 | 960 px | 960 px |

---

## 3. Webcam Detection in Screen Recordings

### The Problem
Screen recording tools (OBS, Bandicam, Camtasia, Loom) typically embed a webcam overlay directly into the screen recording — it's baked into the single video stream. We need to detect whether a webcam overlay exists and where it is.

### Common Webcam Overlay Positions
| Tool | Default Position | Typical Size |
|---|---|---|
| OBS Studio | Bottom-right (configurable) | ~320×180 to ~480×270 |
| Bandicam | Bottom-right corner | ~320×240 |
| Loom | Bottom-left (circular) | ~200px diameter |
| Camtasia | Bottom-right | ~320×240 |
| Zoom Recording | Gallery/side panel or PiP | Varies |

### Detection Approaches

#### Approach 1: OpenCV Face Detection (Recommended for MVP)
```python
import cv2

def detect_webcam_region(frame):
    """
    Sample frames and look for faces in corner regions.
    If faces are consistently found in the same corner, that's the webcam.
    """
    face_cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    )
    h, w = frame.shape[:2]
    
    # Check each corner quadrant (bottom-right, bottom-left, top-right, top-left)
    corners = {
        "bottom_right": frame[int(h*0.65):, int(w*0.65):],
        "bottom_left":  frame[int(h*0.65):, :int(w*0.35)],
        "top_right":    frame[:int(h*0.35), int(w*0.65):],
        "top_left":     frame[:int(h*0.35), :int(w*0.35)],
    }
    
    for name, region in corners.items():
        gray = cv2.cvtColor(region, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.1, 5, minSize=(30, 30))
        if len(faces) > 0:
            return name
    return None
```

**Strategy:**
1. Sample 5-10 frames evenly spaced through the video.
2. For each frame, check corner regions for face detection.
3. If ≥60% of sampled frames detect a face in the same corner → webcam is there.
4. Refine the exact bounding box of the webcam overlay by analyzing edge contrast / color changes.

#### Approach 2: Edge/Contrast Detection
- Webcam overlays often have a visible border or distinct color boundary.
- Use Canny edge detection on corner regions to find rectangular boundaries.
- Works even when face is temporarily off-camera.

#### Approach 3: Motion Analysis
- Screen content and webcam content have different motion patterns.
- Webcam has continuous organic motion (person moving, blinking).
- Screen content has discrete changes (mouse clicks, page scrolls).
- Use optical flow analysis to differentiate regions.

#### Approach 4: AI/ML (Higher Complexity)
- Train or use a pre-trained object detection model (YOLO, MediaPipe) to detect person regions.
- MediaPipe Pose/Face detection is lightweight and runs in real-time.
- Most accurate but adds ML dependency.

### Recommended Approach
**Start with Approach 1 (OpenCV Haar Cascades)** for MVP — it's simple, fast, has no ML model dependencies, and handles the common case (face in corner). Fall back to Approach 2 for videos without visible faces. Consider MediaPipe for v2.

---

## 4. FFmpeg Implementation

### 4.1 Basic: Crop Landscape to Portrait (Center Crop)

Crop the center of a 1920×1080 video to 9:16:
```bash
# Calculate crop width: 1080 * (9/16) = 607.5 → 608
ffmpeg -i input.mp4 -vf "crop=608:1080:(1920-608)/2:0,scale=1080:1920" output_portrait.mp4
```

Generic formula:
```bash
# crop=<height*(9/16)>:<height>:<(width - crop_width)/2>:0, then scale up
ffmpeg -i input.mp4 -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920" output.mp4
```

### 4.2 Split-Screen: Screen on Top, Webcam on Bottom

Given a source landscape video, create a 9:16 portrait with screen content on top (65%) and webcam on bottom (35%):

```bash
ffmpeg -i input.mp4 -filter_complex "
  [0:v]crop=ih*16/9:ih:0:0,scale=1080:1248[screen];
  [0:v]crop=480:270:iw-490:ih-280,scale=1080:672[webcam];
  [screen][webcam]vstack=inputs=2[out]
" -map "[out]" -map 0:a -c:v libx264 -preset medium -crf 23 -c:a aac output_split.mp4
```

**Explanation:**
- `[0:v]crop=...,scale=1080:1248[screen]` — Crop the screen content area (excluding webcam), scale to full width × 65% height.
- `[0:v]crop=480:270:iw-490:ih-280,scale=1080:672[webcam]` — Crop the webcam region (bottom-right corner), scale to full width × 35% height.
- `vstack=inputs=2` — Stack screen on top of webcam vertically.

### 4.3 Dynamic Crop Coordinates (Python + FFmpeg)

```python
import subprocess

def create_split_screen(input_path, output_path, webcam_region, split_ratio=0.65):
    """
    webcam_region: dict with x, y, w, h of detected webcam overlay
    split_ratio: portion of output height for screen content
    """
    screen_h = int(1920 * split_ratio)
    webcam_h = 1920 - screen_h
    
    wx, wy, ww, wh = webcam_region['x'], webcam_region['y'], webcam_region['w'], webcam_region['h']
    
    filter_complex = (
        f"[0:v]crop=iw:ih-{wh}:0:0,scale=1080:{screen_h}[screen];"
        f"[0:v]crop={ww}:{wh}:{wx}:{wy},scale=1080:{webcam_h}[webcam];"
        f"[screen][webcam]vstack=inputs=2[out]"
    )
    
    cmd = [
        "ffmpeg", "-i", input_path,
        "-filter_complex", filter_complex,
        "-map", "[out]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-c:a", "aac", "-y", output_path
    ]
    subprocess.run(cmd, check=True)
```

### 4.4 Scale + Pad (Letterbox/Pillarbox)

When you can't crop (e.g., all content is important), pad with black bars:

```bash
# Fit 16:9 into 9:16 with black bars (pillarbox + letterbox)
ffmpeg -i input.mp4 -vf "scale=1080:608,pad=1080:1920:0:(1920-608)/2:black" output_padded.mp4

# Fit 16:9 into 1:1 square with letterbox
ffmpeg -i input.mp4 -vf "scale=1080:608,pad=1080:1080:0:(1080-608)/2:black" output_square.mp4
```

### 4.5 Auto-Detect Black Borders with cropdetect

```bash
# Analyze video for black borders (useful for pre-processing)
ffmpeg -i input.mp4 -vf cropdetect -f null - 2>&1 | grep "crop="

# Typical output: crop=1920:816:0:132  (meaning 132px black bars top/bottom)
```

### 4.6 Overlay Filter (Picture-in-Picture)

```bash
# Place webcam.mp4 as PiP in bottom-right of screen.mp4
ffmpeg -i screen.mp4 -i webcam.mp4 -filter_complex "
  [1:v]scale=270:-1[pip];
  [0:v][pip]overlay=main_w-overlay_w-20:main_h-overlay_h-20[out]
" -map "[out]" -map 0:a output_pip.mp4
```

### 4.7 Smart Zoom Into Screen Region

Crop a specific area of the screen recording (e.g., code editor, browser):

```bash
# Zoom into center-left of a 1920x1080 screen recording
# Crop a 960x1080 region from the left side, then scale to portrait
ffmpeg -i input.mp4 -vf "crop=960:1080:0:0,scale=1080:1920" output_zoomed.mp4
```

---

## 5. Smart Cropping Approaches

### The Challenge
When converting a 1920×1080 screen recording to 1080×1920 portrait, we lose ~66% of the horizontal content. We need to intelligently choose *which* part to show.

### Approach A: Heuristic / Rule-Based (Recommended for MVP)

1. **Center crop** — Default fallback. Crop the center 9:16 column from the 16:9 frame.
2. **Mouse tracking** — Follow the mouse cursor position to determine the "active" area. Can extract cursor position from screen recording tools or use image processing.
3. **Fixed regions** — For known layouts (e.g., VS Code), pre-define interesting regions:
   - Code editor: left 60% of screen
   - Browser: center of screen
   - Terminal: bottom 40% of screen
4. **Activity detection** — Compare consecutive frames, find the region with the most pixel changes (where the user is actively working).

### Approach B: AI-Based (Higher Quality, Higher Complexity)

1. **Saliency detection** — Neural networks that predict which parts of a frame attract human attention.
   - Models: DeepGaze, SAM (Saliency Attention Model)
   - Output: heatmap of "interestingness" per pixel
2. **OCR-based** — Use text detection to find areas with the most text/code content. Keep those regions in frame.
3. **Object detection** — Detect UI elements (buttons, dialogs, code editors) and prioritize them.

### Tools That Do Smart Cropping

| Tool | Approach | Key Feature |
|---|---|---|
| **OpusClip** | AI reframing + subject tracking | Auto-detects speakers, follows active speaker |
| **Vidyo.ai** | AI scene detection + cropping | Identifies key moments, auto-crops |
| **Munch** | AI content analysis | Finds "snackable" clips with auto-framing |
| **Descript** | Template-based + AI | Multi-cam templates, drag-and-drop layout |
| **Filmora** | Smart Crop with AI | Uses AI to keep subject in frame, multiple aspect ratio presets |
| **Kapwing** | Smart resize | AI-powered auto-reframe for multiple platforms |

### Recommended Pipeline for Smart Cropping

```
1. Detect webcam overlay region (OpenCV face detection in corners)
2. If webcam detected:
   a. Extract webcam region → scale for bottom panel
   b. Remove webcam region from screen content
   c. Smart-crop screen content for top panel
   d. Stack vertically (vstack)
3. If no webcam:
   a. Center-crop the most active region
   b. Scale to 9:16
4. Apply captions overlay (for accessibility + engagement)
```

---

## 6. Implementation Plan for Our Pipeline

### Phase 1: MVP (Low Complexity)
- **Input:** 16:9 landscape screen recording (with or without webcam overlay)
- **Detection:** OpenCV Haar Cascade face detection in corner regions
- **Layout:** If webcam → split-screen (65/35); if no webcam → center crop
- **Output:** 9:16 portrait at 1080×1920
- **FFmpeg:** Python subprocess calling FFmpeg with computed filter chains
- **Effort:** ~2-3 days

### Phase 2: Smart Cropping (Medium Complexity)
- **Mouse/activity tracking** to determine optimal crop region per scene
- **Scene change detection** to adjust crop position at natural breakpoints
- **Multiple output presets** (9:16, 1:1, 4:5) in single pipeline run
- **Effort:** ~1-2 weeks

### Phase 3: AI-Enhanced (High Complexity)
- **MediaPipe** for robust person detection (replaces Haar Cascades)
- **Saliency detection** for intelligent region selection
- **Auto-captioning** integration (whisper → burnt-in captions)
- **Effort:** ~2-4 weeks

### Complexity Assessment

| Feature | Complexity | Dependencies | Priority |
|---|---|---|---|
| Center crop 16:9 → 9:16 | 🟢 Low | FFmpeg | P0 |
| Webcam detection (Haar) | 🟢 Low | OpenCV | P0 |
| Split-screen layout | 🟡 Medium | FFmpeg filter_complex | P0 |
| Multiple output presets | 🟢 Low | Config only | P1 |
| Activity-based crop | 🟡 Medium | OpenCV frame diff | P1 |
| Scene change detection | 🟡 Medium | FFmpeg scene filter | P1 |
| MediaPipe person detection | 🟡 Medium | mediapipe package | P2 |
| AI saliency cropping | 🔴 High | ML model + GPU | P2 |
| Auto-caption burn-in | 🟡 Medium | Whisper + FFmpeg drawtext | P1 |

---

## 7. Reference: Key FFmpeg Filters

| Filter | Purpose | Example |
|---|---|---|
| `crop` | Extract rectangular region | `crop=1080:1920:420:0` |
| `scale` | Resize video | `scale=1080:1920` or `scale=1080:-1` (preserve ratio) |
| `pad` | Add borders/padding | `pad=1080:1920:0:420:black` |
| `overlay` | Composite one video on another | `overlay=main_w-overlay_w:main_h-overlay_h` |
| `vstack` | Stack videos vertically | `vstack=inputs=2` |
| `hstack` | Stack videos horizontally | `hstack=inputs=2` |
| `xstack` | Flexible grid layout | `xstack=inputs=4:layout=0_0\|w0_0\|0_h0\|w0_h0` |
| `cropdetect` | Auto-detect black borders | `cropdetect=24:16:0` |
| `drawtext` | Burn in text/captions | `drawtext=text='Hello':fontsize=48:x=(w-tw)/2:y=h-100` |
| `fps` | Change frame rate | `fps=30` |
| `setsar`/`setdar` | Set aspect ratio metadata | `setsar=1:1` |

---

## Sources

- [Kapwing - Social Media Video Aspect Ratios 2026](https://www.kapwing.com/resources/social-media-video-aspect-ratios-and-sizes-the-2025-guide/)
- [SocialRails - Video Sizes Guide 2026](https://socialrails.com/blog/social-media-video-sizes-guide)
- [Sprout Social - Video Specs Guide](https://sproutsocial.com/insights/social-media-video-specs-guide/)
- [VGMoose - Crop 16:9 to 9:16 with FFmpeg](https://vgmoose.dev/blog/how-to-crop-landscape-169-videos-to-vertical-916-using-ffmpeg-for-youtube-shorts-or-tiktok-6898118583/)
- [Shotstack - FFmpeg Crop Videos](https://shotstack.io/learn/crop-resize-videos-ffmpeg/)
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html)
- [OpusClip - Adjust Layout](https://help.opus.pro/docs/article/apply-the-layouts)
- [Filmora - Smart Cropping Explained](https://filmora.wondershare.com/trending-tech/what-is-smart-cropping.html)
- [girishjoshi.io - Screen Recording with Webcam Overlay](https://girishjoshi.io/post/screen-recording-with-webcam-overlay-using-ffmpeg/)
- [ffmpeg-python GitHub](https://github.com/kkroening/ffmpeg-python)
- [GeeksforGeeks - Face Detection with OpenCV](https://www.geeksforgeeks.org/python/face-detection-using-python-and-opencv-with-webcam/)

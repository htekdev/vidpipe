# Premium Caption Styles Research

> **✅ Implementation Status**
>
> The recommendations in this document have been **implemented** in the caption generation pipeline.
>
> | Recommendation | Status | Location |
> |---|---|---|
> | Approach A (one Dialogue per word state) | ✅ Implemented | `src/tools/captions/captionGenerator.ts` — `buildPremiumDialogueLines()` |
> | Montserrat Bold font | ✅ Implemented | `assets/fonts/Montserrat-Bold.ttf`, ASS headers reference `Montserrat` |
> | Yellow active-word highlight (`&H00FFFF&`) | ✅ Implemented | `ACTIVE_COLOR` constant in `captionGenerator.ts` |
> | Font size pop on active word | ✅ Implemented | `ACTIVE_FONT_SIZE=54` / `BASE_FONT_SIZE=42` for shorts |
> | Silence gap grouping | ✅ Implemented | `SILENCE_GAP_THRESHOLD=0.8s` (research suggested 0.5s; tuned up for better results) |
> | Max 8 words per group | ✅ Implemented | `MAX_WORDS_PER_GROUP=8` |
> | 2-line layout split | ✅ Implemented | `splitGroupIntoLines()` splits at midpoint when > `WORDS_PER_LINE` (4) words |
> | Multiple caption styles | ✅ Extended | Three styles: `shorts` (large centered), `medium` (smaller bottom), `portrait` (Opus Clips green pop) |
> | Portrait green highlight + scale animation | ✅ Implemented | `PORTRAIT_ACTIVE_COLOR`, `\fscx130\fscy130\t(0,150,...)` in `buildPremiumDialogueLines()` |
> | Hook text overlay | ✅ Implemented | `generateHookOverlay()`, `generatePortraitASSWithHook()` |
>
> **Key differences from research:**
> - Silence gap threshold increased from 500ms to 800ms based on real-world tuning
> - Font sizes adjusted: 42/54pt for shorts (landscape 1920×1080), 66/78pt for portrait (1080×1920)
> - Added `medium` caption style (32/40pt) for longer clips beyond what was originally planned
> - Portrait style uses green (`&H00FF00&`) instead of yellow, plus `\fscx130\fscy130` scale pop animation

> Research findings for implementing viral-quality, word-highlighted captions in our video pipeline.
> Sources: OpusClip, Captions.ai, CapCut, Aegisub docs, Stack Overflow, Bannerbear, SendShort, Google Fonts.

---

## Table of Contents

1. [Multi-Line Captions](#1-multi-line-captions)
2. [Word-Only Highlight (Active Word Pop)](#2-word-only-highlight-active-word-pop)
3. [Words Appear Only During Speech](#3-words-appear-only-during-speech)
4. [Premium Fonts for Video Captions](#4-premium-fonts-for-video-captions)
5. [FFmpeg ASS Implementation](#5-ffmpeg-ass-implementation)
6. [Recommended Approach](#6-recommended-approach)
7. [Implementation Plan](#7-implementation-plan)

---

## 1. Multi-Line Captions

### How Platforms Display Captions

| Platform | Lines | Style | Behavior |
|---|---|---|---|
| **OpusClip** | 1–3 lines | Bold sans-serif, centered lower-third | Word-by-word highlight with color pop; entire phrase visible |
| **Captions.ai** | 1–2 lines | Large bold text, center screen | Active word scales up + color change ("Hormozi style") |
| **CapCut** | 1–3 lines | Customizable templates | Word highlight with glow/outline; supports karaoke mode |
| **TikTok native** | 1–2 lines | System font, bottom center | Simple word-by-word reveal |

### Multi-Line Layout Rules

- **2–3 lines is optimal** for short-form vertical video (9:16). More than 3 lines is too much to read.
- **5–8 words per line** is the sweet spot for readability on mobile.
- **Word wrapping** should break at natural phrase boundaries, not mid-word.
- Lines should be **center-aligned** and positioned in the **lower third** (roughly 70–80% down the screen).

### Word Wrapping with Word-Level Timestamps

When you have word-level timestamps from Whisper, group words into "caption groups" (phrases):

```
Algorithm:
1. Collect words until line reaches ~5-8 words OR a natural pause (>300ms gap)
2. Split into 2 lines if total words > 8 (split at midpoint)
3. Display the entire group for the duration of first_word.start → last_word.end
4. Within the group, highlight each word at its individual timestamp
```

**Example multi-line layout (vertical 1080×1920):**
```
Line 1: "In the tapestry"      (centered at y=1400)
Line 2: "of time"              (centered at y=1480)
```

Both lines appear simultaneously; only the currently-spoken word is highlighted.

---

## 2. Word-Only Highlight (Active Word Pop)

### The "Karaoke" Effect

This is the **key differentiator** of premium captions. Unlike progressive highlighting (where words change color left-to-right and stay changed), the **active word pop** effect means:

- **Only the currently spoken word** has a highlight color (e.g., yellow, green) and/or larger font size
- **All other words** remain in the default/dimmed style (e.g., white or light gray)
- When the next word begins, the **previous word reverts** to the default style
- This creates a "bouncing ball" / karaoke effect that guides the viewer's eye

### Visual Concept

```
Time 0.0s:  "In the tapestry of time"
             ^^                          ← "In" is YELLOW + 120% size
             rest is WHITE at 100% size

Time 0.3s:  "In the tapestry of time"
                ^^^                      ← "the" is YELLOW + 120% size
                rest is WHITE at 100% size

Time 0.5s:  "In the tapestry of time"
                    ^^^^^^^^^            ← "tapestry" is YELLOW + 120% size
                    rest is WHITE at 100% size
```

### ASS Implementation: Two Approaches

#### Approach A: One Dialogue Line Per Word State (Recommended for simplicity)

Each word-timing creates a separate `Dialogue` line with the same full text, but different inline overrides. The **end time of line N = start time of line N+1** to prevent flicker.

```ass
; Word "In" is highlighted (green), rest is white
Dialogue: 0,0:00:00.24,0:00:00.34,Hormozi,,0,0,0,,{\c&H00FF00&}In{\c&HFFFFFF&} the tapestry of time
; Word "the" is highlighted
Dialogue: 0,0:00:00.34,0:00:00.46,Hormozi,,0,0,0,,In {\c&H00FF00&}the{\c&HFFFFFF&} tapestry of time
; Word "tapestry" is highlighted
Dialogue: 0,0:00:00.46,0:00:00.98,Hormozi,,0,0,0,,In the {\c&H00FF00&}tapestry{\c&HFFFFFF&} of time
```

**Critical**: End time of line N must exactly equal start time of line N+1 to avoid flicker between frames.

#### Approach B: Single Dialogue Line with `\t` Transforms (More advanced)

Use `\t` (animated transform) tags to change color at specific millisecond offsets within a single dialogue line:

```ass
Dialogue: 0,0:00:00.00,0:00:07.00,Default,,0,0,0,,{\1c&HFFFFFF&\t(300,300,\1c&H00FF00&)\t(600,600,\1c&HFFFFFF&)}In {\1c&HFFFFFF&\t(600,600,\1c&H00FF00&)\t(1200,1200,\1c&HFFFFFF&)}the {\1c&HFFFFFF&\t(1200,1200,\1c&H00FF00&)\t(1400,1400,\1c&HFFFFFF&)}tapestry {\1c&HFFFFFF&\t(1400,1400,\1c&H00FF00&)\t(1700,1700,\1c&HFFFFFF&)}of {\1c&HFFFFFF&\t(1700,1700,\1c&H00FF00&)\t(1800,1800,\1c&HFFFFFF&)}time
```

Each word gets:
1. `\1c&HFFFFFF&` — start as white
2. `\t(start_ms, start_ms, \1c&H00FF00&)` — instant switch to green at word start
3. `\t(end_ms, end_ms, \1c&HFFFFFF&)` — instant switch back to white at word end

**Timing values** are millisecond offsets from the dialogue line's start time.

#### Approach B Python Generator (from Stack Overflow)

```python
WHITE_COLOR = r"\1c&HFFFFFF&"
GREEN_COLOR = r"\1c&H00FF00&"

def highlight_words_by_timing(timings: tuple, sentence: str) -> str:
    """
    timings: tuple of ms offsets; len = len(words) + 1
    e.g. for 3 words: (t1_start, t2_start, t3_start, t3_end)
    """
    words = sentence.split()
    if len(timings) != len(words) + 1:
        raise ValueError("Number of timings must equal words + 1")

    command = ""
    for i, word in enumerate(words):
        tag = "{"
        tag += WHITE_COLOR
        tag += f"\\t({timings[i]},{timings[i]},{GREEN_COLOR})"
        next_timing = timings[i + 1]
        tag += f"\\t({next_timing},{next_timing},{WHITE_COLOR})"
        tag += "}"
        command += f"{tag}{word} "
    return command
```

### Adding Font Size Pop

To make the active word also **bigger**, add `\fs` overrides:

```ass
; Approach A with size pop: active word is 90pt, rest is 75pt
Dialogue: 0,0:00:00.24,0:00:00.34,Hormozi,,0,0,0,,{\fs90\c&H00FF00&}In{\fs75\c&HFFFFFF&} the tapestry of time
```

> **Note**: Large font size changes on individual words can cause text reflow/jumping. A safer approach is to use `\fscx` and `\fscy` (scale) overrides which don't affect layout:
> ```ass
> {\fscx120\fscy120\c&H00FF00&}In{\fscx100\fscy100\c&HFFFFFF&} the tapestry
> ```

---

## 3. Words Appear Only During Speech

### The Problem

Default subtitle behavior shows text for an entire duration. Premium captions should:
- **Appear** the instant speech starts
- **Disappear** when there's a meaningful pause
- **Not linger** during silence gaps

### Detecting Speech Gaps

Use word-level timestamps from Whisper/WhisperX to detect gaps:

```python
SILENCE_THRESHOLD_MS = 500  # Gap > 500ms = new caption group

def group_words_by_speech(words):
    """
    words: list of {text, start, end} dicts from Whisper
    Returns: list of caption groups
    """
    groups = []
    current_group = []

    for i, word in enumerate(words):
        current_group.append(word)

        # Check if next word has a gap
        if i < len(words) - 1:
            gap = words[i + 1]['start'] - word['end']
            if gap > SILENCE_THRESHOLD_MS / 1000:
                groups.append(current_group)
                current_group = []
        else:
            groups.append(current_group)

    return groups
```

### Key Thresholds

| Gap Duration | Interpretation | Action |
|---|---|---|
| < 150ms | Normal word spacing | Keep in same caption group |
| 150–500ms | Brief pause (comma, breath) | Keep in same group OR start new line |
| 500ms–1.5s | Sentence break | **New caption group** (clear screen) |
| > 1.5s | Significant silence | **Clear screen entirely** |

### Known Issues with Whisper Timestamps

- **Whisper** sometimes produces continuous timestamps even during silence (timestamps concatenated without gaps)
- **WhisperX** uses forced alignment for better word-level accuracy
- **CrisperWhisper** (2024 paper) fine-tunes the tokenizer for more accurate word boundaries
- **Workaround**: Use VAD (Voice Activity Detection) as a pre-processing step to detect silence regions, then cross-reference with Whisper timestamps

### ASS Implementation

Simply set each caption group's dialogue line timing to `first_word.start → last_word.end`:

```ass
; Group 1: words from 0.24s to 1.58s (then silence until 2.10s)
Dialogue: 0,0:00:00.24,0:00:01.58,Hormozi,,0,0,0,,In the tapestry of time
; Group 2: words from 2.10s to 4.97s
Dialogue: 0,0:00:02.10,0:00:04.97,Hormozi,,0,0,0,,a visitor from shadows past
; (screen is blank from 1.58s to 2.10s)
```

---

## 4. Premium Fonts for Video Captions

### Top Font Recommendations

| Font | Style | Best For | Source | License |
|---|---|---|---|---|
| **Montserrat Black** | Bold geometric sans | Universal caption font; clean, modern | [Google Fonts](https://fonts.google.com/specimen/Montserrat) | Free (OFL) |
| **Bebas Neue** | Tall condensed sans | Headlines, impact text | [Google Fonts](https://fonts.google.com/specimen/Bebas+Neue) | Free (OFL) |
| **Anton** | Bold condensed sans | Attention-grabbing, compact | [Google Fonts](https://fonts.google.com/specimen/Anton) | Free (OFL) |
| **Poppins Bold** | Rounded geometric sans | Friendly, modern feel | [Google Fonts](https://fonts.google.com/specimen/Poppins) | Free (OFL) |
| **The Bold Font** | Extra bold display | "Hormozi style" captions | [dafont.com](https://www.dafont.com/the-bold-font.font) | Free for personal use |
| **Oswald** | Condensed gothic sans | Strong headlines | [Google Fonts](https://fonts.google.com/specimen/Oswald) | Free (OFL) |
| **Helvetica** | Classic neo-grotesque | Clean, professional | System font / Licensed | Varies |
| **Arial Black** | Bold system font | Fallback option | System font | Pre-installed |

### Creator Font Usage

| Creator | Font | Style |
|---|---|---|
| Alex Hormozi | The Bold Font | Yellow/white, large, centered |
| Iman Gadzhi | Helvetica Bold | Clean white with outline |
| Gary Vee | Helvetica | White, minimal |
| MrBeast | Custom / Montserrat Black | Colorful, animated |

### Font Selection Criteria for Mobile Video

1. **Weight**: Bold or Black weight minimum — thin fonts disappear on small screens
2. **Width**: Slightly condensed fonts fit more text per line
3. **Contrast**: Must be readable over any background (use outline + shadow)
4. **x-height**: Tall x-height fonts (Montserrat, Poppins) are more legible at small sizes

### Embedding Custom Fonts in FFmpeg

**Method 1: `fontsdir` option** (recommended)

```bash
# Point to a directory containing .ttf/.otf files
ffmpeg -i input.mp4 -vf "ass=subtitle.ass:fontsdir=/path/to/fonts/" output.mp4

# Or with the subtitles filter
ffmpeg -i input.mp4 -vf "subtitles=subtitle.ass:fontsdir=/path/to/fonts/" output.mp4
```

**Method 2: System font installation**

```bash
# Linux: Copy font to system fonts directory
cp Montserrat-Black.ttf /usr/share/fonts/truetype/
fc-cache -fv

# Windows: Copy to C:\Windows\Fonts\ or install via right-click

# macOS: Copy to /Library/Fonts/ or ~/Library/Fonts/
```

**Method 3: `force_style` override** (for SRT → ASS conversion)

```bash
ffmpeg -i input.mp4 \
  -vf "subtitles=subtitle.srt:force_style='Fontname=Montserrat,Bold=1,Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1'" \
  output.mp4
```

### Fontconfig Troubleshooting

If you get `Fontconfig error: Cannot load default config file`:
- Set `FC_CONFIG_FILE` environment variable pointing to a `fonts.conf`
- Ensure fontconfig is installed: `apt install fontconfig` (Linux)
- On Windows, use `fontsdir` to bypass fontconfig entirely

### Font Download Script

```bash
#!/bin/bash
# Download recommended fonts from Google Fonts
FONT_DIR="./fonts"
mkdir -p "$FONT_DIR"

# Montserrat (all weights)
curl -L "https://fonts.google.com/download?family=Montserrat" -o "$FONT_DIR/montserrat.zip"
unzip "$FONT_DIR/montserrat.zip" -d "$FONT_DIR/Montserrat"

# Bebas Neue
curl -L "https://fonts.google.com/download?family=Bebas+Neue" -o "$FONT_DIR/bebas-neue.zip"
unzip "$FONT_DIR/bebas-neue.zip" -d "$FONT_DIR/BebasNeue"

# Poppins
curl -L "https://fonts.google.com/download?family=Poppins" -o "$FONT_DIR/poppins.zip"
unzip "$FONT_DIR/poppins.zip" -d "$FONT_DIR/Poppins"

# Anton
curl -L "https://fonts.google.com/download?family=Anton" -o "$FONT_DIR/anton.zip"
unzip "$FONT_DIR/anton.zip" -d "$FONT_DIR/Anton"
```

---

## 5. FFmpeg ASS Implementation

### Complete ASS File Structure

```ass
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Montserrat,75,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,2,2,40,40,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.24,0:00:00.34,Caption,,0,0,0,,{\c&H00FFFF&}In{\c&HFFFFFF&} the tapestry\Nof time
Dialogue: 0,0:00:00.34,0:00:00.46,Caption,,0,0,0,,In {\c&H00FFFF&}the{\c&HFFFFFF&} tapestry\Nof time
```

### Key ASS Tags Reference

| Tag | Purpose | Example |
|---|---|---|
| `\c&HBBGGRR&` | Set primary text color (BGR format!) | `\c&H00FFFF&` = yellow |
| `\1c&HBBGGRR&` | Same as `\c` (primary color) | `\1c&H00FF00&` = green |
| `\fs<size>` | Set font size | `\fs90` |
| `\fscx<percent>` | Horizontal scale | `\fscx120` = 120% width |
| `\fscy<percent>` | Vertical scale | `\fscy120` = 120% height |
| `\b1` | Bold on | `\b1` |
| `\an<pos>` | Alignment (numpad layout) | `\an8` = top center, `\an2` = bottom center |
| `\pos(x,y)` | Exact position | `\pos(540,1500)` |
| `\t(t1,t2,tags)` | Animated transform | `\t(300,300,\1c&H00FF00&)` = instant color at 300ms |
| `\k<centisec>` | Karaoke timing (secondary→primary) | `\k50` = 500ms |
| `\N` | Hard line break | `word1\Nword2` |
| `\bord<size>` | Border/outline width | `\bord3` |
| `\shad<size>` | Shadow depth | `\shad2` |
| `\blur<strength>` | Edge blur | `\blur3` |

### Color Format (IMPORTANT)

ASS uses **BGR** order, not RGB! Also prefixed with `&H`:

| Color | HTML (RGB) | ASS (BGR) |
|---|---|---|
| White | `#FFFFFF` | `&HFFFFFF&` |
| Yellow | `#FFFF00` | `&H00FFFF&` |
| Green | `#00FF00` | `&H00FF00&` |
| Cyan | `#00FFFF` | `&HFFFF00&` |
| Red | `#FF0000` | `&H0000FF&` |
| Black | `#000000` | `&H000000&` |

With alpha: `&HAABBGGRR` where AA is transparency (00=opaque, FF=transparent).

### Alignment Reference (`\an` tag)

```
7 (top-left)      8 (top-center)      9 (top-right)
4 (mid-left)      5 (mid-center)      6 (mid-right)
1 (bottom-left)   2 (bottom-center)   3 (bottom-right)
```

For vertical video captions: **`\an2`** (bottom center) or **`\an8`** (top center) are most common. Use `MarginV` to offset from edge.

### Style Definition Explained

```
Style: Caption, Montserrat, 75, &H00FFFFFF, &H000000FF, &H00000000, &H00000000, -1, 0, 0, 0, 100, 100, 0, 0, 1, 3, 2, 2, 40, 40, 200, 1
         │         │         │       │            │            │            │       │  │  │  │   │    │   │  │  │  │  │  │  │   │   │    │
         Name      Font    Size  Primary    Secondary    Outline       Back    Bold  │  │  │ ScX ScY Sp  │  │  OL Sh Al  ML  MR  MV  Enc
                                 Color      Color        Color        Color         It Ul SO             An BS
```

Key settings for premium look:
- **Fontsize**: 70–90 for 1080p vertical video
- **Bold**: `-1` (true)
- **BorderStyle**: `1` (outline + shadow) or `3` (opaque box)
- **Outline**: `2–4` pixels for thick readable border
- **Shadow**: `1–3` for depth
- **MarginV**: `150–250` to position above bottom edge

### Performance Considerations

- **Approach A** (one dialogue per word state) generates many dialogue lines but is simpler and more compatible.
  - For a 60-second clip with 150 words → ~150 dialogue lines. This is fine for FFmpeg.
- **Approach B** (single line with `\t`) is more compact but complex tag strings can cause rendering issues with some players.
- **Layer field** should be `0` for all lines (same layer = last-in-time wins for overlapping lines).
- **libass** (used by FFmpeg) handles both approaches well. Test with `ffplay` before final render.

### FFmpeg Burn-In Command

```bash
# Basic burn-in
ffmpeg -i input.mp4 -vf "ass=captions.ass" -c:a copy output.mp4

# With custom fonts directory
ffmpeg -i input.mp4 -vf "ass=captions.ass:fontsdir=./fonts/" -c:a copy output.mp4

# High quality encoding
ffmpeg -i input.mp4 \
  -vf "ass=captions.ass:fontsdir=./fonts/" \
  -c:v libx264 -preset slow -crf 18 \
  -c:a copy \
  output.mp4
```

---

## 6. Recommended Approach

### Architecture

```
Whisper (word timestamps)
  → Group words into caption phrases (by silence gaps + word count)
  → For each phrase, generate ASS Dialogue lines (Approach A: one per word-state)
  → Each line: full phrase text with \c override on active word
  → FFmpeg burns ASS into video with custom font via fontsdir
```

### Recommended Configuration

| Setting | Value | Rationale |
|---|---|---|
| **Approach** | A (one Dialogue per word state) | Simplest, most compatible, no flicker if times are contiguous |
| **Font** | Montserrat Black (primary), Bebas Neue (alt) | Free, bold, readable on mobile |
| **Font size** | 75–80pt at 1080×1920 | Fills width without overflow |
| **Default color** | White `&HFFFFFF&` | High contrast on most backgrounds |
| **Highlight color** | Yellow `&H00FFFF&` | Maximum pop without being garish |
| **Outline** | Black, 3px | Ensures readability over any background |
| **Shadow** | Black, 2px | Depth effect |
| **Alignment** | `\an2` (bottom center) | Standard caption position |
| **MarginV** | 200px | Above bottom edge, below face area |
| **Lines per group** | 2 max | Readability on mobile |
| **Words per line** | 5–8 | Natural reading chunks |
| **Silence threshold** | 500ms | Gap to trigger new caption group |
| **Size pop** | `\fscx115\fscy115` on active word | Subtle scale, no text reflow |

### Why Approach A Over Approach B

1. **Simplicity**: Each dialogue line is independent — easy to debug
2. **No flicker**: Contiguous start/end times guarantee seamless transitions
3. **Font size pop**: Can safely add `\fs` or `\fscx/\fscy` per word without complex transform chains
4. **Compatibility**: Works with all ASS renderers (libass, VSFilter)
5. **Generation**: Trivial to generate programmatically from word timestamps

---

## 7. Implementation Plan

### Phase 1: Core Caption Generator

1. **Parse Whisper output** — Extract word-level timestamps `{text, start, end}`
2. **Group into phrases** — Split on silence gaps (>500ms) and max word count (8 words)
3. **Line-wrap phrases** — Split phrases >5 words into 2 lines at natural boundary
4. **Generate ASS** — For each phrase, emit N dialogue lines (one per word state) with:
   - Full phrase text with `\c` highlight on active word
   - Optional `\fscx115\fscy115` scale on active word
   - Contiguous timestamps (end of line N = start of line N+1)
5. **Write ASS file** — Include Script Info, Style definition, and Events

### Phase 2: Font Pipeline

1. **Download fonts** — Script to fetch Montserrat Black + fallbacks from Google Fonts
2. **Font directory** — Store in `./fonts/` within project
3. **FFmpeg integration** — Pass `fontsdir=./fonts/` to `ass` filter

### Phase 3: Polish

1. **Configurable themes** — Allow choosing highlight color, font, position
2. **Emoji/special char handling** — Ensure font supports common characters
3. **Preview mode** — Generate short preview clip for quick iteration
4. **Batch processing** — Apply to multiple videos in sequence

### Phase 4: Advanced (Optional)

1. **Approach B migration** — Single dialogue with `\t` transforms for better performance on very long videos
2. **Animated entrance** — Words fade/slide in using `\fad` or `\move`
3. **Speaker detection** — Different colors per speaker
4. **Auto-emphasis** — Detect key words (nouns, verbs) and add extra styling

---

## References

- [Aegisub ASS Tags Reference (v3.2)](https://aegisub.org/docs/3.2/ASS_Tags)
- [Stack Overflow: Animate each word as spoken in ASS](https://stackoverflow.com/questions/76848089/in-advanced-substation-alpha-ass-file-how-can-i-animate-each-word-as-it-is-spo)
- [Bannerbear: FFmpeg Subtitle Styles](https://www.bannerbear.com/blog/how-to-add-subtitles-to-a-video-with-ffmpeg-5-different-styles/)
- [OpusClip Caption Presets](https://www.opus.pro/blog/best-caption-presets-styles-boost-retention)
- [SendShort: Best TikTok Fonts](https://sendshort.ai/guides/tiktok-font/)
- [Google Fonts: Montserrat](https://fonts.google.com/specimen/Montserrat)
- [Google Fonts: Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue)
- [CrisperWhisper Paper (accurate word timestamps)](https://arxiv.org/abs/2408.16589)
- [whisper.cpp Karaoke ASS Issue #884](https://github.com/ggml-org/whisper.cpp/issues/884)

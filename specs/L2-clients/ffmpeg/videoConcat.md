# videoConcat Specification

## Overview

FFmpeg-backed video concatenation client. Provides segment joining via the concat demuxer (for cut-only joins) or xfade filter (for crossfade transitions), and a normalization helper that re-encodes a video to match a reference video's resolution and framerate before concatenation.

**Source:** `src/L2-clients/ffmpeg/videoConcat.ts`

---

## Requirements

### concatVideos

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `concatVideos(segments, output, opts?)` throws an error when called with 0 segments. | P0 |
| REQ-002 | `concatVideos` with 1 segment copies the file to the output path without re-encoding. | P0 |
| REQ-003 | `concatVideos` with `fadeDuration=0` (or unset) uses the FFmpeg concat demuxer for lossless joining. | P0 |
| REQ-004 | `concatVideos` with `fadeDuration>0` uses the xfade filter to apply crossfade transitions between segments. | P0 |

### normalizeForConcat

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-005 | `normalizeForConcat(videoPath, referenceVideo, output)` re-encodes the video to match the reference video's resolution and framerate. | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `videoConcat.ts` must remain an L2 client module and may import only L0/L1 modules. | P0 |
| ARCH-002 | All FFmpeg invocations must use `execFile()` (not `exec()`) to prevent shell injection. | P0 |
| ARCH-003 | FFmpeg/FFprobe binary paths must be resolved through `ffmpegResolver` — never hardcoded. | P0 |

---

## Notes

- The concat demuxer (`-f concat`) is preferred when no transition effect is needed because it avoids re-encoding.
- The xfade filter requires all input segments to share the same codec, resolution, and framerate — callers should normalize first.
- `normalizeForConcat` probes the reference video to extract target resolution and framerate before re-encoding.

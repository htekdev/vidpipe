# VideoAsset Specification

## Overview

VideoAsset is the base class representing a video file with associated metadata, transcripts, captions, and generated content. It provides lazy-loaded access to video properties and handles caching for expensive operations.

**Source:** `src/L5-assets/VideoAsset.ts`

---

## Behavioral Requirements

### Path Computation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | System computes transcript path as `{videoDir}/transcript.json` | Must |
| REQ-002 | System computes layout path as `{videoDir}/layout.json` | Must |
| REQ-003 | System computes captions directory as `{videoDir}/captions/` | Must |
| REQ-004 | System computes cover image path as `{videoDir}/cover.png` | Must |

### Existence Checking

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-010 | `exists()` returns true when video file exists on disk | Must |
| REQ-011 | `exists()` returns false when video file does not exist | Must |
| REQ-012 | `getResult()` returns video path when file exists | Must |
| REQ-013 | `getResult()` throws "Video not found" error when file does not exist | Must |

### Metadata Extraction

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-020 | System extracts video metadata (duration, size, resolution) via ffprobe | Must |
| REQ-023 | System defaults resolution to 0×0 when no video stream found | Must |
| REQ-024 | System defaults duration and size to 0 when format fields missing | Must |
| REQ-025 | Metadata is cached after first extraction | Must |
| REQ-026 | Force flag bypasses metadata cache and re-fetches | Must |

### Transcript Loading

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-030 | System loads transcript from disk when file exists | Must |
| REQ-031 | System throws "Transcript not found" error when file does not exist | Must |
| REQ-032 | Transcript is cached after first load | Must |

### Caption Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-040 | System returns existing caption paths when all three files exist | Must |
| REQ-041 | System generates SRT, VTT, and ASS captions in captions directory when files do not exist | Must |
| REQ-043 | Force flag regenerates captions even when files exist | Must |
| REQ-044 | System regenerates all captions when only some files exist | Must |

### Chapter Loading

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-050 | System loads chapters from `chapters/chapters.json` when file exists | Must |
| REQ-051 | System returns empty array when chapters file does not exist | Must |
| REQ-052 | System returns empty array when chapters key is missing from file | Must |
| REQ-053 | Force flag returns empty array (skips disk cache) | Must |
| REQ-054 | Chapters are cached after first load | Must |

### Cover Image Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-060 | System generates cover image with AI using post content as context | Must |
| REQ-062 | System returns cached path when cover image already exists | Must |
| REQ-063 | Generation prompt includes post content for context | Must |

### Cache Management

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-070 | `clearCache()` clears all in-memory cached data and next access re-fetches | Must |

---

## Architectural Constraints

| ID | Constraint | Enforcement |
|----|------------|-------------|
| ARCH-001 | VideoAsset can only import from L0, L1, L4 | pre-layer-import hook |
| ARCH-002 | All file I/O must use L1 fileSystem wrappers | Code review |
| ARCH-003 | VideoAsset is abstract - requires concrete subclass implementation | TypeScript compiler |

---

## Notes

- VideoAsset is an abstract base class — concrete implementations (MainVideoAsset, ShortAsset, MediumClipAsset) provide actual paths via `videoDir`, `videoPath`, and `slug` properties.
- Transcript generation via Whisper is handled by the pipeline's transcription stage, not by VideoAsset itself.
- The screen region computation currently returns the full frame, treating webcam as an overlay rather than a separate partition.

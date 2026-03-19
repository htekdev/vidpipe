# introOutroService Specification

## Overview

Business logic service that prepends intro and appends outro video segments to a content video. Reads brand config, resolves toggle state and file paths via L0 pure functions, validates file existence, normalizes intro/outro to match the content video, and delegates concatenation to the L2 FFmpeg client.

**Source:** `src/L3-services/introOutro/introOutroService.ts`

---

## Requirements

### Skip Conditions

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `applyIntroOutro` returns the original `videoPath` unchanged when `SKIP_INTRO_OUTRO` environment variable is true. | P0 |
| REQ-002 | `applyIntroOutro` returns the original `videoPath` unchanged when the brand config `introOutro.enabled` is false. | P0 |
| REQ-003 | `applyIntroOutro` returns the original `videoPath` unchanged when both intro and outro toggles resolve to false for the given videoType and platform. | P0 |

### Path Resolution and Validation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-004 | `applyIntroOutro` resolves intro/outro file paths relative to the `brand.json` directory. | P0 |
| REQ-005 | `applyIntroOutro` skips the intro segment when the resolved intro file does not exist on disk. | P1 |
| REQ-006 | `applyIntroOutro` skips the outro segment when the resolved outro file does not exist on disk. | P1 |

### Concatenation

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-007 | `applyIntroOutro` normalizes intro/outro segments to match the content video's resolution and framerate before concatenation. | P0 |
| REQ-008 | `applyIntroOutro` calls `concatVideos` with segments in `[intro, content, outro]` order, omitting any segments that were toggled off or missing. | P0 |
| REQ-009 | `applyIntroOutro` returns `outputPath` when intro/outro segments are applied successfully. | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `introOutroService.ts` must remain an L3 service module and may import from L0, L1, and L2 only. | P0 |
| ARCH-002 | Toggle and path resolution must be delegated to L0 pure functions — the service must not duplicate that logic. | P0 |
| ARCH-003 | All FFmpeg operations must be delegated to L2 clients — the service must not invoke FFmpeg directly. | P0 |

---

## Notes

- The `videoType` parameter determines which toggle rules apply (e.g., shorts may skip intro for pacing).
- The optional `platform` parameter enables platform-specific overrides (e.g., YouTube vs TikTok).
- When both intro and outro files are missing on disk, the function returns the original path without error — missing files are warnings, not failures.
- Normalization creates temporary files that should be cleaned up after concatenation.

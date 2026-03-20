# introOutroResolver Specification

## Overview

Pure config resolution logic for intro/outro video segments. Resolves toggle state (enabled/disabled) and file paths from brand config, supporting per-videoType rules and per-platform overrides. All functions are deterministic with zero I/O.

**Source:** `src/L0-pure/introOutro/introOutroResolver.ts`

---

## Requirements

### Toggle Resolution

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `resolveIntroOutroToggle(config, videoType, platform?)` returns the platformOverrides entry when both platform and videoType match an override. | P0 |
| REQ-002 | `resolveIntroOutroToggle` falls back to `rules[videoType]` when no platform override matches. | P0 |
| REQ-003 | `resolveIntroOutroToggle` falls back to `{ intro: enabled, outro: enabled }` when no rules entry exists for the videoType. | P0 |
| REQ-004 | `resolveIntroOutroToggle` merges partial platform overrides with the base toggle so unspecified fields inherit from the base. | P0 |

### Intro Path Resolution

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-005 | `resolveIntroPath(config, platform?)` returns the platform-specific intro path when available. | P0 |
| REQ-006 | `resolveIntroPath` falls back to the default intro path when no platform-specific path exists. | P0 |
| REQ-007 | `resolveIntroPath` returns `null` when no intro path is configured. | P1 |

### Outro Path Resolution

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-008 | `resolveOutroPath(config, platform?)` returns the platform-specific outro path when available. | P0 |
| REQ-009 | `resolveOutroPath` falls back to the default outro path when no platform-specific path exists. | P0 |
| REQ-010 | `resolveOutroPath` returns `null` when no outro path is configured. | P1 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `introOutroResolver.ts` must remain in L0-pure and may only import from other L0 modules. | P0 |
| ARCH-002 | All functions must be pure — no file system access, no environment variable reads, no side effects. | P0 |

---

## Notes

- The `config` parameter is the `introOutro` section of `brand.json`.
- `videoType` values include `"main"`, `"shorts"`, and `"medium-clips"`.
- Platform overrides allow different intro/outro behavior per social platform (e.g., YouTube shorts skip intro, LinkedIn keeps it).

# ideaStore Specification

## Overview

File I/O module for idea-bank persistence. Each idea is stored as a standalone JSON file in an ideas directory so the files remain reviewable and git-friendly.

**Source:** `src/L1-infra/ideaStore/ideaStore.ts`

---

## Behavioral Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `readIdeaBank()` returns an empty array when the ideas directory does not exist. | P0 |
| REQ-002 | `readIdeaBank()` reads `*.json` files from the ideas directory and skips malformed or non-idea payloads without failing the whole read. | P0 |
| REQ-003 | `writeIdea()` stores each idea at `{ideasDir}/{idea.id}.json` and creates the ideas directory when needed. | P0 |
| REQ-004 | `writeIdea()` refreshes `idea.updatedAt` to the current ISO timestamp before persisting the idea. | P0 |
| REQ-005 | `readIdea()` returns `null` when the requested `{id}.json` file does not exist. | P0 |
| REQ-006 | `listIdeaIds()` returns the basename of each `*.json` file in the ideas directory without reading file contents. | P0 |
| REQ-007 | `deleteIdea()` removes `{id}.json` and does not fail when the file is already absent. | P0 |
| REQ-008 | `writeIdea()` must reject ideas whose `publishBy` field is missing or not a valid ISO 8601 date string. | P0 |
| REQ-009 | `readIdea()` and `readIdeaBank()` must treat `publishBy` as a required ISO 8601 date field when validating persisted idea payloads. | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `ideaStore.ts` may only import from L0, L1, and Node.js builtins. | P0 |
| ARCH-002 | All disk access must go through `src/L1-infra/fileSystem/fileSystem.ts`. | P0 |
| ARCH-003 | All path composition must go through `src/L1-infra/paths/paths.ts`. | P0 |

---

## Notes

- Default storage directory is `./ideas` resolved from the current working directory.
- One idea per file keeps diffs focused and avoids merge conflicts in a single large idea-bank JSON file.

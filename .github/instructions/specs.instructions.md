# Specification Writing Guidelines

applyTo: specs/**/*.md

## Philosophy

**Specs are the source of truth for requirements.** When adding or changing functionality:

1. **Change the spec FIRST** — Define what the system should do
2. **Add/update tests** — Create tests that verify the spec requirements
3. **Implement** — Write code to make tests pass

This ensures requirements are explicitly documented and tested, not implicit in code.

## Requirement ID Conventions

### Behavioral Requirements (REQ-XXX)

Use `REQ-XXX` for functional/behavioral requirements that describe what the system must do.

### Architectural Constraints (ARCH-XXX)

Use `ARCH-XXX` for architectural constraints that describe how the system must be structured.

## ID Numbering Scheme

IDs are grouped by category in ranges of 10:

| Range | Category |
|-------|----------|
| REQ-001 – REQ-009 | Category 1 (e.g., Core behavior) |
| REQ-010 – REQ-019 | Category 2 (e.g., Input validation) |
| REQ-020 – REQ-029 | Category 3 (e.g., Output format) |
| REQ-030 – REQ-039 | Category 4 (e.g., Error handling) |
| ... | Continue as needed |

Same scheme applies to `ARCH-XXX` IDs.

## Table Format

Requirements MUST be documented in table format with these columns:

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | The system must validate input before processing | P0 |
| REQ-002 | Invalid input must return a descriptive error | P1 |

Priority levels:
- **P0** — Must have (blocking)
- **P1** — Should have (important)
- **P2** — Nice to have (enhancement)

## Test Mapping Rules

1. **Every `REQ-XXX` must have a corresponding test** named `{SpecName}.REQ-XXX`
   - Example: `VideoAsset.REQ-001` for a requirement in `specs/L5-assets/VideoAsset.md`

2. **Tests live in `src/__tests__/`** — NOT in `specs/__tests__/`
   - Specs are documentation, not executable code
   - Test files mirror the spec structure under `src/__tests__/`

3. **Test naming convention:**
   ```typescript
   describe('VideoAsset', () => {
     describe('REQ-001: Lazy-loads metadata on first access', () => {
       test('VideoAsset.REQ-001 - metadata is undefined before access', () => {
         // ...
       })
     })
   })
   ```

## File Location

Spec files mirror the source structure:

| Source File | Spec File |
|-------------|-----------|
| `src/L5-assets/VideoAsset.ts` | `specs/L5-assets/VideoAsset.md` |
| `src/L3-services/transcription/transcription.ts` | `specs/L3-services/transcription/transcription.md` |
| `src/L4-agents/ShortsAgent.ts` | `specs/L4-agents/ShortsAgent.md` |

## Example Spec File

```markdown
# VideoAsset Specification

## Overview

Lazy-loaded asset wrapper for video files with metadata, transcript, and analysis.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Metadata is lazy-loaded on first property access | P0 |
| REQ-002 | Multiple accesses return cached metadata | P0 |
| REQ-003 | Invalid video path throws descriptive error | P1 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Must not import from L2 or L3 directly | P0 |
| ARCH-002 | Must delegate to L4 agents via bridge modules | P0 |
```

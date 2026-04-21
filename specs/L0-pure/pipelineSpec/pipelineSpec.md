# PipelineSpec Specification

## Overview

Declarative pipeline configuration system that controls which stages run, how clips are selected, and how content is distributed. Specs are defined as YAML/JSON files or built-in presets and merged with defaults so partial definitions are valid.

**Source:** `src/L0-pure/pipelineSpec/`

---

## Behavioral Requirements

### Core Spec Resolution

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | A PipelineSpec must have name, description, processing, clips, content, and distribution sections | Must |
| REQ-002 | Built-in presets (full, clean, minimal) are always available by name | Must |
| REQ-003 | Partial specs are merged with the full preset to fill missing values | Must |
| REQ-004 | SKIP_* flags can only disable stages — they never enable something the spec disables | Must |
| REQ-005 | The default spec (when none provided) matches current pipeline behavior exactly | Must |

### Clip Configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-010 | clips.shorts.strategy supports 'hook-first' and 'chronological' | Must |
| REQ-011 | clips.medium.duration.max can be set up to 600s for long-form clips | Must |
| REQ-012 | minViralScore must be between 1 and 20 | Must |

### Distribution

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-020 | distribution.platforms.toneStrategy 'unified' produces same tone for all platforms | Must |
| REQ-021 | distribution.platforms.variants false skips aspect ratio variant generation | Must |

### Spec Loading (L1)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-030 | File paths (containing / or \ or ending in .yaml/.yml/.json) are loaded as files | Must |
| REQ-031 | Preset names resolve to built-in presets | Must |
| REQ-032 | Short names resolve to pipeline-specs/{name}.yaml | Must |
| REQ-033 | Unknown specs throw helpful error listing available options | Must |

---

## Architectural Constraints

| ID | Constraint | Enforcement |
|----|------------|-------------|
| ARCH-001 | PipelineSpec types live in L0-pure (importable from any layer) | Layer import rules |
| ARCH-002 | Spec loader lives in L1-infra (file I/O) | Layer import rules |
| ARCH-003 | Validation and merger are pure functions in L0 | No vi.mock in L0 tests |

---

## Notes

- The `full` preset is the merge base — all partial specs inherit from it.
- `clean` disables shorts and visual enhancement for substance-focused output.
- `minimal` disables clips, blog, and distribution entirely — cleanup only.
- SKIP_* environment flags are applied after spec resolution via `applySkipFlags()`.

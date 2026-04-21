# ThumbnailAgent Specification

## Overview

ThumbnailAgent plans and generates compelling thumbnails for video clips using LLM-driven prompt planning and L3 image generation services. It accepts video context (title, description, hook, topics) and produces thumbnail images with optional text overlays and reference-image style transfer.

**Source:** `src/L4-agents/ThumbnailAgent.ts`

---

## Requirements

### Core Generation Flow

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `generateForClip()` must plan compelling thumbnail prompts from video context including title, description, hook, and topics. | P0 |
| REQ-002 | The `generate_thumbnail` tool must delegate image creation to the L3 `thumbnailGeneration` service and return the generated image path. | P0 |
| REQ-003 | When `promptOverride` is set in brand config via `getThumbnailConfig()`, the agent must skip LLM prompt planning and use the override directly. | P0 |
| REQ-004 | When thumbnails are disabled in config, `generateForClip()` must return an empty array without invoking the LLM or generation service. | P0 |

### Prompt & Overlay

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-005 | Thumbnail prompts must include a text overlay description of 3–5 words maximum to ensure readability at small sizes. | P1 |
| REQ-006 | The `capture_best_frame` tool must capture a representative video frame for reference or analysis during prompt planning. | P1 |

### Lifecycle & Reliability

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-007 | The LLM session must be destroyed after use via try/finally to prevent resource leaks. | P0 |
| REQ-008 | The agent must support per-platform thumbnail generation context so different platforms can receive tailored thumbnails. | P1 |
| REQ-009 | Agent state must fully reset between retries via `resetForRetry()` so a failed attempt does not pollute subsequent runs. | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Runtime imports must stay within L0, L1, and L3 dependencies, with `.js` extensions for ESM runtime imports. Must not import from L2, L5, L6, or L7. | P0 |
| ARCH-002 | Must extend `BaseAgent` from `src/L4-agents/BaseAgent.ts`. | P0 |
| ARCH-003 | `LLMProvider` must be injectable via constructor — never instantiated or hardcoded inside the agent. | P0 |
| ARCH-004 | Image generation must go through `src/L3-services/imageGeneration/thumbnailGeneration.ts`, not the L2 image-generation client directly. | P0 |

---

## Notes

- Reference image style transfer is configured via brand config (`brand.json`) and passed through to the L3 service.
- `getThumbnailConfig()` from `L1-infra/config/brand.ts` is the single source of truth for thumbnail settings (enabled, promptOverride, style preferences).
- The agent registers two tools: `generate_thumbnail` and `capture_best_frame`.

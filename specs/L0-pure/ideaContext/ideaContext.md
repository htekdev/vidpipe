# ideaContext Specification

## Overview

Pure prompt-building helpers for injecting creator intent from `Idea[]` records into content-generation agent system prompts.

**Source:** `src/L0-pure/ideaContext/ideaContext.ts`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Each exported idea-context builder returns an empty string when it receives no ideas. | P0 |
| REQ-002 | `buildIdeaContext()` and `buildIdeaContextForPosts()` include the idea topic, hook, audience, key takeaway, and prioritization guidance tailored to clip planning or social posting. | P0 |
| REQ-003 | `buildIdeaContextForSummary()` condenses ideas into a theme list that maps each topic to its key takeaway. | P0 |
| REQ-004 | `buildIdeaContextForBlog()` includes editorial angle, audience, key takeaway, and talking points for each idea. | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `ideaContext.ts` may only import from L0 modules and must remain pure string transformation logic. | P0 |

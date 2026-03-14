# ideaService Specification

## Overview

Business logic service for working with ideation records. It resolves ideas from the idea store, manages lifecycle transitions, and optionally uses the configured LLM provider to match ready ideas against a transcript.

**Source:** `src/L3-services/ideation/ideaService.ts`

---

## Behavioral Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `getIdeasByIds()` returns the persisted ideas for the requested IDs in the same order as the input array and throws `Idea not found: {id}` when any ID is missing. | P0 |
| REQ-002 | `getReadyIdeas()` returns only ideas whose `status` is `ready`. | P0 |
| REQ-003 | `markRecorded()` updates an idea to `status = 'recorded'`, stores the provided `sourceVideoSlug`, and persists the change. | P0 |
| REQ-004 | `markPublished()` appends a publish record to `publishedContent`, initializes the array when missing, changes `status` to `published`, and persists the change. | P0 |
| REQ-005 | `matchIdeasToTranscript()` only considers ready ideas, sends the transcript summary plus idea summaries to the configured LLM provider, and returns up to three matched ideas ordered by relevance. | P0 |
| REQ-006 | `matchIdeasToTranscript()` returns an empty array when there are no ready ideas, when the provider is unavailable, or when matching/parsing fails. | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `ideaService.ts` may only import from L0, L1, and L2-backed L3 wrappers. | P0 |
| ARCH-002 | Idea persistence must go through `src/L1-infra/ideaStore/ideaStore.ts`. | P0 |
| ARCH-003 | LLM access must go through `src/L3-services/llm/providerFactory.ts` and use a tool-free non-streaming session for transcript matching. | P0 |

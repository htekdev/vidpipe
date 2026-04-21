# IdeationAgent Specification

## Overview

IdeationAgent researches timely topics and manages draft content ideas as GitHub Issues in a dedicated idea repository.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `generateIdeas()` must build an ideation prompt that incorporates brand context, content pillars, provided seed topics, and publish-by guidance based on idea timeliness. | P0 |
| REQ-002 | `create_idea` must persist each generated idea as a draft GitHub Issue and return the collected ideas from `generateIdeas()`. | P0 |
| REQ-003 | The agent must configure Exa, YouTube, and Perplexity MCP servers only when their corresponding API keys are available. | P1 |
| REQ-004 | `create_idea` must require a `publishBy` ISO 8601 date and persist it on every generated idea. | P0 |
| REQ-005 | The agent must expose GitHub-backed idea discovery and management tools for listing, searching, finding related ideas, updating issues, and organizing issue metadata. | P1 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Runtime imports must stay within L0, L1, and L3 dependencies, with `.js` extensions for ESM runtime imports. | P0 |
| ARCH-002 | Idea persistence and idea-management operations must go through `src/L3-services/ideaService/ideaService.ts`, not the legacy L1 idea store. | P0 |

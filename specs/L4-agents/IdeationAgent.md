# IdeationAgent Specification

## Overview

IdeationAgent researches timely topics and produces draft content ideas aligned to the creator brand and existing idea bank.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `generateIdeas()` must build an ideation prompt that incorporates brand context, content pillars, provided seed topics, and publish-by guidance based on idea timeliness. | P0 |
| REQ-002 | `create_idea` must persist each generated idea as a draft with timestamps and return the collected ideas from `generateIdeas()`. | P0 |
| REQ-003 | The agent must configure Exa, YouTube, and Perplexity MCP servers only when their corresponding API keys are available. | P1 |
| REQ-004 | `create_idea` must require a `publishBy` ISO 8601 date and persist it on every generated idea. | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | Runtime imports must stay within L0, L1, and L3 dependencies, with `.js` extensions for ESM runtime imports. | P0 |

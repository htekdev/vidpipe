# ideate Specification

## Overview

`vidpipe ideate` generates, lists, and manually creates saved content ideas for future recordings.
It provides an L7 command surface over the L6 → L5 → L4 ideation chain and persists ideas through the GitHub Issues-backed idea service.

**Source:** `src/L7-app/commands/ideate.ts`

---

## Behavioral Requirements

### Listing saved ideas

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `runIdeate({ list: true, status })` must read ideas from the GitHub-backed idea service, filter by status when requested, and print the resulting saved ideas | P0 |

### JSON output format

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-030 | `runIdeate({ list: true, format: 'json' })` must output a JSON array of idea objects with fields: issueNumber, id, topic, hook, audience, platforms, status | P0 |
| REQ-031 | JSON output must respect `--status` filtering | P0 |
| REQ-032 | JSON output must return an empty array `[]` when no ideas match | P0 |
| REQ-033 | JSON output must contain no decorative text (no emoji, no table borders, no summary lines) — only valid JSON | P0 |
| REQ-034 | `--format json` must also work for generate mode, outputting newly generated ideas as a JSON array | P1 |
| REQ-035 | JSON generate mode must output an empty array when no ideas are generated | P1 |

### Generating ideas

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-010 | `runIdeate()` must parse comma-separated `topics`, parse `count`, delegate to the L6 ideation wrapper, and print the generated ideas with the storage location | P0 |

### Configuration handling

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-020 | `runIdeate()` must initialize runtime config before ideation work begins and forward an explicit `brand` override when provided | P0 |

### Manual idea creation (`--add`)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-040 | `--add` flag triggers idea creation mode | P0 |
| REQ-041 | `--topic` is required when `--add` is used; error if missing | P0 |
| REQ-042 | Prints `Created idea #N: "topic"` on success (default output) | P0 |
| REQ-043 | `--format json` prints full Idea object as JSON to stdout | P0 |
| REQ-044 | `--hook` defaults to topic, `--audience` defaults to "developers", `--platforms` defaults to "youtube" | P1 |
| REQ-045 | `--key-takeaway` defaults to hook, `--talking-points` and `--tags` default to `[]`, `--publish-by` defaults to 14 days from now | P1 |
| REQ-046 | Invalid platform names throw descriptive error | P1 |
| REQ-047 | Comma-separated `--platforms`, `--talking-points`, `--tags` are parsed into arrays | P1 |
| REQ-048 | Custom `--publish-by` date is forwarded to createIdea | P1 |

### AI enrichment (`--add` with AI, default)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-049 | When `--add` is used without `--no-ai`, AI enrichment fills missing fields via LLM | P0 |
| REQ-050 | `--prompt` provides additional guidance to the AI enrichment | P1 |
| REQ-051 | CLI-provided overrides take precedence over AI suggestions | P0 |
| REQ-052 | AI enrichment parser must extract JSON from responses that include preamble text before the JSON object | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | The L7 ideate command may import only L0, L1, L3, and L6 modules | P0 |
| ARCH-002 | Idea generation must flow through the L6 wrapper instead of importing L4 agents directly in L7 | P0 |
| ARCH-003 | AI enrichment must flow through L6 → L5 → L4, not call L4 directly from L7 | P0 |

---

## Notes

- Idea statuses follow the lightweight editorial-direction model used elsewhere in the pipeline.
- AI enrichment uses a lightweight single-LLM-call function, not the full IdeationAgent agentic loop.
- The `--add` feature supports VidRecord integration via `--format json` output.

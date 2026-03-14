# ideate Specification

## Overview

`vidpipe ideate` generates and lists saved content ideas for future recordings.
It provides an L7 command surface over the L6 → L5 → L4 ideation chain and persists ideas in the local idea bank.

**Source:** `src/L7-app/commands/ideate.ts`

---

## Behavioral Requirements

### Listing saved ideas

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `runIdeate({ list: true, status })` must read the saved idea bank, filter by status when requested, and print the resulting saved ideas | P0 |

### Generating ideas

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-010 | `runIdeate()` must parse comma-separated `topics`, parse `count`, delegate to the L6 ideation wrapper, and print the generated ideas with the storage location | P0 |

### Configuration handling

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-020 | `runIdeate()` must initialize runtime config before ideation work begins and forward an explicit `brand` override when provided | P0 |

---

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | The L7 ideate command may import only L0, L1, and L6 modules | P0 |
| ARCH-002 | Idea generation must flow through the L6 wrapper instead of importing L4 agents directly in L7 | P0 |

---

## Notes

- The persisted idea bank uses the default `./ideas` directory unless `output` overrides it.
- Idea statuses follow the lightweight editorial-direction model used elsewhere in the pipeline.

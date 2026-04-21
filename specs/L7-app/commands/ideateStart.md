# ideate start — Specification

## Overview

The `ideate start` command prepares a content idea for recording by running an interactive session in the terminal. The first supported mode is `interview`, which uses Socratic questioning to help the user develop their idea through iterative Q&A. The command operates in alt-screen mode for a clean chat-like UI experience.

The feature is exposed both as a CLI command (`vidpipe ideate start <issue-number>`) and as an SDK method (`vidpipe.startInterview()`), with event triggers for SDK consumers to observe the session in real time.

## Behavioral Requirements

### Core Command (REQ-001 – REQ-009)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `ideate start <issue-number>` accepts a GitHub Issue number as a required argument | P0 |
| REQ-002 | `--mode <mode>` option selects the session mode (default: `interview`) | P0 |
| REQ-003 | Command validates the idea exists before starting a session | P0 |
| REQ-004 | Command rejects ideas that are not in `draft` status with a descriptive error | P0 |
| REQ-005 | Command initializes runtime config before starting the session | P0 |
| REQ-006 | `--progress` flag enables structured JSONL interview events to stderr | P1 |
| REQ-007 | Unknown mode values produce a descriptive error listing valid modes | P1 |

### Interview Mode (REQ-010 – REQ-029)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-010 | Interview mode presents one Socratic question at a time | P0 |
| REQ-011 | Each subsequent question builds on the user's previous answers | P0 |
| REQ-012 | The interview continues until the user types `/end` or the agent decides to end | P0 |
| REQ-013 | Ctrl+C gracefully exits: saves partial transcript, leaves alt-screen cleanly | P0 |
| REQ-014 | The agent receives the idea's current fields (topic, hook, audience, etc.) as context | P0 |
| REQ-015 | The agent identifies insights that could improve idea fields (talking points, hook, etc.) | P1 |
| REQ-016 | The agent may use research tools (web search, etc.) to validate user claims | P2 |
| REQ-017 | The interview begins with a welcome message explaining the Socratic process | P1 |

### Persistence (REQ-030 – REQ-039)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-030 | Q&A transcript is saved as a structured GitHub Issue comment | P0 |
| REQ-031 | Comment uses the existing `<!-- vidpipe:idea-comment -->` marker pattern | P0 |
| REQ-032 | Discovered insights are persisted back to the idea (update talking points, key takeaway, hook, etc.) | P0 |
| REQ-033 | After a successful interview, the user is asked whether to mark the idea as `ready` | P1 |
| REQ-034 | Partial transcripts from interrupted sessions (Ctrl+C) are still saved | P1 |

### Alt-Screen UI (REQ-040 – REQ-049)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-040 | The interview runs in alt-screen mode with a header, message area, status bar, and input line | P0 |
| REQ-041 | Agent questions are displayed with a distinct visual style (cyan) | P0 |
| REQ-042 | User answers are displayed with a distinct visual style (green) | P0 |
| REQ-043 | Agent thinking state is shown in the status bar | P1 |
| REQ-044 | Agent tool calls are shown in the status bar with tool name | P1 |
| REQ-045 | Terminal resize redraws the UI correctly | P1 |
| REQ-046 | Non-TTY output (piped) falls back to inline rendering without alt-screen | P1 |
| REQ-047 | Insight discoveries are displayed as system messages (yellow) | P1 |

### SDK / Event System (REQ-050 – REQ-059)

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-050 | SDK exposes `startInterview(ideaNumber, options)` returning `Promise<InterviewResult>` | P0 |
| REQ-051 | `onEvent` callback receives all `InterviewEvent` variants in real time | P0 |
| REQ-052 | `answerProvider` callback is called when the agent needs user input, blocking until answered | P0 |
| REQ-053 | `InterviewEvent` includes: `interview:start`, `question:asked`, `answer:received`, `thinking:start`, `thinking:end`, `tool:start`, `tool:end`, `insight:discovered`, `interview:complete`, `interview:error` | P0 |
| REQ-054 | `InterviewResult` contains the full Q&A transcript, discovered insights, and updated field list | P0 |
| REQ-055 | Event listener is cleaned up in a finally block after the interview completes | P1 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | L7 command may only import from L0, L1, L3, L6 — no direct L4 imports | P0 |
| ARCH-002 | Interview orchestration flows through L6 → L5 → L4 layer chain | P0 |
| ARCH-003 | InterviewAgent (L4) uses L3 services for persistence, not L2 clients directly | P0 |
| ARCH-004 | AltScreenChat lives in L1-infra (infrastructure) — no business logic | P0 |
| ARCH-005 | InterviewEmitter follows the same singleton pattern as progressEmitter | P0 |
| ARCH-006 | The `ideate start` command uses Commander subcommand registration | P0 |
| ARCH-007 | All interview event types are defined in L0-pure as a discriminated union | P0 |
| ARCH-008 | The `StartModeRunner` interface supports future modes (outline, teleprompter) | P1 |
| ARCH-009 | The deferred Promise pattern bridges agent tool calls to external UI/SDK answer providers | P0 |

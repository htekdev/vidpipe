# ideaService Specification

## Overview

GitHub-backed L3 service for creating, updating, querying, and lifecycle-managing content ideas. It stores idea bodies in GitHub issue markdown, derives idea metadata from labels, reconstructs publishing history from structured comments, and maps GitHub issues back into the `Idea` domain model.

**Source:** `src/L3-services/ideaService/ideaService.ts`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `createIdea()` must create a GitHub issue whose title is `input.topic`, whose body uses the service's structured idea markdown format, whose labels encode `status:draft`, requested platforms, normalized tags, and derived priority, and must return the created issue mapped to an `Idea`. | P0 |
| REQ-002 | `updateIdea()` must fetch the current idea first, merge unspecified fields from the current state, update the issue body only when body-backed fields change, update labels only when status/platforms/tags/publishBy change, and fail when the target idea does not exist. | P0 |
| REQ-003 | `getIdea()` must fetch the issue and its comments concurrently, map them into an `Idea`, and return `null` when GitHub responds with 404. | P0 |
| REQ-004 | `listIdeas()` must build GitHub label filters from `IdeaFilters`, list matching issues, hydrate each issue with its comments, and honor `filters.limit`. | P0 |
| REQ-005 | `searchIdeas()` must search GitHub issues by free-text query and hydrate each result with its comments before returning `Idea` values. | P0 |
| REQ-006 | `findRelatedIdeas()` must normalize the idea's tags, query up to 5 issues per tag, exclude the current idea, deduplicate matches by issue number, sort by most recent `updated_at`, and return at most 5 related ideas. | P0 |
| REQ-007 | `linkVideoToIdea()` must add a structured video-link comment and update the issue labels so the idea becomes `status:recorded` while preserving the rest of the derived label set. | P0 |
| REQ-008 | `recordPublish()` must skip creating a duplicate publish-record comment when an existing parsed comment already uses the same `queueItemId`. | P0 |
| REQ-009 | `recordPublish()` must add a structured publish-record comment when needed and ensure the issue includes `status:published`. | P0 |
| REQ-010 | `getPublishHistory()` must parse issue comments and return only publish-record entries in comment order. | P0 |
| REQ-011 | `getReadyIdeas()` must delegate to `listIdeas({ status: 'ready' })`, `markRecorded()` must delegate to `linkVideoToIdea()`, and `markPublished()` must delegate to `recordPublish()`. | P0 |
| REQ-012 | The stored issue body format must use `## Hook`, `## Audience`, `## Key Takeaway`, `## Talking Points`, and `## Publish By` sections in that order, render talking points as markdown bullets, optionally append `## Trend Context`, and fall back `publishBy` to the issue creation date when parsing a missing publish-by section. | P0 |
| REQ-013 | Label conventions must encode lifecycle as `status:*`, target platforms as `platform:*`, priority as `priority:hot-trend|timely|evergreen` based on `publishBy` versus the issue creation timestamp (`<= 7` days hot-trend, `<= 21` days timely, otherwise evergreen), and treat remaining normalized lowercase kebab-case labels as tags. | P0 |
| REQ-014 | Structured issue comments must include the `<!-- vidpipe:idea-comment -->` marker plus a fenced JSON payload; supported payloads are `video-link` comments with `videoSlug`/`linkedAt` and `publish-record` comments with a nested `record` object. | P0 |
| REQ-015 | Issue-to-idea mapping must combine issue metadata, parsed markdown body, parsed labels, comment-derived source video and publish records, `repoFullName` from `IDEAS_REPO`, and the legacy compatibility ID format `idea-{issueNumber}`. | P0 |
| REQ-016 | On non-404 failures, public service functions must log the operation-specific context and throw a new `Error` whose message includes the failed operation and the original error message. | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `ideaService.ts` must remain an L3 service module and may import only L0/L1/L2 modules; all GitHub I/O must go through `src/L2-clients/github/githubClient.ts`. | P0 |
| ARCH-002 | GitHub Issues, labels, and structured comments are the source of truth for persisted idea state; the service must not rely on local sidecar storage for issue-backed ideas. | P0 |
| ARCH-003 | The service's markdown, label, and comment formats must remain reversible enough to reconstruct the `Idea` model from GitHub issue data alone. | P0 |

## Notes

- `parseIdeaBody()` accepts either `- ` or `* ` bullet markers when reading existing talking-point sections, even though the formatter always writes `- ` bullets.
- Label parsing defaults missing lifecycle labels to `draft`.
- `sourceVideoSlug` is taken from the most recent parsed `video-link` comment encountered while scanning issue comments.

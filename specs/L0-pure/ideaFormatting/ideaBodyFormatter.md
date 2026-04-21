# ideaBodyFormatter Specification

## Overview

Pure L0 formatting and parsing helpers for representing `Idea` metadata as GitHub issue markdown, GitHub labels, and structured issue comments.

**Source:** `src/L0-pure/ideaFormatting/ideaBodyFormatter.ts`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `formatIdeaBody()` must emit `## Hook`, `## Audience`, `## Key Takeaway`, `## Talking Points`, and `## Publish By` sections in that order, trim section text, render non-empty talking points as `- ` bullet lines, omit blank talking points, and only append `## Trend Context` when it has content. | P0 |
| REQ-002 | `parseIdeaBody()` must recover section content from the markdown headings, default missing sections to empty strings or an empty array, and only return `trendContext` when that section is non-empty. | P0 |
| REQ-003 | `parseIdeaBody()` must parse talking points only from `- ` bullet lines inside the `Talking Points` section, trim each point, and ignore empty bullet entries. | P0 |
| REQ-004 | `extractLabelsFromIdea()` must emit a unique label set that starts with `status:{status}`, includes `platform:{platform}` labels for each target platform, includes normalized non-empty tags, and adds a derived priority label only when both `publishBy` and `now` are provided as valid dates. | P0 |
| REQ-005 | Priority derivation for `extractLabelsFromIdea()` must produce `priority:hot-trend` for publish dates within 7 days, `priority:timely` within 14 days, and `priority:evergreen` for later dates. | P0 |
| REQ-006 | `parseLabelsToIdea()` must restore the stored status and platform labels, ignore `priority:*` labels, and preserve all other non-empty labels as tags. | P0 |
| REQ-007 | `formatPublishRecordComment()` must emit a human-readable published heading that includes platform and clip-type display names plus a fenced JSON payload that round-trips to an `IdeaPublishRecord`. | P0 |
| REQ-008 | `formatVideoLinkComment()` must emit a linked-recording heading plus a fenced JSON payload containing `type`, `videoSlug`, and `linkedAt`. | P0 |
| REQ-009 | `parseIdeaComment()` must scan fenced JSON blocks in order, return the first supported and fully validated `publish-record` or `video-link` payload, and return `null` for malformed, unsupported, or incomplete payloads. | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `ideaBodyFormatter.ts` must remain an L0 module that imports only L0 types and pure helpers. | P0 |
| ARCH-002 | The formatter/parser functions must remain deterministic and side-effect free with no filesystem, network, config, or logger dependencies. | P0 |

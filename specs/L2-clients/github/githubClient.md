# GitHubClient Specification

## Overview

Octokit-backed L2 client for storing and retrieving idea data from GitHub Issues. It normalizes issue and comment payloads into local `GitHubIssue` and `GitHubComment` shapes, exposes label and comment helpers, and caches a singleton client for the configured ideas repository.

**Source:** `src/L2-clients/github/githubClient.ts`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | `new GitHubClient(token?, repoFullName?)` must resolve authentication from the explicit token or `GITHUB_TOKEN`, resolve the target repository from the explicit repo or `IDEAS_REPO`, and throw when the token is missing or the repo is not in `owner/repo` format. | P0 |
| REQ-002 | `createIssue()` must create a GitHub issue with the provided title and body, normalize optional labels to unique trimmed non-empty values, and return the created issue mapped to `GitHubIssue`. | P0 |
| REQ-003 | `updateIssue()` must forward the provided partial title, body, state, and labels, normalize labels when present, and return the updated issue mapped to `GitHubIssue`. | P0 |
| REQ-004 | `getIssue()` must fetch a single issue and map nullable GitHub fields into a `GitHubIssue` with a non-null body string and trimmed non-empty label names. | P0 |
| REQ-005 | `listIssues()` must list only open issues for the configured repository, apply normalized label filters when provided, page in batches of 100 items, filter out pull requests, and honor `maxResults`. | P0 |
| REQ-006 | `searchIssues()` must prepend `repo:{owner}/{repo} is:issue` to the query, paginate search results, filter out pull requests, and honor `maxResults`. | P0 |
| REQ-007 | `addLabels()` must no-op when given an empty label list and otherwise append the provided labels to the target issue. | P0 |
| REQ-008 | `removeLabel()` must remove a single label from an issue and treat a 404 response for a missing label as a successful no-op. | P0 |
| REQ-009 | `setLabels()` must replace the issue's labels with the provided label set. | P0 |
| REQ-010 | `addComment()` must create an issue comment and return the created comment mapped to `GitHubComment`. | P0 |
| REQ-011 | `listComments()` must paginate all comments for an issue and map nullable comment bodies into non-null strings. | P0 |
| REQ-012 | All public GitHub operations must log action-specific debug or error messages and translate API failures into `GitHubClientError` values that preserve the HTTP status when available. | P0 |
| REQ-013 | `getGitHubClient()` must cache a singleton keyed by `IDEAS_REPO` and `GITHUB_TOKEN`, and `resetGitHubClient()` must clear that cached instance. | P0 |

## Architectural Constraints

| ID | Constraint | Priority |
|----|------------|----------|
| ARCH-001 | `githubClient.ts` must remain an L2 client module and may import only L0/L1 modules plus external GitHub client dependencies such as `octokit`. | P0 |
| ARCH-002 | All GitHub issue and comment access must go through Octokit's REST endpoints and pagination helpers rather than ad hoc HTTP calls. | P0 |
| ARCH-003 | The client must expose normalized transport-level errors through `GitHubClientError` instead of leaking raw Octokit error objects to callers. | P0 |

## Notes

- `GitHubIssue` excludes pull requests even though GitHub's issue APIs can return them in mixed result sets.
- `DEFAULT_PER_PAGE` is 100 for both issue and comment pagination.
- Issue and comment body fields are normalized so downstream services never receive `null` body values.

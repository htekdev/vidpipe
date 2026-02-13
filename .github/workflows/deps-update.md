---
on:
  schedule:
    - cron: "0 9 * * 1"
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
timeout-minutes: 30
tools:
  github:
    toolsets: [default]
  edit:
  bash:
safe-outputs:
  create-pull-request:
    title-prefix: "[deps] "
    labels: [dependencies, automated]
    reviewers: [copilot]
    draft: false
    expires: 14
    if-no-changes: "ignore"
network: defaults
---

# Automated npm Dependency Updater

## Objective

Automatically update all npm packages to their latest versions, verify that the project still builds and passes tests with full coverage, and create a pull request with a detailed description of every package change.

## Context

- This is a Node.js project using npm as the package manager
- The project uses TypeScript with tsup for building
- Tests run via Vitest with coverage thresholds enforced
- Available validation commands: `npm run typecheck`, `npm run test:coverage`, `npm run build`

## Steps

1. **Check for existing update PR**: Search for any open PR with the `[deps]` title prefix and `dependencies` label. If one already exists, close it with a comment that a new update cycle is starting.

2. **Create a new branch**: Create a branch named `deps/weekly-update-YYYY-MM-DD` using the current date.

3. **Capture current state**: Run `npm outdated --json` and save the output. This is the "before" snapshot of all package versions.

4. **Update all packages**: Run `npm update --save` to update packages within semver ranges, then run `npx npm-check-updates -u` followed by `npm install` to update all packages to their absolute latest versions (including major bumps). Run `npm install` again to ensure the lockfile is consistent.

5. **Capture updated state**: Run `npm outdated --json` again and compare against the "before" snapshot. Also parse `package.json` changes to build a complete list of updated packages with their old and new versions.

6. **Verify no changes needed**: If no packages were actually updated, stop and do not create a PR. Use the `if-no-changes: "ignore"` behavior.

7. **Run validation suite**: Execute these commands in order. If any command fails, do NOT create the PR — stop and report the failure.
   - `npm run typecheck` — TypeScript type checking
   - `npm run test:coverage` — Full test suite with coverage thresholds
   - `npm run build` — Production build

8. **Generate PR description**: Create a detailed PR body that includes:
   - A summary line stating the total number of packages updated
   - A markdown table with columns: Package Name, Previous Version, New Version, Update Type (major/minor/patch)
   - A section grouping updates by type (major, minor, patch) with brief notes on what major updates may require attention
   - The full output of the validation suite (typecheck, tests, coverage, build) as a collapsible details block
   - A note at the bottom reminding the reviewer to check changelogs for any major version bumps

9. **Commit and create PR**: Commit the changes to `package.json` and `package-lock.json` with a descriptive commit message. Create the pull request targeting the default branch.

## Constraints

- Do NOT create the PR if any validation step (typecheck, test:coverage, build) fails
- Do NOT update packages if the project is already fully up to date
- Only commit `package.json` and `package-lock.json` — do not commit any other generated files
- Branch name must follow the pattern `deps/weekly-update-YYYY-MM-DD`
- The PR description must include a version comparison table, not just a list of package names

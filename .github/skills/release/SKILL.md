---
name: release
description: Create a new version release for vidpipe. Use this skill when asked to release, version, tag, or create a new version. Handles version bump, changelog generation, GitHub release, and npm publishing.
---

# Release Skill

Complete workflow for creating a new versioned release of vidpipe, including version bump, release notes, GitHub release, and npm publishing.

## Prerequisites

- Clean working tree (`git status` shows no uncommitted changes)
- All tests passing (`npm test`)
- `gh` CLI authenticated (`gh auth status`)
- npm publish token available (see npm-publish skill)

## Release Workflow

### Step 1: Determine Version Bump

Check commits since the last tag to decide the bump type:
```bash
git log --oneline $(git describe --tags --abbrev=0)..HEAD
```

- **patch** (x.x.1): Only bug fixes (`fix:` commits)
- **minor** (x.1.0): New features (`feat:` commits), no breaking changes
- **major** (1.0.0): Breaking changes (`BREAKING CHANGE` or `!:` commits)

### Step 2: Bump Version

```bash
npm version <patch|minor|major> --no-git-tag-version
```

This updates `package.json` and `package-lock.json` without creating a git tag (we'll do that manually after release notes).

### Step 3: Build and Test

```bash
npm run build && npm test
```

All tests must pass before proceeding.

### Step 4: Commit Version Bump

```bash
git add package.json package-lock.json
git commit -m "chore: bump version to <NEW_VERSION>"
git push origin main
```

### Step 5: Create Git Tag

```bash
git tag -a v<NEW_VERSION> -m "v<NEW_VERSION>"
git push origin v<NEW_VERSION>
```

### Step 6: Generate Release Notes

Write release notes that include:
- **Features** (`feat:` commits) — describe what's new with user-facing impact
- **Bug Fixes** (`fix:` commits) — describe what was broken and how it's fixed
- **Documentation** — notable doc improvements
- **Internal** — infrastructure, refactoring, DX improvements

Format as GitHub-flavored markdown with emoji section headers (✨ Features, 🐛 Fixes, 📖 Documentation, 🔧 Internal).

Include a changelog link at the bottom:
```
**Full Changelog**: https://github.com/htekdev/vidpipe/compare/vOLD...vNEW
```

### Step 7: Create GitHub Release

```bash
gh release create v<NEW_VERSION> --title "v<NEW_VERSION> — <SHORT_DESCRIPTION>" --notes "<RELEASE_NOTES>"
```

### Step 8: Publish to npm

Follow the npm-publish skill:
1. Set auth token: `npm config set //registry.npmjs.org/:_authToken=<TOKEN>`
2. Publish: `npm publish --access public`
3. Verify: `npm view vidpipe version`
4. Clean up: `npm config delete //registry.npmjs.org/:_authToken`

If no token is available, use Playwright to create one (see npm-publish skill).

### Step 9: Verify

- GitHub release visible: `gh release view v<NEW_VERSION>`
- npm version matches: `npm view vidpipe version`

## Important Notes

- Always push commits BEFORE creating the tag (tag should point to a pushed commit)
- Use `--no-git-tag-version` with `npm version` to separate the version bump commit from the tag
- Release notes should be written for END USERS, not developers
- The npm token (vidpipe-publish) expires every 90 days — check expiry if publish fails
- If npm registry shows old version after publish, wait 30-60 seconds for propagation

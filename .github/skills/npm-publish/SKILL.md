---
name: npm-publish
description: Publish packages to npm registry. Use this skill when asked to publish, release, or deploy a package to npm. Handles granular access token creation, authentication, and publishing with 2FA bypass.
---

# npm Publish Skill

Complete workflow for publishing packages to the npm registry, including granular access token creation via the npmjs.com web UI.

## Prerequisites

- npm account with package write access
- Playwright browser tool available for token creation
- Package must be built (`npm run build`) and tests passing (`npm test`)

## Publishing Workflow

### Step 1: Check if already published

```bash
npm view <package-name> version
```

If the package/version already exists, bump the version in `package.json` before proceeding.

### Step 2: Build and test

```bash
npm run build && npm test
```

Ensure there are no build errors and all tests pass before publishing.

### Step 3: Create granular access token (if needed)

If you don't have a valid token:

1. Navigate to `https://www.npmjs.com/settings/~/tokens` using Playwright browser
2. If not logged in, the user must authenticate (npm sends email OTP)
3. Click **"Generate New Token"**
4. Fill in:
   - **Token name**: `<package-name>-publish`
   - **Bypass 2FA**: Check the checkbox
   - **Packages and scopes → Permissions**: "Read and write"
   - **Select packages**: "All packages" radio button
   - **Expiration**: 90 days (maximum for write tokens)
5. Click **"Generate token"**
6. Copy the token from the success page (starts with `npm_`)

### Step 4: Configure and publish

```bash
npm config set //registry.npmjs.org/:_authToken=<TOKEN>
npm publish --access public
```

### Step 5: Verify publication

```bash
npm view <package-name> version
```

Confirm the published version matches what you expected.

### Step 6: Clean up token from local config

```bash
npm config delete //registry.npmjs.org/:_authToken
```

This removes the token from your local `.npmrc` so it is not accidentally leaked.

## Important Notes

- npm granular tokens with write access have a **max 90-day expiry**
- **Bypass 2FA** checkbox MUST be enabled for CLI publishing to work
- The **"All packages"** radio must be explicitly selected (it's not selected by default despite appearing so)
- Always clean up tokens from local `.npmrc` after publishing
- Token stays saved in npmjs.com account for re-use within its expiry window

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| **E403 error** | Token doesn't have bypass 2FA enabled, or expired | Regenerate token with bypass 2FA checked |
| **"Must select at least one package"** | "All packages" radio not actually selected | Click "All packages" radio button explicitly |
| **Email OTP required** | npm login requires email verification | User must check their email — cannot be automated |
| **E404 on npm view** | Package not yet published | This is expected for first-time publishes |
| **Version conflict** | Version already exists on registry | Bump version in `package.json` before publishing |

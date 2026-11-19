# testEnforcer Specification

Source: `.github/extensions/test-enforcer/extension.mjs`

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| REQ-001 | Before either Bash or PowerShell executes a supported standalone commit command, inspect staged files and deny source-only changes without staged regression tests. Require source and regression tests to be staged in a separate tool call before running `npm run commit`. | P0 |
| REQ-002 | Both shells must allow commits with staged source and regression tests, or with no staged TypeScript source changes. Non-commit commands and other tools must not inspect staged files. | P1 |
| REQ-003 | Hook regression tests must resolve and import the extension from their own worktree using a file URL anchored to the test file, without relying on test-runner root fallback or an ancestor worktree. | P0 |
| REQ-004 | Reject commit-like commands outside the supported standalone grammar before invoking Git, regardless of index contents. This includes compound staging/commit commands, directory-changing prefixes (`cd`, PowerShell `Set-Location`/`Push-Location`), Git `-C`, npm `--prefix`, wrappers and options that could stage files or redirect the target. Explain that the session must be rooted in the target worktree and staging must happen in a separate tool call. | P0 |
| REQ-005 | Read the index using an explicit Git subprocess working directory anchored to the extension's repository root via `import.meta.url`, not the extension process's current working directory. | P0 |
| REQ-006 | Allow literal quoted ASCII commit values containing separators such as `;`, `&&`, pipes and angle brackets in standalone invocations. Reject shell expansion, shell escaping (except literal backslashes in message-file paths), non-ASCII input (including PowerShell smart quotes), multiline input, malformed quoting and trailing commands before reading the index. | P1 |
| REQ-007 | Tokenize supported standalone invocations without expanding, evaluating or executing token values. Accept repeated value-taking `-m`/`--message`, `-F`/`--file` and `--trailer` options, including quoted absolute Windows message-file paths and quoted `Co-authored-by`/`Copilot-Session` trailer values. Require one literal value per option and retain the same anchored staged-test check for every accepted form. Reject unknown options, missing values and target/index overrides before reading the index. | P0 |
| REQ-008 | Detect commit candidates only at literal command/subcommand positions, not from filenames, revisions or ordinary argument strings containing `commit`, `git commit` or `npm run commit`. Non-commit commands such as `git add cicd/commit.ts` and `git diff -- cicd/commit.ts` must return without inspecting the index in either shell, regardless of staged files. Preserve detection of real commits after compound separators, known Git/npm global target options and explicit shell command wrappers so unsupported commit invocations are still denied before reading the index. | P0 |

## Supported command boundary

This is a conservative lexical allowlist, **not a shell parser or a general shell security boundary**. Candidate detection looks for literal `git commit` or `npm run commit` command/subcommand tokens (case-insensitive), including command positions after compound separators and known global target options. Quoted argument text is not another command; explicit shell-wrapper command arguments are inspected as command text, never evaluated. Once a commit candidate is found, the existing standalone allowlist below decides whether it may inspect the index. Aliases, dynamically constructed/obfuscated command names, arbitrary shell control flow, other commit tools and indirect script contents are not interpreted.

Supported standalone forms (surrounding spaces/tabs are allowed):

- Unquoted `git commit`, optionally followed by supported option/value pairs.
- Unquoted `npm run commit`, optionally followed by an unquoted `--` and supported option/value pairs after that delimiter.
- Supported options are exactly `-m`, `--message`, `-F`, `--file` and `--trailer`. They may repeat, in any order, with exactly one whitespace-separated literal value each. Joined/equals option forms and all other options remain unsupported.
- An unquoted value is a single token of ASCII letters, digits, `_`, `.`, `/`, `:` or `-`. Single/double-quoted literal values can contain printable ASCII separators, angle brackets and spaces/tabs, but not `$`, backticks or their enclosing quote. Backslashes are permitted only in `-F`/`--file` values; backslash-escaped enclosing quotes are unsupported. Tokens must be separated by spaces/tabs; quote concatenation is unsupported.
- Non-ASCII characters (notably PowerShell smart quotes), control characters other than tabs, shell escapes/interpolation and other options (including `git commit -a`, pathspecs, environment prefixes and target overrides) are deliberately unsupported. Tokenization only validates syntax; it never reads message files, expands paths or executes token contents.

Examples of supported repository commit arguments:

```text
npm run commit -- -F "C:\repo worktree\commit-message.txt"
npm run commit -- -m "fix: hook arguments" -m "Regression coverage; literal && separators"
npm run commit -- -m "fix: hook arguments" --trailer "Co-authored-by: Copilot <copilot@github.com>" --trailer "Copilot-Session: session-id"
```

Start the session in the target worktree, stage in a separate tool call, then use a supported standalone invocation. The existing `npm run commit` gate remains responsible for required test tiers; this hook does not replace it.

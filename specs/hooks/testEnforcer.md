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
| REQ-009 | Count only added, copied, modified or renamed staged paths (`--diff-filter=ACMR`) when checking source and regression tests. Deleted tests must not satisfy the regression-test requirement for active source changes, and deleted source alone must not trigger it. Verify these decisions against real Git indexes, including deletions, in both shells. | P0 |
| REQ-010 | Recognize npm commit candidates when known global target options occur before `run`, between `run` and the script name, or in both positions. This includes separate-value and equals forms of `--prefix` and workspace options. Reject these non-standalone target-changing commits before reading any index in both shells; do not mistake options or `commit` arguments to a different script for a commit invocation. | P0 |
| REQ-011 | Treat token-boundary `#` line comments as inert during candidate detection in both shells. Quotes or separators in a comment must neither hide a literal commit on a following line nor create a commit candidate from comment text. Reject following compound or target-changing commits before inspecting any index. Preserve hashes in filenames and quoted values, including multiline quoted non-commit arguments; do not reinterpret each physical line as an independent command. | P0 |
| REQ-012 | Use shell-specific lexical quote/comment boundaries when detecting literal commit candidates: PowerShell comments immediately after quoted arguments, backtick-escaped quotes and literal Windows backslashes must not hide subsequent literal commits or turn quoted commit text into commands. Preserve recognition through the call operator with literal executable names, and reject unsupported candidates before inspecting any index. Keep Bash quote concatenation unchanged and use the explicitly named shell's lexical mode inside existing literal shell-command wrappers. Do not decode escapes into executable/subcommand names or broaden the standalone allowlist. | P0 |
| REQ-013 | Read staged paths losslessly using NUL-delimited Git output (`--name-only -z`), split only on NUL without trimming or unquoting, and retain the anchored cwd and ACMR filter. Classify exact path prefixes and TypeScript/test suffixes even when filenames contain non-ASCII characters, embedded newlines or whitespace; a newline must neither invent another path nor qualify a filename whose actual suffix is not TypeScript. Verify source-only denial and valid source-plus-test acceptance against real Git indexes in both shells. | P0 |

## Supported command boundary

This is a conservative lexical allowlist, **not a shell parser or a general shell security boundary**. Candidate detection looks for literal `git commit` or `npm run commit` command/subcommand tokens (case-insensitive), including command positions after compound separators and known global target options. Token-boundary `#` line comments are ignored before interpreting their quotes or separators; the following newline remains a command boundary. Quoted argument text is not another command; explicit shell-wrapper command arguments are inspected as command text, never evaluated. Once a commit candidate is found, the existing standalone allowlist below decides whether it may inspect the index. Aliases, dynamically constructed/obfuscated command names, arbitrary shell control flow, other commit tools and indirect script contents are not interpreted.

PowerShell candidate lexing accounts for comments adjoining closed quotes, backtick-escaped characters and backslashes that do not escape quotes. These lexical rules only maintain quote/comment boundaries; they never expand values or decode escaped command keywords. Existing explicit shell wrappers select their named inner shell's mode. Shell-specific block comments, here-strings/documents and escaped or dynamically constructed executable/subcommand syntax remain outside this bounded literal-command policy.

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

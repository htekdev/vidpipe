# GitHub Copilot Hooks: Research & Best Practices for Agent Quality Control

> **Author:** vidpipe team · **Last updated:** July 2025
> **Status:** Living document — update as the hooks API evolves

## Executive Summary

GitHub Copilot CLI hooks are custom shell commands that execute at strategic points during an AI agent's workflow. They provide **deterministic control over probabilistic AI behavior** — the critical distinction being that prompt-based instructions ("don't modify .env") can be ignored under context pressure, while hooks execute unconditionally.

We implemented two hooks for vidpipe: a **pre-push test/coverage gate** and a **post-push review automation** trigger. In the process, we discovered four bugs that illuminate key lessons about the hooks protocol. This document captures what we built, what we learned, and a prioritized roadmap of patterns to implement next.

**Key takeaway:** As agent utilization increases, hooks become the primary mechanism for enforcing quality, security, and architectural standards. They are not optional guardrails — they are load-bearing infrastructure.

---

## 1. What We Built

### Architecture Overview

Our hook system lives in `.github/hooks/` and consists of two hooks with cross-platform implementations:

```
.github/hooks/
├── hooks.json              # Hook configuration (version 1)
├── pre-push-tests.ps1      # Pre-push gate (Windows)
├── pre-push-tests.sh       # Pre-push gate (Unix)
├── post-push-review.ps1    # Post-push automation (Windows)
└── post-push-review.sh     # Post-push automation (Unix)
```

### Configuration

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "type": "command",
        "bash": ".github/hooks/pre-push-tests.sh",
        "powershell": ".github/hooks/pre-push-tests.ps1",
        "cwd": ".",
        "timeoutSec": 120,
        "comment": "Block git push unless tests pass and coverage thresholds are met"
      }
    ],
    "postToolUse": [
      {
        "type": "command",
        "bash": ".github/hooks/post-push-review.sh",
        "powershell": ".github/hooks/post-push-review.ps1",
        "cwd": ".",
        "timeoutSec": 300,
        "comment": "After push, poll for Copilot code review and trigger triage"
      }
    ]
  }
}
```

### Hook 1: Pre-Push Coverage Gate (`preToolUse`)

**Purpose:** Block `git push` unless all tests pass and coverage thresholds are met.

**Flow:**
1. Read JSON from stdin → parse `toolName` and `toolArgs.command`
2. If tool is not `bash`/`powershell` → exit 0 (pass-through)
3. If command doesn't match `git push` → exit 0 (pass-through)
4. Run `npm run test:coverage`
5. Exit code ≠ 0 → output `{"permissionDecision":"deny","permissionDecisionReason":"..."}`
6. Exit code = 0 → output `{"permissionDecision":"allow"}`

**Critical protocol:** The CLI reads **only stdout** for the JSON decision. All status messages go to stderr.

| Output Type | Destination | PowerShell | Bash |
|-------------|-------------|------------|------|
| Status messages | stderr | `[Console]::Error.WriteLine(...)` | `echo "..." >&2` |
| Permission JSON | stdout | `ConvertTo-Json -Compress` | `echo '...' \| jq -c` |

**Error handling:** Both scripts use a **fail-open** pattern — if the hook itself crashes, it exits 0 without a deny decision, so the push proceeds. This prevents hook bugs from blocking developer workflow.

### Hook 2: Post-Push Review Automation (`postToolUse`)

**Intended purpose:** After a successful `git push`, automatically detect and triage Copilot code review comments.

**Flow:**
1. Filter for `bash`/`powershell` tools with `git push` commands
2. Verify `toolResult.resultType == "success"`
3. Find the open PR for the current branch via `gh pr list`
4. Poll the GitHub API for a Copilot review on the latest commit (up to 4 minutes)
5. If unresolved threads found → prompt agent to run `review-triage`

**Status:** Non-functional due to the postToolUse fire-and-forget limitation (see Bug 3 below).

### The JSON Protocol

Hooks communicate with the CLI through a strict JSON protocol:

**Input** (via stdin):
```json
{
  "toolName": "bash",
  "toolArgs": "{\"command\":\"git push origin main\"}"
}
```

> **⚠️ Lesson Learned:** `toolArgs` is a **JSON string**, not an object. It requires double-parsing: first parse the outer object, then parse the `toolArgs` string separately.

**Output** (via stdout — `preToolUse` only):
```json
{"permissionDecision":"deny","permissionDecisionReason":"Tests failed or coverage thresholds not met."}
```

---

## 2. Bugs Found & Lessons Learned

### Bug 1: `npm test` vs `npm run test:coverage`

**Problem:** An earlier version ran `npm test` instead of `npm run test:coverage`. The `npm test` script runs vitest without coverage flags — tests pass/fail, but coverage thresholds are **never checked**. A developer could push code with 0% coverage and the hook would allow it.

**Fix:** Changed to `npm run test:coverage` which runs vitest with `--coverage`, enforcing thresholds from `vitest.config.ts`.

> **⚠️ Lesson Learned:** Always verify that the command you invoke actually checks what you think it checks. The difference between `npm test` and `npm run test:coverage` is invisible unless you read the `package.json` scripts carefully. Hook validation is only as strong as the underlying commands.

### Bug 2: `Write-Host` Stdout Pollution

**Problem:** The PowerShell hook used `Write-Host` for status messages:
```powershell
Write-Host "🧪 Pre-push hook: Running tests..."  # BAD — goes to stdout
```

`Write-Host` writes to PowerShell's information stream, which typically appears on stdout. The CLI sees:
```
🧪 Pre-push hook: Running tests...
{"permissionDecision":"allow"}
```

It tries to parse the **entire stdout** as JSON and fails. Result: the hook output is unparseable and the decision is silently ignored.

**Fix:** Replace all `Write-Host` with `[Console]::Error.WriteLine()`:
```powershell
[Console]::Error.WriteLine("🧪 Pre-push hook: Running tests...")  # GOOD — goes to stderr
```

> **⚠️ Lesson Learned:** In PowerShell hooks, **never use `Write-Host`**. It pollutes stdout and corrupts the JSON protocol. Use `[Console]::Error.WriteLine()` for all informational output. In bash, use `echo "..." >&2`. This is the single most common hook bug — if your hook isn't working, check stdout first.

### Bug 3: `postToolUse` Fire-and-Forget Limitation

**Problem:** The post-push review hook is designed to poll for up to 4 minutes, but the CLI kills the process within ~300ms. The entire polling mechanism, sleep loops, and output are dead code.

**Root cause:** The CLI's `postToolUse` implementation spawns the process but doesn't wait for completion. It's architecturally fire-and-forget — the hook exists for quick side-effects (logging, metrics), not long-running operations.

**Evidence:** Debug logs showed the hook process starting and terminating within ~0.3 seconds, before even the first API call completes. The 300-second `timeoutSec` configuration is irrelevant.

**Impact:** The review-triage automation never triggers automatically. Users must manually invoke `review-triage` after pushing.

> **⚠️ Lesson Learned:** `postToolUse` hooks are only viable for near-instant operations: appending to a log file, incrementing a counter, firing a non-blocking webhook. Any logic that requires waiting, polling, or multi-step processing will be killed before it completes. Design accordingly — or move the logic to a `preToolUse` hook on the *next* action instead.

### Bug 4: PowerShell 5.1 Compatibility

**Problem:** The post-push-review.ps1 script uses features that may not work in Windows PowerShell 5.1 (the default `powershell.exe`), including here-strings with embedded variables and some `ConvertFrom-Json` edge cases.

The Copilot CLI may invoke `powershell.exe` (5.1) rather than `pwsh.exe` (7+) depending on system configuration.

**Impact:** Currently moot because the hook is killed before execution completes (Bug 3), but would surface if the fire-and-forget behavior is ever fixed.

> **⚠️ Lesson Learned:** Always target PowerShell 5.1 as the lowest common denominator on Windows. Avoid here-strings with complex interpolation, use `ConvertFrom-Json` carefully, and test scripts with both `powershell.exe` and `pwsh.exe`. Alternatively, specify the full path to `pwsh.exe` in hooks.json if you require PowerShell 7+ features.

---

## 3. Official Hooks Reference

### Hook Events

| Event | When | Can Block? | Output Read? |
|-------|------|------------|--------------|
| `sessionStart` | Session begins or resumes | No | Ignored |
| `sessionEnd` | Session completes or terminates | No | Ignored |
| `userPromptSubmitted` | User submits a prompt | No | Ignored |
| **`preToolUse`** | **Before a tool executes** | **Yes** | **Parsed for permission** |
| `postToolUse` | After a tool completes | No | Ignored |
| `errorOccurred` | Error during execution | No | Ignored |

### Interceptable Tool Names

| Tool Name | Purpose |
|-----------|---------|
| `bash` / `powershell` | Shell command execution |
| `edit` | Modify file contents |
| `create` | Create a new file |
| `view` | Read file contents |
| `search` | Search files/text (grep, glob) |

MCP server tools use the format `server-name/tool-name` (e.g., `github/get_file_contents`).

### Input Schemas (Key Events)

**preToolUse:**
```json
{
  "timestamp": 1704614600000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"git push origin main\"}"
}
```

**postToolUse** (adds `toolResult`):
```json
{
  "timestamp": 1704614700000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"npm test\"}",
  "toolResult": {
    "resultType": "success",
    "textResultForLlm": "All tests passed (15/15)"
  }
}
```

**sessionStart / sessionEnd:**
```json
{ "timestamp": 1704614400000, "cwd": "/path", "source": "new" }
{ "timestamp": 1704618000000, "cwd": "/path", "reason": "complete" }
```

### Permission Decision Output (preToolUse only)

```json
{"permissionDecision": "deny", "permissionDecisionReason": "Blocked: reason here"}
```

| Decision | Effect |
|----------|--------|
| `"allow"` | Tool proceeds (same as no output) |
| `"deny"` | Tool is blocked; reason shown to agent |
| `"ask"` | Documented but not yet functional |

**Rules:** stdout must contain only the JSON decision. Empty stdout = allow. Non-zero exit code = allow (hook failure ≠ denial). Multiple hooks execute in array order; any deny blocks the operation.

### Hook Definition Schema

```json
{
  "type": "command",
  "bash": "./scripts/my-hook.sh",
  "powershell": "./scripts/my-hook.ps1",
  "cwd": ".",
  "env": { "LOG_LEVEL": "INFO" },
  "timeoutSec": 30,
  "comment": "Human-readable description"
}
```

---

## 4. The Case for Hooks in Agent-Heavy Workflows

### The Core Problem

AI agents are probabilistic systems. Even with perfect prompt engineering:

- Instructions can be **overridden** under context pressure or long conversations
- Agents **optimize for task completion**, not policy compliance
- Agents don't read team wikis, attend standups, or internalize architectural decisions
- Agents will take the shortest path to a solution, even if it violates boundaries

### The Key Insight

> **"Deterministic control over probabilistic AI."**
>
> Prompt instructions are *suggestions* that can be overridden. Hooks are *enforcement* that executes regardless of what the model decides.

This distinction matters more as agent utilization increases. A team running 5 agent sessions per day can afford to review every change manually. A team running 50+ sessions per day cannot — and without automated enforcement, quality erosion is inevitable.

### Real-World Failures Without Hooks

| Incident | What Happened | Hook That Would Prevent It |
|----------|---------------|---------------------------|
| **$30k API key leak** | Agent hardcoded an Azure API key into a markdown file pushed to a public repo | Secret scanning pre-commit hook |
| **Home directory deletion** | Agent ran `rm -rf tests/ patches/ plan/ ~/` — the trailing `~/` destroyed the user's home | Dangerous command blocker |
| **Test gaslighting** | Agent modified tests to pass with incorrect behavior, then defended: "This is how it should work" | Test assertion quality check |
| **Production data wipe** | AI wiped data for 1,200+ users during a code freeze | Production keyword blocker |

### The Scaling Argument

```
Agent sessions/day    Manual review feasible?    Hooks critical?
──────────────────    ───────────────────────    ───────────────
1–5                   ✅ Yes                     Nice to have
5–20                  ⚠️ Partial                 Important
20–50                 ❌ No                      Essential
50+                   ❌ Impossible               Load-bearing infrastructure
```

As vidpipe evolves toward more autonomous pipeline stages, hooks transition from "nice to have" to "the primary quality enforcement mechanism."

---

## 5. Recommended Hook Patterns

### Security Guardrails

#### Secret Scanning Before Commits

**Hook type:** `preToolUse` on `bash` containing `git commit`

Scans staged files for hardcoded secrets, API keys, tokens, and credentials.

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')
echo "$COMMAND" | grep -q "git commit" || exit 0

STAGED=$(git diff --cached --name-only)
for FILE in $STAGED; do
  [ -f "$FILE" ] || continue
  if grep -qEi '(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*[=:]\s*["'"'"'][A-Za-z0-9_\-]{16,}' "$FILE"; then
    jq -n --arg file "$FILE" \
      '{permissionDecision:"deny",permissionDecisionReason:("Hardcoded secret detected in " + $file)}'
    exit 0
  fi
done
```

```powershell
$inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($inputJson.toolName -notin @('bash','powershell')) { exit 0 }
$command = ($inputJson.toolArgs | ConvertFrom-Json).command
if ($command -notmatch 'git commit') { exit 0 }

$staged = git diff --cached --name-only
foreach ($file in $staged) {
    if (Test-Path $file) {
        if (Select-String -Path $file -Pattern '(API_KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*["''][A-Za-z0-9_\-]{16,}' -Quiet) {
            @{ permissionDecision = "deny"; permissionDecisionReason = "Hardcoded secret in $file" } | ConvertTo-Json -Compress
            exit 0
        }
    }
}
```

**Why it matters:** Agents treat all text as content to manipulate. A $30k API key was leaked when an agent hardcoded credentials into a committed file. Deterministic scanning is the only reliable defense.

#### Dangerous Command Blocker

**Hook type:** `preToolUse` on `bash`

Blocks destructive commands: `rm -rf /`, `sudo`, `DROP TABLE`, force pushes to protected branches.

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')

# Block destructive patterns
if echo "$COMMAND" | grep -qE "rm -rf /|rm -rf ~|sudo |mkfs|> /dev/|DROP TABLE|DROP DATABASE"; then
  jq -n '{permissionDecision:"deny",permissionDecisionReason:"Destructive system command blocked."}'
  exit 0
fi

# Block force push to protected branches
if echo "$COMMAND" | grep -qE "git push.*(--force|-f).*(main|master|production)"; then
  jq -n '{permissionDecision:"deny",permissionDecisionReason:"Force push to protected branch blocked."}'
  exit 0
fi
```

**Why it matters:** A user's entire Mac was wiped when an agent ran `rm -rf tests/ patches/ plan/ ~/`. The trailing `~/` destroyed their home directory.

#### Sensitive File Protection

**Hook type:** `preToolUse` on `edit` and `create`

Prevents agents from modifying `.env`, CI/CD configs, deployment manifests, and other protected files.

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[[ "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "create" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')

PROTECTED='\.env$|\.env\.|docker-compose\.prod|\.github/workflows/|Dockerfile\.prod|deploy/|terraform/|secrets/'
if echo "$FILE_PATH" | grep -qE "$PROTECTED"; then
  jq -n --arg f "$FILE_PATH" '{permissionDecision:"deny",permissionDecisionReason:("Protected file: " + $f)}'
  exit 0
fi
```

**Why it matters:** Agents have been documented copying production credentials from `.env` to `.env.example` files that were then committed — even when `.env` was blocked in settings.

---

### Code Quality Gates

#### Type-Check Before Commit

**Hook type:** `preToolUse` on `bash` containing `git commit`

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')
echo "$COMMAND" | grep -q "git commit" || exit 0

npx tsc --noEmit 2>&1 >&2
if [ $? -ne 0 ]; then
  jq -n '{permissionDecision:"deny",permissionDecisionReason:"TypeScript compilation failed. Fix type errors before committing."}'
  exit 0
fi
```

**Why it matters:** Agents frequently introduce type errors in cross-file changes. Catching at commit time prevents broken builds from entering the repository.

#### Build Verification Before Push

**Hook type:** `preToolUse` on `bash` containing `git push`

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')
echo "$COMMAND" | grep -q "git push" || exit 0

npm run build 2>&1 >&2
if [ $? -ne 0 ]; then
  jq -n '{permissionDecision:"deny",permissionDecisionReason:"Build failed. Fix build errors before pushing."}'
  exit 0
fi
```

**Why it matters:** Prevents broken builds from reaching remote branches — critical when agents push autonomously (e.g., vidpipe's `git-push` pipeline stage).

#### Lint-on-Edit Feedback

**Hook type:** `postToolUse` on `edit` and `create`

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
RESULT_TYPE=$(echo "$INPUT" | jq -r '.toolResult.resultType')

if [[ "$TOOL_NAME" =~ ^(edit|create)$ ]] && [ "$RESULT_TYPE" = "success" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')
  if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    npx eslint "$FILE_PATH" --max-warnings=0 2>&1 | tee -a logs/lint-failures.log >&2
  fi
fi
```

**Why it matters:** Catches style drift at the atomic edit level rather than at PR review time.

---

### Architecture Enforcement

#### Module Boundary Enforcement

**Hook type:** `postToolUse` on `edit` and `create`

Prevents cross-layer imports (e.g., `services/` importing from `agents/`, `providers/` importing from `pipeline/`).

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[[ "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "create" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')

# services/ cannot depend on agents/ or pipeline/
if [[ "$FILE_PATH" =~ ^src/services/ ]]; then
  if grep -qE "from ['\"]\.\.\/(agents|pipeline)" "$FILE_PATH" 2>/dev/null; then
    echo "LAYER_VIOLATION: $FILE_PATH imports from agents/ or pipeline/" >> logs/architecture-violations.log
  fi
fi

# providers/ cannot depend on agents/
if [[ "$FILE_PATH" =~ ^src/providers/ ]]; then
  if grep -qE "from ['\"]\.\./agents/" "$FILE_PATH" 2>/dev/null; then
    echo "CIRCULAR_DEP: providers/ importing from agents/" >> logs/architecture-violations.log
  fi
fi
```

**Why it matters:** Agents optimize for making things work, not for maintaining clean dependency graphs. Layer violations create coupling that's expensive to untangle later.

#### File Structure Convention Enforcement

**Hook type:** `preToolUse` on `create`

Ensures new files are created in the correct directories (agents in `src/agents/`, tests use `.test.ts` extension).

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "create" ] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')

if [[ "$FILE_PATH" =~ Agent\.(ts|js)$ ]] && [[ ! "$FILE_PATH" =~ ^src/agents/ ]]; then
  jq -n '{permissionDecision:"deny",permissionDecisionReason:"Agent classes must be created in src/agents/"}'
  exit 0
fi
```

**Why it matters:** Without structure enforcement, projects accumulate organizational debt that makes navigation and maintenance increasingly difficult.

---

### Agent Behavior Control

#### File Modification Allowlist

**Hook type:** `preToolUse` on `edit` and `create`

Restricts modifications to `src/`, `test/`, `docs/`, and `scripts/` directories only.

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[[ "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "create" ]] && exit 0

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path')

if ! echo "$FILE_PATH" | grep -qE "^(src|test|tests|docs|scripts)/"; then
  jq -n --arg f "$FILE_PATH" \
    '{permissionDecision:"deny",permissionDecisionReason:("File " + $f + " is outside allowed directories")}'
  exit 0
fi
```

**Why it matters:** Prevents agents from modifying build configs, CI/CD pipelines, lock files, and infrastructure that should only change intentionally.

#### Commit Message Convention Enforcement

**Hook type:** `preToolUse` on `bash` containing `git commit`

Blocks commits that don't follow conventional commit format (`feat:`, `fix:`, `docs:`, `chore:`).

```bash
#!/bin/bash
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')
[ "$TOOL_NAME" != "bash" ] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')
echo "$COMMAND" | grep -q "git commit" || exit 0

MSG=$(echo "$COMMAND" | grep -oP '(?<=-m ["\x27])[^"\x27]+')
if [ -n "$MSG" ]; then
  if ! echo "$MSG" | grep -qE "^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?: .+"; then
    jq -n '{permissionDecision:"deny",permissionDecisionReason:"Commit must follow conventional format: type(scope): description"}'
    exit 0
  fi
fi
```

**Why it matters:** Consistent commit messages enable automated changelog generation, semantic versioning, and make git history useful for debugging.

---

### Monitoring & Observability

#### Comprehensive Audit Logging

**Hook type:** `postToolUse`

Logs every tool invocation with timestamp, tool name, and result to a structured JSON Lines file.

```bash
#!/bin/bash
INPUT=$(cat)
mkdir -p logs
jq -n \
  --arg ts "$(echo "$INPUT" | jq -r '.timestamp')" \
  --arg tool "$(echo "$INPUT" | jq -r '.toolName')" \
  --arg result "$(echo "$INPUT" | jq -r '.toolResult.resultType')" \
  --arg user "$USER" \
  '{timestamp:$ts,tool:$tool,result:$result,user:$user}' >> logs/agent-audit.jsonl
```

```powershell
$inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
$logDir = "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$entry = @{
    timestamp = $inputJson.timestamp
    tool = $inputJson.toolName
    result = $inputJson.toolResult.resultType
    user = $env:USERNAME
} | ConvertTo-Json -Compress
Add-Content -Path "$logDir\agent-audit.jsonl" -Value $entry
```

**Why it matters:** Without observability, you have no idea what agents are doing. Structured logs enable dashboarding, anomaly detection, and compliance auditing.

#### Session Summary Reports

**Hook type:** `sessionEnd`

Generates a summary of files modified, tools used, and session outcome.

```bash
#!/bin/bash
INPUT=$(cat)
REASON=$(echo "$INPUT" | jq -r '.reason')
mkdir -p logs/sessions
REPORT="logs/sessions/session-$(date +%Y%m%d-%H%M%S).md"

echo "# Agent Session Report" > "$REPORT"
echo "- End reason: $REASON" >> "$REPORT"
echo "- Date: $(date)" >> "$REPORT"
echo "" >> "$REPORT"
echo "## Files Modified" >> "$REPORT"
git diff --name-status HEAD~1 2>/dev/null >> "$REPORT"
```

**Why it matters:** Provides visibility into what agents actually do during sessions, enabling process improvement and identifying inefficiency patterns.

#### Error Alerting

**Hook type:** `errorOccurred`

Logs errors and optionally sends team notifications via webhook.

```bash
#!/bin/bash
INPUT=$(cat)
ERROR_MSG=$(echo "$INPUT" | jq -r '.error.message')
ERROR_NAME=$(echo "$INPUT" | jq -r '.error.name')

echo "$(date): [$ERROR_NAME] $ERROR_MSG" >> logs/agent-errors.log

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"🚨 Agent Error: [$ERROR_NAME] $ERROR_MSG\"}" > /dev/null 2>&1
fi
```

**Why it matters:** When agents run autonomously, the team needs to know about failures immediately — not hours later during review.

---

## 6. Implementation Roadmap

Prioritized hooks to implement for vidpipe, organized by phase.

### Phase 1: Security Essentials (Week 1)

| Hook | Type | Trigger | Timeout |
|------|------|---------|---------|
| **Secret scanning** | `preToolUse` | `git commit` | 15s |
| **Dangerous command blocker** | `preToolUse` | All `bash` | 5s |
| **Sensitive file protection** | `preToolUse` | `edit`, `create` | 5s |
| **Audit logging** | `postToolUse` | All tools | 5s |

**Rationale:** These are non-negotiable safety nets. They add minimal latency (5–15s) and prevent catastrophic failures. The audit log provides the observability foundation for all future hooks.

### Phase 2: Quality Gates (Week 2–3)

| Hook | Type | Trigger | Timeout |
|------|------|---------|---------|
| **Type-check before commit** | `preToolUse` | `git commit` | 60s |
| **Build verification before push** | `preToolUse` | `git push` | 120s |
| **Commit message validation** | `preToolUse` | `git commit` | 5s |
| **Lint-on-edit feedback** | `postToolUse` | `edit`, `create` | 15s |

**Rationale:** Prevents broken code from reaching the repository. The type-check and build gates add significant latency but are worth it for the safety guarantee. Lint-on-edit runs as `postToolUse` so it logs warnings without blocking.

### Phase 3: Architecture Enforcement (Week 4)

| Hook | Type | Trigger | Timeout |
|------|------|---------|---------|
| **Module boundary enforcement** | `postToolUse` | `edit`, `create` | 10s |
| **File structure conventions** | `preToolUse` | `create` | 5s |
| **Import restriction check** | `postToolUse` | `edit`, `create` | 10s |

**Rationale:** Prevents architectural drift that compounds over time. Start with `postToolUse` (logging violations) and escalate to `preToolUse` (blocking) after validating the rules produce no false positives.

### Phase 4: Full Observability (Week 5–6)

| Hook | Type | Trigger | Timeout |
|------|------|---------|---------|
| **Session summary reports** | `sessionEnd` | Session end | 30s |
| **Error alerting** | `errorOccurred` | Errors | 10s |
| **File touch frequency tracking** | `postToolUse` | `edit` | 5s |
| **Quality scorecard generation** | `sessionEnd` | Session end | 30s |

**Rationale:** Builds the data foundation for measuring agent quality trends over time. "What gets measured gets managed."

### Design Principles for Implementation

1. **Start with warnings, escalate to blocks.** Use logging hooks first, validate patterns produce no false positives, then promote to blocking hooks.
2. **Keep hooks fast.** Target under 5 seconds for most hooks. Reserve long timeouts (60–120s) for commit/push gates only.
3. **Log everything, block selectively.** Observability hooks should capture every invocation. Blocking hooks should be narrow and precise.
4. **Multiple hooks compose.** Define separate hooks for security, quality, and architecture — they execute in order, and any deny blocks the operation.
5. **Fail open.** Hook crashes should never block developer workflow.

---

## 7. Known Limitations & Workarounds

### `postToolUse` is Fire-and-Forget

**Limitation:** The CLI kills `postToolUse` hook processes almost immediately (~300ms). Long-running operations like API polling, complex analysis, or anything requiring sleep/wait are not viable.

**Workaround:** Keep `postToolUse` hooks to near-instant operations: file appends, counter increments, non-blocking webhooks. For complex post-action logic, use a `preToolUse` hook on the *next* expected action instead.

### No Result Modification

**Limitation:** `postToolUse` hooks cannot modify tool results. You can observe what happened but can't change the output the agent sees.

**Workaround:** Use `postToolUse` for logging/alerting, and `preToolUse` to prevent problematic operations before they happen.

### No Prompt Modification

**Limitation:** `userPromptSubmitted` hooks cannot modify the user's prompt before the agent processes it.

**Workaround:** Use `sessionStart` hooks to set up environment context (files, env vars) that influence agent behavior indirectly.

### `"ask"` Permission Decision Not Functional

**Limitation:** The `"ask"` value for `permissionDecision` is documented but not yet processed by the CLI. Only `"deny"` actively blocks tool execution.

**Workaround:** Use `"deny"` with a clear reason message that tells the agent what to do differently.

### No Inter-Hook Communication

**Limitation:** No built-in mechanism to pass data between hooks. Each hook is an isolated process.

**Workaround:** Use the filesystem as shared state — write to a temp file in one hook, read it in another. Use a well-known path like `.hook-state/` for transient data.

### Synchronous Blocking

**Limitation:** All hooks run synchronously and block agent execution. Slow hooks degrade the agent's responsiveness.

**Workaround:** Keep most hooks under 5 seconds. Use async I/O (background `curl`, file append) for observability hooks. Cache expensive computations.

### Platform Differences

**Limitation:** Must provide both `bash` and `powershell` scripts for cross-platform support. JSON handling differs between platforms.

**Workaround:** Use `jq -c` on Unix and `ConvertTo-Json -Compress` on Windows. Test on both platforms. Consider a Node.js script as a single cross-platform implementation if the hook is complex.

### No Conversation Context Access

**Limitation:** Hook scripts cannot access the LLM conversation history or context window.

**Workaround:** Hooks receive the current tool invocation details, which is sufficient for most validation. For broader context, use file-based state accumulated across hooks.

---

## 7.5 CodeQL & Advanced Static Analysis (Local)

### What CodeQL Does

CodeQL is GitHub's semantic code analysis engine. Unlike pattern-matching linters, it builds a **relational database** of your source code (AST, data flow, control flow) and runs declarative queries against it. For JavaScript/TypeScript, the `codeql/javascript-queries` pack covers **166+ CWEs** in the default suite including injection (CWE-78/79/89), path traversal (CWE-22), prototype pollution, regex DoS, and insecure randomness. The `security-extended` suite adds 135 more queries (35 additional CWEs). This depth far exceeds what pattern-matching tools can detect.

### Local Setup

```bash
# Install (macOS/Linux via Homebrew, or download bundle from GitHub releases)
brew install --cask codeql
# Windows: download from https://github.com/github/codeql-cli-binaries/releases

# Create database for a JS/TS project (no build command needed — interpreted language)
codeql database create ./codeql-db --language=javascript --threads=0  # 0 = all cores

# Run the default security suite
codeql database analyze ./codeql-db codeql/javascript-queries --format=sarif-latest --output=results.sarif

# Or run security-extended for broader coverage
codeql database analyze ./codeql-db codeql/javascript-queries:codeql-suites/javascript-security-extended.qls \
  --format=sarif-latest --output=results.sarif
```

### Why It's Impractical as a Pre-Push Hook

Database creation for JS/TS projects takes **30 seconds to 5+ minutes** depending on codebase size, even with `--threads=0`. Analysis adds another 30–120 seconds on top. For vidpipe (~50 TS source files), expect **~45–90 seconds total** — too slow for a synchronous `preToolUse` hook that blocks every `git push`. Large JS/TS codebases (8,000+ files) have reported CodeQL runs exceeding 90 minutes. The `--threads` flag helps but database creation has single-threaded bottlenecks. This makes CodeQL unsuitable for the synchronous, fast-feedback loop hooks require.

### Recommended Approach: Layered Analysis

**1. Pre-push hook — lightweight ESLint security plugins (~2–5 seconds):**

```jsonc
// .eslintrc.json additions
{
  "plugins": ["@microsoft/sdl", "security"],
  "extends": [
    "plugin:@microsoft/sdl/required",   // Microsoft SDL rules (XSS, eval, innerHTML)
    "plugin:security/recommended"        // detect-child-process, detect-non-literal-regexp, etc.
  ]
}
```

Alternatives: [`eslint-plugin-secure-coding`](https://www.npmjs.com/package/eslint-plugin-secure-coding) (27 rules, OWASP Top 10 mapped, actively maintained) or [Semgrep](https://semgrep.dev/) with `semgrep --config p/javascript` (runs in ~5–10 seconds, 1,000+ community rules).

**2. `sessionEnd` hook — CodeQL as fire-and-forget background analysis:**

The `sessionEnd` event fires when the Copilot CLI session closes. Since no user is waiting for feedback, latency is irrelevant — perfect for deep analysis.

**3. CI/CD — keep CodeQL in GitHub Actions (the default and best-supported path):**

GitHub Advanced Security runs CodeQL on every PR automatically. Local hooks should complement CI, not replace it. Use hooks for fast checks; use CI for thorough analysis.

### Implementation: ESLint Security Pre-Push Hook

```powershell
# .github/hooks/pre-push-security.ps1
$toolName = $env:COPILOT_HOOK_TOOL_NAME
if ($toolName -ne "push" -and $toolName -ne "git_push") { exit 0 }

$result = npx eslint --no-warn-ignored --plugin @microsoft/sdl --plugin security `
  --rule '@microsoft/sdl/no-inner-html: error' `
  --rule 'security/detect-child-process: warn' `
  src/ 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Output '{"decision":"REJECT","message":"Security lint failed. Fix issues before pushing."}'
    exit 0
}
Write-Output '{"decision":"APPROVE"}'
```

### Implementation: sessionEnd CodeQL Background Analysis

```powershell
# .github/hooks/session-end-codeql.ps1
# Fire-and-forget: start CodeQL in background, log results for later review
$repoRoot = git rev-parse --show-toplevel
$dbPath = Join-Path $repoRoot ".codeql-db"
$outPath = Join-Path $repoRoot "codeql-results.sarif"

Start-Process -NoNewWindow -FilePath "codeql" -ArgumentList @(
    "database", "create", $dbPath, "--language=javascript", "--threads=0",
    "--overwrite", "--source-root=$repoRoot"
) -Wait

Start-Process -NoNewWindow -FilePath "codeql" -ArgumentList @(
    "database", "analyze", $dbPath, "codeql/javascript-queries",
    "--format=sarif-latest", "--output=$outPath", "--threads=0"
)
# Results written to codeql-results.sarif for developer review
```

> **Bottom line:** Use ESLint security plugins in pre-push hooks for instant feedback (2–5s). Reserve CodeQL for `sessionEnd` background runs or CI/CD where its 1–5 minute runtime is acceptable. This gives you both fast developer feedback and deep semantic analysis without blocking the agent workflow.

---

## 8. References

### Official Documentation

| Resource | URL |
|----------|-----|
| Hooks Configuration Reference | https://docs.github.com/en/copilot/reference/hooks-configuration |
| Using Hooks (CLI) | https://docs.github.com/en/copilot/how-tos/copilot-cli/use-hooks |
| About Hooks (Concepts) | https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks |
| Using Hooks (Coding Agent) | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks |
| Custom Agents Configuration | https://docs.github.com/en/copilot/reference/custom-agents-configuration |

### Community Resources

| Resource | Key Insight |
|----------|-------------|
| [paddo.dev: Guardrails That Actually Work](https://paddo.dev/blog/claude-code-hooks-guardrails/) | Real-world failure stories ($30k key leak, home directory nuke), hookify plugin |
| [dev.to: Guardrails on AI Coding Assistants](https://dev.to/rajeshroyal/hooks-how-to-put-guardrails-on-your-ai-coding-assistant-4gak) | "Deterministic control over probabilistic AI" framework |
| [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) | Community repository (2.3k stars) with curated hook patterns |
| [GitHub Blog: Agentic Security Principles](https://github.blog/ai-and-ml/github-copilot/how-githubs-agentic-security-principles-make-our-ai-agents-as-secure-as-possible/) | GitHub's security principles for AI agents |

### Feature Requests to Watch

| Issue | Request |
|-------|---------|
| [#1138](https://github.com/github/copilot-cli/issues/1138) | `preCompact` hook event — fire before token compaction for context re-injection |
| [#971](https://github.com/github/copilot-cli/issues/971) | Notification hooks system |
| [#688](https://github.com/github/copilot-cli/issues/688) | Shell config sourcing (`BASH_ENV`/`.bashrc`) |

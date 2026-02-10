#!/bin/bash
# Copilot Hook: Block git push unless code has been reviewed
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

# Only intercept bash/powershell commands
if [ "$TOOL_NAME" != "bash" ] && [ "$TOOL_NAME" != "powershell" ]; then
  exit 0
fi

# Check if the command contains 'git push'
COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command // empty')
if [ -z "$COMMAND" ]; then
  exit 0
fi

if ! echo "$COMMAND" | grep -q "git push"; then
  exit 0
fi

echo "🔍 Pre-push hook: Checking code review status..." >&2

# Get HEAD commit — all git output to stderr
HEAD_COMMIT=$(git rev-parse HEAD 2>/dev/null)
if [ $? -ne 0 ]; then
  echo "⚠️ Failed to get HEAD commit. Allowing push (fail-open)." >&2
  exit 0
fi

# Read .github/review.json
REVIEW_PATH=".github/review.json"
if [ ! -f "$REVIEW_PATH" ]; then
  echo "❌ No .github/review.json found. Blocking push." >&2
  echo '{"permissionDecision":"deny","permissionDecisionReason":"No .github/review.json found. Run the code-reviewer agent first."}' | jq -c
  exit 0
fi

LAST_REVIEWED=$(jq -r '.lastReviewedCommit' "$REVIEW_PATH" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$LAST_REVIEWED" ] || [ "$LAST_REVIEWED" = "null" ]; then
  echo "⚠️ Failed to parse review.json. Allowing push (fail-open)." >&2
  exit 0
fi

if [ "$HEAD_COMMIT" = "$LAST_REVIEWED" ]; then
  echo "✅ Code review is current (HEAD matches last reviewed commit)." >&2
  echo '{"permissionDecision":"allow"}' | jq -c
else
  # Check if the ONLY changes since the reviewed commit are to .github/review.json.
  # This handles the chicken-and-egg: reviewing creates a commit that updates
  # review.json, which changes HEAD.
  CHANGED_FILES=$(git diff --name-only "$LAST_REVIEWED" HEAD 2>/dev/null)
  DIFF_EXIT=$?

  if [ $DIFF_EXIT -eq 0 ] && [ "$CHANGED_FILES" = ".github/review.json" ]; then
    echo "✅ Code review is current (only review.json changed since last review)." >&2
    echo '{"permissionDecision":"allow"}' | jq -c
  else
    echo "❌ Code review required. HEAD $HEAD_COMMIT has not been reviewed (last reviewed: $LAST_REVIEWED). Blocking push." >&2
    jq -nc --arg head "$HEAD_COMMIT" --arg reviewed "$LAST_REVIEWED" \
      '{"permissionDecision":"deny","permissionDecisionReason":"Code review required. HEAD commit \($head) has not been reviewed (last reviewed: \($reviewed)). Use the code-reviewer agent to review changes before pushing."}'
  fi
fi

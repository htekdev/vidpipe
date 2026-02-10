#!/bin/bash
# Copilot Hook: Block git push unless code has been reviewed
{
  INPUT=$(cat)
  TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

  if [ "$TOOL_NAME" != "bash" ] && [ "$TOOL_NAME" != "powershell" ]; then
    exit 0
  fi

  COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command // empty')
  if [ -z "$COMMAND" ]; then
    exit 0
  fi

  if ! echo "$COMMAND" | grep -q "git push"; then
    exit 0
  fi

  echo "Pre-push hook: Checking for .github/reviewed.md..." >&2

  if [ -f ".github/reviewed.md" ]; then
    echo "Code review marker found. Allowing push." >&2
    echo '{"permissionDecision":"allow"}'
  else
    echo "Code review required. .github/reviewed.md not found." >&2
    echo '{"permissionDecision":"deny","permissionDecisionReason":"Code review required. Run the code-reviewer agent before pushing. (.github/reviewed.md not found)"}'
  fi
} || {
  echo "Pre-push hook error. Allowing push (fail-open)." >&2
  exit 0
}

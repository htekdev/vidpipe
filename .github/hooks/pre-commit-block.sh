#!/bin/bash
# Copilot Hook: Block git commit -- must use npm run commit instead
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

  # Match git commit but not npm run commit
  if ! echo "$COMMAND" | grep -qE 'git\s+(--\S+\s+)*commit'; then
    exit 0
  fi

  if echo "$COMMAND" | grep -q "npm run commit"; then
    exit 0
  fi

  echo "Block: Direct git commit is blocked. Use 'npm run commit' instead." >&2
  echo '{"permissionDecision":"deny","permissionDecisionReason":"Direct git commit is blocked. Use `npm run commit -- -m \"message\"` instead -- it enforces test tier coverage and changed-line coverage before committing."}'
} || {
  echo "Pre-commit-block hook error. Allowing (fail-open)." >&2
  exit 0
}

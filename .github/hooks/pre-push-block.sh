#!/bin/bash
# Copilot Hook: Block git push — must use npm run push instead
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

  echo "🚫 Direct git push is blocked. Use 'npm run push' instead." >&2
  echo '{"permissionDecision":"deny","permissionDecisionReason":"Direct git push is blocked. Use `npm run push` instead — it runs typecheck, tests, coverage, build, pushes, and polls PR gates (CodeQL + Copilot review)."}'
} || {
  echo "Pre-push-block hook error. Allowing (fail-open)." >&2
  exit 0
}

#!/bin/bash
# Copilot Hook: Block git push unless tests and coverage pass
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

echo "🧪 Pre-push hook: Running tests with coverage..." >&2

# Run tests with coverage
npm test 2>&1
TEST_EXIT=$?

if [ $TEST_EXIT -ne 0 ]; then
  echo '{"permissionDecision":"deny","permissionDecisionReason":"❌ Tests failed. Fix failing tests before pushing."}' | jq -c
  exit 0
fi

echo "✅ All tests passed with coverage thresholds met." >&2
echo '{"permissionDecision":"allow"}' | jq -c

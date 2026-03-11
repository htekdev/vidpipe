#!/bin/bash
# Copilot Hook: Block git push --force / --force-with-lease

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')

if [ "$TOOL_NAME" != "bash" ] && [ "$TOOL_NAME" != "powershell" ]; then
    exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .command // empty')

if [ -z "$COMMAND" ]; then
    exit 0
fi

if ! echo "$COMMAND" | grep -qE 'git\s+(--\S+\s+)*push\s+.*(--force|--force-with-lease|-f\b)'; then
    exit 0
fi

echo "🚫 Force push is blocked. Create a new commit to fix issues instead of rewriting history." >&2
echo '{"permissionDecision":"deny","permissionDecisionReason":"Force pushing rewrites remote history and breaks collaborators. Create a new fixup commit instead."}'

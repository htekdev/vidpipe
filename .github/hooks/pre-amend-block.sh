#!/bin/bash
# Copilot Hook: Block git commit --amend when HEAD is already pushed

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')

if [ "$TOOL_NAME" != "bash" ] && [ "$TOOL_NAME" != "powershell" ]; then
    exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .command // empty')

if [ -z "$COMMAND" ]; then
    exit 0
fi

if ! echo "$COMMAND" | grep -qE 'git\s+(--\S+\s+)*commit\s+.*--amend'; then
    exit 0
fi

# Check if HEAD has been pushed to the tracking remote branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ -z "$BRANCH" ]; then
    exit 0
fi

REMOTE=$(git config "branch.$BRANCH.remote" 2>/dev/null)
if [ -z "$REMOTE" ]; then
    # No tracking remote — amend is safe
    exit 0
fi

LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)
REMOTE_SHA=$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null)
if [ -z "$REMOTE_SHA" ]; then
    # Remote branch doesn't exist yet — amend is safe
    exit 0
fi

# If local HEAD is an ancestor of (or equal to) the remote, it's been pushed
MERGE_BASE=$(git merge-base "$LOCAL_SHA" "$REMOTE_SHA" 2>/dev/null)
if [ "$MERGE_BASE" = "$LOCAL_SHA" ]; then
    echo "🚫 Cannot amend: HEAD (${LOCAL_SHA:0:7}) is already pushed to $REMOTE/$BRANCH. Create a new commit instead." >&2
    echo '{"permissionDecision":"deny","permissionDecisionReason":"Amending a pushed commit causes force-push conflicts. Create a new fixup commit instead."}'
    exit 0
fi

exit 0

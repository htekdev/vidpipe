#!/bin/bash
# Copilot Hook: Invalidate code review when code changes
# postToolUse — fires after edit/create tools complete
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

# Only trigger on file-modifying tools
if [ "$TOOL_NAME" != "edit" ] && [ "$TOOL_NAME" != "create" ]; then
  exit 0
fi

# Don't invalidate when the reviewer itself is writing reviewed.md or debt.md
FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.path // empty')
case "$FILE_PATH" in
  *reviewed.md|*debt.md) exit 0 ;;
esac

# Delete reviewed.md to invalidate the review
REVIEWED_PATH=".github/reviewed.md"
if [ -f "$REVIEWED_PATH" ]; then
  rm -f "$REVIEWED_PATH"
  echo "🔄 Code changed — review invalidated (.github/reviewed.md deleted)" >&2
fi

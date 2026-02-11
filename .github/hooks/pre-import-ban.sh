#!/usr/bin/env bash
# Copilot Hook: Block non-relative imports outside src/core/

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')

if [[ "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "create" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .path // empty')
if [[ -z "$FILE_PATH" ]]; then exit 0; fi

# Normalize path
NORM_PATH=$(echo "$FILE_PATH" | tr '\\' '/')

# Exempt: core/, __tests__/, cicd/
if echo "$NORM_PATH" | grep -qE '(src/core/|__tests__/|cicd/)'; then
  exit 0
fi

# Only check .ts/.js files
if ! echo "$NORM_PATH" | grep -qE '\.(ts|js|tsx|jsx)$'; then
  exit 0
fi

# Get content
if [[ "$TOOL_NAME" == "edit" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .new_str // empty')
elif [[ "$TOOL_NAME" == "create" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .file_text // empty')
fi

if [[ -z "$CONTENT" ]]; then exit 0; fi

# Check for non-relative imports
MATCH=$(echo "$CONTENT" | grep -oP "from\s+['\"]([^.][^'\"]*)['\"]" | head -1)
if [[ -n "$MATCH" ]]; then
  SPEC=$(echo "$MATCH" | grep -oP "(?<=['\"])[^'\"]+")
  echo "Blocked non-relative import: '$SPEC' in $FILE_PATH" >&2
  echo "{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Non-relative import 'from \\\"$SPEC\\\"' is not allowed outside src/core/. Import from a core/ module instead.\"}"
  exit 0
fi

MATCH=$(echo "$CONTENT" | grep -oP "require\(['\"]([^.][^'\"]*)['\"]" | head -1)
if [[ -n "$MATCH" ]]; then
  SPEC=$(echo "$MATCH" | grep -oP "(?<=['\"])[^'\"]+")
  echo "Blocked non-relative require: '$SPEC' in $FILE_PATH" >&2
  echo "{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Non-relative require('$SPEC') is not allowed outside src/core/. Import from a core/ module instead.\"}"
  exit 0
fi

exit 0

#!/usr/bin/env bash
# Copilot Hook: Block cross-layer re-exports (L0–L7 architecture)
#
# Cross-layer re-exports (`export { foo } from '../../L{N}-...'`) bypass the
# layer boundary and hide the real dependency. This hook enforces that re-exports
# only reference the same layer — cross-layer access must use wrapper functions.
#
# Exemptions:
#   - `export type { ... }` re-exports (type-only re-exports from any layer)
#   - Same-layer re-exports (target layer == source layer)
#   - Third-party/builtin re-exports (no /L{digit}-/ in path)
#   - Test files (__tests__/) — tests are exempt
#   - Non-source files (only checks src/L{digit}-*)
#
# Multi-line exports (`export {\n  foo\n} from '...'`) are handled by
# flattening content before regex extraction.

set -euo pipefail

deny() {
  echo "{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$1\"}"
  exit 0
}

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName // empty')

if [[ "$TOOL_NAME" != "edit" && "$TOOL_NAME" != "create" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .path // empty')
if [[ -z "$FILE_PATH" ]]; then exit 0; fi

# Normalize path
NORM_PATH=$(echo "$FILE_PATH" | tr '\\' '/')

# Only check .ts/.js files
if ! echo "$NORM_PATH" | grep -qE '\.(ts|js)$'; then
  exit 0
fi

# Exempt test files
if echo "$NORM_PATH" | grep -q '__tests__/'; then
  exit 0
fi

# Extract source layer from file path: src/L(\d)-
SOURCE_LAYER=$(echo "$NORM_PATH" | grep -oP '(?<=src/L)\d(?=-)' | head -1)
if [[ -z "$SOURCE_LAYER" ]]; then exit 0; fi

# Get content
if [[ "$TOOL_NAME" == "edit" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .new_str // empty')
elif [[ "$TOOL_NAME" == "create" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .file_text // empty')
fi

if [[ -z "$CONTENT" ]]; then exit 0; fi

DENY_MSG="Cross-layer re-exports are not allowed. Instead of re-exporting from L%s, create a wrapper function that calls the inner function. Wrappers provide a real seam for testing, logging, and future business logic."

# Flatten content to handle multi-line export { ... } from '...'
FLAT_CONTENT=$(printf '%s' "$CONTENT" | tr '\n' ' ')

# Quick bail: no export/from pattern at all
if ! echo "$FLAT_CONTENT" | grep -qE 'export\s.*from\s'; then
  exit 0
fi

# Remove type-only re-exports before matching (export type { ... } from '...')
# Replace 'export type {' with a neutral token so it won't match
CLEANED=$(echo "$FLAT_CONTENT" | sed -E 's/export\s+type\s+\{/EXTYPE_SKIP{/g')

# Pattern 1: export { ... } from '...' or "..."
NAMED_PATHS=$(echo "$CLEANED" | grep -oP "export\s+\{[^}]*\}\s*from\s+['\"]\\K[^'\"]+" || true)

# Pattern 2: export * from '...' or "..."
STAR_PATHS=$(echo "$CLEANED" | grep -oP "export\s+\*\s+from\s+['\"]\\K[^'\"]+" || true)

# Combine all re-export paths
ALL_PATHS=$(printf '%s\n%s' "$NAMED_PATHS" "$STAR_PATHS" | grep -v '^$' || true)

if [[ -z "$ALL_PATHS" ]]; then exit 0; fi

while IFS= read -r IMPORT_PATH; do
  # Only check paths that reference a layer folder
  TARGET_LAYER=$(echo "$IMPORT_PATH" | grep -oP '(?<=/L)\d(?=-)' | head -1 || true)
  if [[ -z "$TARGET_LAYER" ]]; then continue; fi

  # Cross-layer re-export detected
  if [[ "$TARGET_LAYER" != "$SOURCE_LAYER" ]]; then
    REASON=$(printf "$DENY_MSG" "$TARGET_LAYER")
    echo "Re-export violation: $REASON ($FILE_PATH)" >&2
    deny "$REASON"
  fi
done <<< "$ALL_PATHS"

exit 0

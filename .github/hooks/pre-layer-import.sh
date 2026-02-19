#!/usr/bin/env bash
# Copilot Hook: Enforce strict layer import boundaries (L0–L7)
#
# Rules enforced:
#   1. STRICT LAYER IMPORTS — Each layer has an explicit set of allowed imports:
#      L0: self only       L1: L0           L2: L0, L1       L3: L0, L1, L2
#      L4: L0, L1, L3      L5: L0, L1, L4   L6: L0, L1, L5   L7: L0, L1, L3, L6
#   2. L0 BUILTIN BAN — L0-pure cannot import Node.js builtins (node:*, fs, path, etc.)
#   3. DYNAMIC IMPORTS — import('...') follows the same rules as static imports
#
# Exemptions:
#   - `import type ...` statements (type-only imports from any layer)
#   - `export type { ... }` re-exports (type-only re-exports from any layer)
#   - Test files (__tests__/) — tests can import from any layer
#
# Known limitations:
#   - Multi-line imports: `from '...'` on a separate line from `import type` is not recognized as type-only
#   - Inline type annotations: `import { type Foo }` is NOT exempted — use `import type { Foo }` instead

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

# Exempt test files — tests can import from any layer
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

# Node.js builtins that L0 cannot import
NODE_BUILTINS="assert|buffer|child_process|cluster|console|crypto|dgram|dns|events|fs|http|http2|https|net|os|path|perf_hooks|process|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib"

deny_with_reason() {
  local reason="$1"
  echo "$reason ($FILE_PATH)" >&2
  echo "{\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$reason\"}"
  exit 0
}

# Check a single import path against layer rules
check_import_path() {
  local import_path="$1"

  # Rule: L0 cannot import Node.js builtins
  if [[ "$SOURCE_LAYER" -eq 0 ]]; then
    if echo "$import_path" | grep -qE '^node:'; then
      deny_with_reason "Layer violation: L0-pure cannot import Node.js builtins ('$import_path'). L0 must be pure — no I/O."
    fi
    if echo "$import_path" | grep -qE "^($NODE_BUILTINS)(/|$)"; then
      deny_with_reason "Layer violation: L0-pure cannot import Node.js builtin '$import_path'. L0 must be pure — no I/O."
    fi
  fi

  # Only check imports that reference a layer folder
  local target_layer
  target_layer=$(echo "$import_path" | grep -oP '(?<=/L)\d(?=-)' | head -1)
  if [[ -z "$target_layer" ]]; then return 0; fi

  # Strict layer import rules (L0/L1 are foundation, accessible from any layer above them)
  local allowed=""
  case "$SOURCE_LAYER" in
    0) allowed="" ;;
    1) allowed="0" ;;
    2) allowed="0 1" ;;
    3) allowed="0 1 2" ;;
    4) allowed="0 1 3" ;;
    5) allowed="0 1 4" ;;
    6) allowed="0 1 5" ;;
    7) allowed="0 1 3 6" ;;
    *) allowed="" ;;
  esac

  local is_allowed=0
  for a in $allowed; do
    if [[ "$target_layer" -eq "$a" ]]; then
      is_allowed=1
      break
    fi
  done

  if [[ "$is_allowed" -eq 0 ]]; then
    local allowed_str
    if [[ -z "$allowed" ]]; then
      allowed_str="self only"
    else
      allowed_str=$(echo "$allowed" | sed 's/\([0-9]\)/L\1/g' | sed 's/ /, /g')
    fi
    deny_with_reason "Layer violation: L${SOURCE_LAYER} cannot import from L${target_layer}. L${SOURCE_LAYER} may only import: ${allowed_str}."
  fi
}

# Check each line for layer violations
while IFS= read -r line; do
  # Skip type-only imports: import type { ... }, import type Foo, import type * as Foo
  if echo "$line" | grep -qE '^\s*import\s+type\s+'; then
    continue
  fi

  # Skip type-only re-exports: export type { ... } from '...'
  if echo "$line" | grep -qE '^\s*export\s+type\s+\{'; then
    continue
  fi

  # Check static imports and re-exports: from 'something' or from "something"
  IMPORT_PATH=$(echo "$line" | grep -oP "from\s+['\"]\\K[^'\"]+")
  if [[ -n "$IMPORT_PATH" ]]; then
    check_import_path "$IMPORT_PATH"
  fi

  # Check dynamic imports: import('something') or import("something")
  DYN_PATH=$(echo "$line" | grep -oP "import\(['\"]\\K[^'\"]+")
  if [[ -n "$DYN_PATH" ]]; then
    check_import_path "$DYN_PATH"
  fi
done <<< "$CONTENT"

exit 0

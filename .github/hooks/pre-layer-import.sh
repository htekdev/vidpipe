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

# Scenario-specific guidance for each (source, target) layer pair
get_guidance() {
  local src="$1"
  local tgt="$2"
  case "${src}_${tgt}" in
    0_*) echo "This code has dependencies, so it doesn't belong in L0-pure. Move it to the layer that matches what it imports." ;;
    1_2) echo "L1 wraps Node.js builtins only. If this code calls an external API or spawns a process, it belongs in L2-clients, not L1." ;;
    1_3) echo "This code has service dependencies — it's placed too low. Move it to the layer that matches its dependencies." ;;
    1_4) echo "This code has agent dependencies — it's placed too low. Move it to the layer that matches its dependencies." ;;
    1_5) echo "This code has asset dependencies — it's placed too low. Move it to the layer that matches its dependencies." ;;
    1_6) echo "This code has pipeline dependencies — it's placed too low. Move it to the layer that matches its dependencies." ;;
    1_7) echo "This code has app dependencies — it's placed too low. Move it to the layer that matches its dependencies." ;;
    2_3) echo "L2 is for thin client wrappers with no business logic. If you're adding orchestration or business rules, this function belongs in L3-services." ;;
    2_4) echo "This code depends on agents — it's placed too low. The function likely belongs in a higher layer." ;;
    2_5) echo "This code depends on assets — it's placed too low. The function likely belongs in a higher layer." ;;
    2_6) echo "This code depends on pipeline — it's placed too low. The function likely belongs in a higher layer." ;;
    2_7) echo "This code depends on app — it's placed too low. The function likely belongs in a higher layer." ;;
    3_4) echo "Services cannot use agents. If you need agent logic in L3, the function in L4 is probably misplaced — consider moving it down to L3 as a service function." ;;
    3_5) echo "Services cannot use assets. If you need this functionality in L3, the code in L5 may be placed wrong — consider refactoring it down to L3." ;;
    3_6) echo "This code depends on pipeline — it's placed too low. Consider whether the function belongs in a higher layer." ;;
    3_7) echo "This code depends on app — it's placed too low. Consider whether the function belongs in a higher layer." ;;
    4_2) echo "Agents cannot import clients directly. Create or use an L3-services wrapper function (not a re-export) to expose the L2 client functionality. If no L3 service exists for this client yet, create one." ;;
    4_5) echo "Agents cannot import assets. If you need this asset logic in L4, the function in L5 may be placed wrong — consider moving it down to L4 or L3." ;;
    4_6) echo "Agents cannot import pipeline. If you need pipeline logic in an agent, the function in L6 may be placed wrong — consider moving it to L3-services." ;;
    4_7) echo "Agents cannot import app. This function is misplaced — consider restructuring." ;;
    5_2) echo "Assets cannot import clients. Use an L4 bridge module (videoServiceBridge, analysisServiceBridge, pipelineServiceBridge). If no bridge exists for this client, create one in L4." ;;
    5_3) echo "Assets cannot import services directly. Use an L4 bridge module that wraps the needed service. If the bridge doesn't expose what you need, extend it." ;;
    5_6) echo "Assets cannot import pipeline. If you need pipeline functionality in L5, the function in L6 likely belongs in L5 instead." ;;
    5_7) echo "Assets cannot import app. This function is misplaced — consider restructuring." ;;
    6_2) echo "Pipeline cannot import clients. Access through L5 asset methods. If the asset doesn't expose what you need, add a method to the asset or extend a bridge." ;;
    6_3) echo "Pipeline cannot import services. Access through L5 asset methods. If the service isn't available via L5, add an L5 loader or extend a bridge module." ;;
    6_4) echo "Pipeline cannot import agents. Access through L5 asset methods and loaders. If the agent isn't exposed via L5, add a loader in L5/loaders.ts." ;;
    6_7) echo "Pipeline cannot import app. If you need this app logic in pipeline, the function in L7 likely belongs in L6 or lower." ;;
    7_2) echo "App cannot import clients directly. Create or use an L3-services wrapper function (not a re-export). If no L3 service exists for this client, create one." ;;
    7_4) echo "App cannot import agents. Access through L6-pipeline. If you need agent logic outside the pipeline, the function may belong in L3-services instead of L4." ;;
    7_5) echo "App cannot import assets. Access through L6-pipeline. If you need asset data outside the pipeline, the function in L5 may be placed wrong." ;;
    *) ;;
  esac
}

# Check a single import path against layer rules
check_import_path() {
  local import_path="$1"

  # Rule: L0 cannot import Node.js builtins
  if [[ "$SOURCE_LAYER" -eq 0 ]]; then
    if echo "$import_path" | grep -qE '^node:'; then
      deny_with_reason "Layer violation: L0-pure cannot import Node.js builtins ('$import_path'). L0 must be pure functions with zero side effects. If this function needs I/O, it doesn't belong in L0 — move it to L1-infra or higher."
    fi
    if echo "$import_path" | grep -qE "^($NODE_BUILTINS)(/|$)"; then
      deny_with_reason "Layer violation: L0-pure cannot import Node.js builtin '$import_path'. L0 must be pure functions with zero side effects. If this function needs I/O, it doesn't belong in L0 — move it to L1-infra or higher."
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
    local guidance
    guidance=$(get_guidance "$SOURCE_LAYER" "$target_layer")
    if [[ -z "$guidance" ]]; then
      local allowed_str
      if [[ -z "$allowed" ]]; then
        allowed_str="self only"
      else
        allowed_str=$(echo "$allowed" | sed 's/\([0-9]\)/L\1/g' | sed 's/ /, /g')
      fi
      guidance="L${SOURCE_LAYER} may only import: ${allowed_str}."
    fi
    deny_with_reason "Layer violation: L${SOURCE_LAYER} cannot import from L${target_layer}. ${guidance}"
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

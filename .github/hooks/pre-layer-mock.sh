#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Copilot Hook: Enforce layer-based mocking rules (L0–L7 architecture)
# ─────────────────────────────────────────────────────────────────────────
#
# UNIT TESTS (__tests__/unit/L{N}/)
#   L0:    NO vi.mock() allowed (pure functions, zero deps)
#   L1:    Can mock Node.js builtins only — all layer-path mocks blocked
#   L2:    Can mock external APIs/processes only — all layer-path mocks blocked
#   L3:    Can mock L2 clients only — L0/L1/L3-L7 layer paths blocked
#   L4-L7: Can mock layer directly below (L{N-1}) only
#
# INTEGRATION TESTS (__tests__/integration/)
#   L3/:    Can mock L1 infrastructure only — L0/L2+ layer paths blocked
#   L4-L6/: Can mock L2 external clients only — L0/L1/L3+ layer paths blocked
#   L7/:    Can mock L1/L3 (infra + services) only — L0/L2/L4+ layer paths blocked
#
# E2E TESTS (__tests__/e2e/)
#   NO vi.mock() allowed — everything runs real
#
# Third-party and Node.js builtin mocks (bare imports without /L{N}-
# path segments) are allowed everywhere except E2E and L0.
#
# Multi-line vi.mock() calls are handled by flattening content before
# regex extraction.
#
# NOTE: The global setup.ts auto-mocks the logger (L1-infra) for ALL
# test projects, including E2E. This hook cannot police vitest setupFiles
# since they run at runtime. Split setup.ts per project if E2E must use
# the real logger.
# ─────────────────────────────────────────────────────────────────────────

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

NORM_PATH=$(echo "$FILE_PATH" | tr '\\' '/')

if ! echo "$NORM_PATH" | grep -qE '\.(ts|js)$'; then exit 0; fi
if ! echo "$NORM_PATH" | grep -q '__tests__/'; then exit 0; fi

# ── Determine test type and layer ──

TEST_TYPE=""
UNIT_LAYER=""
INTEG_TIER=""

if echo "$NORM_PATH" | grep -q '__tests__/e2e/'; then
  TEST_TYPE="e2e"
elif echo "$NORM_PATH" | grep -qE '__tests__/unit/L[0-7]'; then
  TEST_TYPE="unit"
  UNIT_LAYER=$(echo "$NORM_PATH" | grep -oP '__tests__/unit/L\K[0-7]')
elif echo "$NORM_PATH" | grep -q '__tests__/integration/'; then
  TEST_TYPE="integration"
  if echo "$NORM_PATH" | grep -q '__tests__/integration/L7/'; then
    INTEG_TIER="L7"
  elif echo "$NORM_PATH" | grep -q '__tests__/integration/L4-L6/'; then
    INTEG_TIER="L4-L6"
  elif echo "$NORM_PATH" | grep -q '__tests__/integration/L3/'; then
    INTEG_TIER="L3"
  fi
else
  exit 0
fi

# ── Get content being written ──

CONTENT=""
if [[ "$TOOL_NAME" == "edit" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .new_str // empty')
elif [[ "$TOOL_NAME" == "create" ]]; then
  CONTENT=$(echo "$INPUT" | jq -r '.toolArgs | fromjson | .file_text // empty')
fi

if [[ -z "$CONTENT" ]]; then exit 0; fi

# Flatten content to handle multi-line vi.mock() calls
FLAT_CONTENT=$(printf '%s' "$CONTENT" | tr '\n' ' ')

if ! echo "$FLAT_CONTENT" | grep -q 'vi\.mock('; then exit 0; fi

# ── Blanket denials (any vi.mock is forbidden) ──

if [[ "$TEST_TYPE" == "e2e" ]]; then
  deny "E2E tests run everything real -- no mocking allowed. Use describe.skipIf() to gate on unavailable dependencies like FFmpeg."
fi

if [[ "$TEST_TYPE" == "unit" && "$UNIT_LAYER" == "0" ]]; then
  deny "L0 tests pure functions with zero I/O -- no mocking needed. If you need vi.mock(), this code has dependencies and doesn't belong in L0 -- move it to the appropriate layer."
fi

# ── Extract mock targets and check layer rules ──

MOCK_TARGETS=$(echo "$FLAT_CONTENT" | grep -oP "vi\.mock\(\s*['\"]\\K[^'\"]+" || true)
if [[ -z "$MOCK_TARGETS" ]]; then exit 0; fi

while IFS= read -r MOCK_TARGET; do
  # Only police layer-path mocks (/L{N}-); skip third-party/builtin mocks
  MOCK_LAYER=$(echo "$MOCK_TARGET" | grep -oP '/L\K[0-7](?=-)' || true)
  if [[ -z "$MOCK_LAYER" ]]; then continue; fi

  # ── Unit test rules ──

  if [[ "$TEST_TYPE" == "unit" ]]; then
    if [[ "$UNIT_LAYER" == "1" ]]; then
      deny "L1 unit tests mock Node.js builtins only (e.g., vi.mock('node:fs')). If the L1 code under test imports from L${MOCK_LAYER}, it has dependencies beyond builtins and may belong in a higher layer -- consider moving it up."
    fi
    if [[ "$UNIT_LAYER" == "2" ]]; then
      deny "L2 unit tests mock external packages only (e.g., vi.mock('openai')). If the L2 code under test imports from L${MOCK_LAYER}, it has business logic that belongs in L3-services, not L2 -- move the function up."
    fi
    # L3-L7: can only mock the layer directly below (N-1)
    ALLOWED=$(( UNIT_LAYER - 1 ))
    if [[ "$MOCK_LAYER" != "$ALLOWED" ]]; then
      case "$UNIT_LAYER" in
        3) deny "L3 unit tests can only mock L2-clients, not L${MOCK_LAYER}. If mocking L0/L1, those are foundation layers that run real. If mocking L3+, the code under test has wrong-layer imports -- refactor it. If you need to control L1 (config, filesystem), use the integration/L3/ test tier instead." ;;
        4) deny "L4 unit tests can only mock L3-services, not L${MOCK_LAYER}. If the code under test imports L2 directly, that's a layer import violation -- create an L3-services wrapper function (not a re-export). For LLM providers, inject a mock LLMProvider via constructor, don't vi.mock() the module." ;;
        5) deny "L5 unit tests can only mock L4 agents/bridges, not L${MOCK_LAYER}. If you need L2/L3 functionality in an L5 test, it should be behind an L4 bridge wrapper function -- mock the bridge instead." ;;
        6) deny "L6 unit tests can only mock L5 assets/loaders, not L${MOCK_LAYER}. If the pipeline code under test is importing L3/L4 directly, that's a layer violation -- refactor to go through L5 asset methods and loaders." ;;
        7) deny "L7 unit tests can only mock L6 pipeline, not L${MOCK_LAYER}. If the app code under test imports L3 directly, refactor to go through L6. If you need to mock L1+L3 together, use the integration/L7/ test tier." ;;
        *) deny "L${UNIT_LAYER} unit tests can only mock L${ALLOWED} (layer directly below), not L${MOCK_LAYER}." ;;
      esac
    fi
  fi

  # ── Integration test rules ──

  if [[ "$TEST_TYPE" == "integration" ]]; then
    if [[ "$INTEG_TIER" == "L3" && "$MOCK_LAYER" != "1" ]]; then
      deny "Integration L3 tests mock L1 infrastructure only, not L${MOCK_LAYER}. L2 clients run real alongside L3 -- that's the cross-layer integration being tested. If you need to mock L2, write a unit test in unit/L3/ instead."
    fi
    if [[ "$INTEG_TIER" == "L4-L6" && "$MOCK_LAYER" != "2" ]]; then
      deny "Integration L4-L6 tests mock L2 external clients only, not L${MOCK_LAYER}. L3 through L6 all run real -- that's the integration being tested. If the test needs to mock L3+, either write a unit test for the specific layer, or the source code has a layer violation."
    fi
    if [[ "$INTEG_TIER" == "L7" ]] && [[ "$MOCK_LAYER" != "1" && "$MOCK_LAYER" != "3" ]]; then
      deny "Integration L7 tests mock L1 and L3 only, not L${MOCK_LAYER}. L6 pipeline runs real under the app. If you need to mock L2/L4/L5, the app code may have wrong-layer imports -- L7 should only import L0, L1, L3, L6."
    fi
  fi
done <<< "$MOCK_TARGETS"

exit 0

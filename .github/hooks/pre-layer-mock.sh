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
  deny "E2E tests must not use vi.mock(). All dependencies should be real."
fi

if [[ "$TEST_TYPE" == "unit" && "$UNIT_LAYER" == "0" ]]; then
  deny "L0 (pure function) tests must not use vi.mock(). No dependencies to mock."
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
      deny "L1 unit tests can only mock Node.js builtins, not layer modules (found L${MOCK_LAYER} mock)."
    fi
    if [[ "$UNIT_LAYER" == "2" ]]; then
      deny "L2 unit tests can only mock external APIs/processes, not layer modules (found L${MOCK_LAYER} mock)."
    fi
    # L3-L7: can only mock the layer directly below (N-1)
    ALLOWED=$(( UNIT_LAYER - 1 ))
    if [[ "$MOCK_LAYER" != "$ALLOWED" ]]; then
      deny "L${UNIT_LAYER} unit tests can only mock L${ALLOWED} (layer directly below), not L${MOCK_LAYER}."
    fi
  fi

  # ── Integration test rules ──

  if [[ "$TEST_TYPE" == "integration" ]]; then
    if [[ "$INTEG_TIER" == "L3" && "$MOCK_LAYER" != "1" ]]; then
      deny "Integration L3 tests can only mock L1 infrastructure, not L${MOCK_LAYER} modules."
    fi
    if [[ "$INTEG_TIER" == "L4-L6" && "$MOCK_LAYER" != "2" ]]; then
      deny "Integration L4-L6 tests can only mock L2 clients, not L${MOCK_LAYER} modules."
    fi
    if [[ "$INTEG_TIER" == "L7" ]] && [[ "$MOCK_LAYER" != "1" && "$MOCK_LAYER" != "3" ]]; then
      deny "Integration L7 tests can only mock L1/L3 (infrastructure + services), not L${MOCK_LAYER} modules."
    fi
  fi
done <<< "$MOCK_TARGETS"

exit 0

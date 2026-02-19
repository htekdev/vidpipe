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
# Multi-line vi.mock() calls are handled via multiline regex matching.
#
# NOTE: The global setup.ts auto-mocks the logger (L1-infra) for ALL
# test projects, including E2E. This hook cannot police vitest setupFiles
# since they run at runtime. Split setup.ts per project if E2E must use
# the real logger.
# ─────────────────────────────────────────────────────────────────────────
try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    if ($toolName -ne "edit" -and $toolName -ne "create") {
        exit 0
    }

    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $filePath = $toolArgs.path
    if (-not $filePath) { exit 0 }

    $normalizedPath = $filePath -replace '\\', '/'

    if ($normalizedPath -notmatch '\.(ts|js)$') { exit 0 }
    if ($normalizedPath -notmatch '__tests__/') { exit 0 }

    # ── Determine test type and layer ──

    $testType = $null
    $unitLayer = -1
    $integTier = $null

    if ($normalizedPath -match '__tests__/e2e/') {
        $testType = "e2e"
    } elseif ($normalizedPath -match '__tests__/unit/L(\d)') {
        $testType = "unit"
        $unitLayer = [int]$Matches[1]
    } elseif ($normalizedPath -match '__tests__/integration/') {
        $testType = "integration"
        if ($normalizedPath -match '__tests__/integration/L7/') { $integTier = "L7" }
        elseif ($normalizedPath -match '__tests__/integration/L4-L6/') { $integTier = "L4-L6" }
        elseif ($normalizedPath -match '__tests__/integration/L3/') { $integTier = "L3" }
    } else {
        exit 0
    }

    # ── Get content being written ──

    $content = $null
    if ($toolName -eq "edit") { $content = $toolArgs.new_str }
    elseif ($toolName -eq "create") { $content = $toolArgs.file_text }
    if (-not $content) { exit 0 }

    if ($content -notmatch 'vi\.mock\(') { exit 0 }

    # ── Blanket denials (any vi.mock is forbidden) ──

    if ($testType -eq "e2e") {
        $reason = "E2E tests must not use vi.mock(). All dependencies should be real."
        [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
        "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
        exit 0
    }

    if ($testType -eq "unit" -and $unitLayer -eq 0) {
        $reason = "L0 (pure function) tests must not use vi.mock(). No dependencies to mock."
        [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
        "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
        exit 0
    }

    # ── Extract mock targets (multiline-safe regex) ──
    # [regex]::Matches handles \s across newlines, catching multi-line vi.mock() calls

    $mockMatches = [regex]::Matches($content, "vi\.mock\(\s*['""]([^'""]+)['""]")

    foreach ($m in $mockMatches) {
        $mockTarget = $m.Groups[1].Value

        # Only police layer-path mocks (/L{N}-); skip third-party/builtin mocks
        if ($mockTarget -notmatch '/L(\d)-') { continue }
        $mockLayerNum = [int]$Matches[1]

        # ── Unit test rules ──

        if ($testType -eq "unit") {
            if ($unitLayer -eq 1) {
                $reason = "L1 unit tests can only mock Node.js builtins, not layer modules (found L$mockLayerNum mock)."
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
            if ($unitLayer -eq 2) {
                $reason = "L2 unit tests can only mock external APIs/processes, not layer modules (found L$mockLayerNum mock)."
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
            # L3-L7: can only mock the layer directly below (N-1)
            $allowed = $unitLayer - 1
            if ($mockLayerNum -ne $allowed) {
                $reason = "L$unitLayer unit tests can only mock L$allowed (layer directly below), not L$mockLayerNum."
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
        }

        # ── Integration test rules ──

        if ($testType -eq "integration") {
            $reason = $null

            if ($integTier -eq "L3" -and $mockLayerNum -ne 1) {
                $reason = "Integration L3 tests can only mock L1 infrastructure, not L$mockLayerNum modules."
            }
            elseif ($integTier -eq "L4-L6" -and $mockLayerNum -ne 2) {
                $reason = "Integration L4-L6 tests can only mock L2 clients, not L$mockLayerNum modules."
            }
            elseif ($integTier -eq "L7" -and ($mockLayerNum -ne 1 -and $mockLayerNum -ne 3)) {
                $reason = "Integration L7 tests can only mock L1/L3 (infrastructure + services), not L$mockLayerNum modules."
            }

            if ($reason) {
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
        }
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("Layer-mock hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}

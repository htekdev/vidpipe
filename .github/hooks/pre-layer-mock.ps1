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
        $reason = "E2E tests run everything real -- no mocking allowed. Use describe.skipIf() to gate on unavailable dependencies like FFmpeg."
        [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
        "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
        exit 0
    }

    if ($testType -eq "unit" -and $unitLayer -eq 0) {
        $reason = "L0 tests pure functions with zero I/O -- no mocking needed. If you need vi.mock(), this code has dependencies and doesn't belong in L0 -- move it to the appropriate layer."
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
                $reason = "L1 unit tests mock Node.js builtins only (e.g., vi.mock('node:fs')). If the L1 code under test imports from L$mockLayerNum, it has dependencies beyond builtins and may belong in a higher layer -- consider moving it up."
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
            if ($unitLayer -eq 2) {
                $reason = "L2 unit tests mock external packages only (e.g., vi.mock('openai')). If the L2 code under test imports from L$mockLayerNum, it has business logic that belongs in L3-services, not L2 -- move the function up."
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
            # L3-L7: can only mock the layer directly below (N-1)
            $allowed = $unitLayer - 1
            if ($mockLayerNum -ne $allowed) {
                $mockGuidance = @{
                    3 = "L3 unit tests can only mock L2-clients, not L$mockLayerNum. If mocking L0/L1, those are foundation layers that run real. If mocking L3+, the code under test has wrong-layer imports -- refactor it. If you need to control L1 (config, filesystem), use the integration/L3/ test tier instead."
                    4 = "L4 unit tests can only mock L3-services, not L$mockLayerNum. If the code under test imports L2 directly, that's a layer import violation -- create an L3-services wrapper function (not a re-export). For LLM providers, inject a mock LLMProvider via constructor, don't vi.mock() the module."
                    5 = "L5 unit tests can only mock L4 agents/bridges, not L$mockLayerNum. If you need L2/L3 functionality in an L5 test, it should be behind an L4 bridge wrapper function -- mock the bridge instead."
                    6 = "L6 unit tests can only mock L5 assets/loaders, not L$mockLayerNum. If the pipeline code under test is importing L3/L4 directly, that's a layer violation -- refactor to go through L5 asset methods and loaders."
                    7 = "L7 unit tests can only mock L6 pipeline, not L$mockLayerNum. If the app code under test imports L3 directly, refactor to go through L6. If you need to mock L1+L3 together, use the integration/L7/ test tier."
                }
                $reason = $mockGuidance[$unitLayer]
                if (-not $reason) {
                    $reason = "L$unitLayer unit tests can only mock L$allowed (layer directly below), not L$mockLayerNum."
                }
                [Console]::Error.WriteLine("Layer-mock violation: $reason (in $filePath)")
                "{`"permissionDecision`":`"deny`",`"permissionDecisionReason`":`"$reason`"}"
                exit 0
            }
        }

        # ── Integration test rules ──

        if ($testType -eq "integration") {
            $reason = $null

            if ($integTier -eq "L3" -and $mockLayerNum -ne 1) {
                $reason = "Integration L3 tests mock L1 infrastructure only, not L$mockLayerNum. L2 clients run real alongside L3 -- that's the cross-layer integration being tested. If you need to mock L2, write a unit test in unit/L3/ instead."
            }
            elseif ($integTier -eq "L4-L6" -and $mockLayerNum -ne 2) {
                $reason = "Integration L4-L6 tests mock L2 external clients only, not L$mockLayerNum. L3 through L6 all run real -- that's the integration being tested. If the test needs to mock L3+, either write a unit test for the specific layer, or the source code has a layer violation."
            }
            elseif ($integTier -eq "L7" -and ($mockLayerNum -ne 1 -and $mockLayerNum -ne 3)) {
                $reason = "Integration L7 tests mock L1 and L3 only, not L$mockLayerNum. L6 pipeline runs real under the app. If you need to mock L2/L4/L5, the app code may have wrong-layer imports -- L7 should only import L0, L1, L3, L6."
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

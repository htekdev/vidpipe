# ─────────────────────────────────────────────────────────────────────────
# Tests for pre-layer-mock.ps1 hook
# Run from repo root: pwsh -NoProfile -File .github/hooks/__tests__/pre-layer-mock.tests.ps1
# ─────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$script:passed = 0
$script:failed = 0
$script:failures = @()

$hookPath = Join-Path $PSScriptRoot "..\pre-layer-mock.ps1"
if (-not (Test-Path $hookPath)) {
    Write-Host "ERROR: Hook not found at $hookPath" -ForegroundColor Red
    exit 1
}

# ── Helpers ──

function Invoke-Hook {
    param([string]$FilePath, [string]$Content)
    $argsJson = @{ path = $FilePath; new_str = $Content } | ConvertTo-Json -Compress
    $inputJson = @{ toolName = "edit"; toolArgs = $argsJson } | ConvertTo-Json -Compress
    $result = $inputJson | pwsh -NoProfile -File $hookPath 2>$null
    return $result
}

function Invoke-HookRaw {
    param([string]$Json)
    $result = $Json | pwsh -NoProfile -File $hookPath 2>$null
    return $result
}

function Assert-Allowed {
    param([string]$TestName, [string]$FilePath, [string]$Content)
    $result = Invoke-Hook -FilePath $FilePath -Content $Content
    if ([string]::IsNullOrWhiteSpace($result)) {
        $script:passed++
        Write-Host "  PASS: $TestName" -ForegroundColor Green
    } else {
        $script:failed++
        $script:failures += $TestName
        Write-Host "  FAIL: $TestName" -ForegroundColor Red
        Write-Host "    Expected: (no output / allow)" -ForegroundColor Yellow
        Write-Host "    Got:      $result" -ForegroundColor Yellow
    }
}

function Assert-Denied {
    param([string]$TestName, [string]$FilePath, [string]$Content)
    $result = Invoke-Hook -FilePath $FilePath -Content $Content
    if ($result -and $result -match '"permissionDecision"\s*:\s*"deny"') {
        $script:passed++
        Write-Host "  PASS: $TestName" -ForegroundColor Green
    } else {
        $script:failed++
        $script:failures += $TestName
        Write-Host "  FAIL: $TestName" -ForegroundColor Red
        Write-Host "    Expected: permissionDecision=deny" -ForegroundColor Yellow
        Write-Host "    Got:      $(if ($result) { $result } else { '(empty)' })" -ForegroundColor Yellow
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# UNIT TEST — ALLOW
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nUNIT TEST - ALLOW" -ForegroundColor Cyan

# 1. L3 unit test mocking L2
Assert-Allowed `
    -TestName "1. L3 unit mocking L2" `
    -FilePath "src/__tests__/unit/L3-services/transcription.test.ts" `
    -Content "vi.mock('../../L2-clients/whisper/whisperClient.js', () => ({}))"

# 2. L4 unit test mocking L3
Assert-Allowed `
    -TestName "2. L4 unit mocking L3" `
    -FilePath "src/__tests__/unit/L4-agents/shortsAgent.test.ts" `
    -Content "vi.mock('../../L3-services/videoOps/videoOps.js')"

# 3. L5 unit test mocking L4
Assert-Allowed `
    -TestName "3. L5 unit mocking L4" `
    -FilePath "src/__tests__/unit/L5-assets/asset.test.ts" `
    -Content "vi.mock('../../L4-agents/BaseAgent.js')"

# 4. L6 unit test mocking L5
Assert-Allowed `
    -TestName "4. L6 unit mocking L5" `
    -FilePath "src/__tests__/unit/L6-pipeline/pipeline.test.ts" `
    -Content "vi.mock('../../L5-assets/video.js')"

# 5. L7 unit test mocking L6
Assert-Allowed `
    -TestName "5. L7 unit mocking L6" `
    -FilePath "src/__tests__/unit/L7-app/cli.test.ts" `
    -Content "vi.mock('../../L6-pipeline/pipeline.js')"

# 6. L1 unit test mocking third-party (bare import)
Assert-Allowed `
    -TestName "6. L1 unit mocking third-party (fs)" `
    -FilePath "src/__tests__/unit/L1-infra/config.test.ts" `
    -Content "vi.mock('fs')"

# 7. L2 unit test mocking third-party
Assert-Allowed `
    -TestName "7. L2 unit mocking third-party (openai)" `
    -FilePath "src/__tests__/unit/L2-clients/whisper.test.ts" `
    -Content "vi.mock('openai')"

# ═══════════════════════════════════════════════════════════════════════════
# UNIT TEST — DENY
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nUNIT TEST - DENY" -ForegroundColor Cyan

# 8. L0 unit test with ANY vi.mock
Assert-Denied `
    -TestName "8. L0 unit with any vi.mock" `
    -FilePath "src/__tests__/unit/L0-pure/format.test.ts" `
    -Content "vi.mock('anything')"

# 9. L3 unit test mocking L1 (not directly below)
Assert-Denied `
    -TestName "9. L3 unit mocking L1 (skip layer)" `
    -FilePath "src/__tests__/unit/L3-services/transcription.test.ts" `
    -Content "vi.mock('../../L1-infra/config/environment.js')"

# 10. L3 unit test mocking L3 (self-mock)
Assert-Denied `
    -TestName "10. L3 unit mocking L3 (self-mock)" `
    -FilePath "src/__tests__/unit/L3-services/transcription.test.ts" `
    -Content "vi.mock('../../L3-services/other/other.js')"

# 11. L4 unit test mocking L2 (not directly below)
Assert-Denied `
    -TestName "11. L4 unit mocking L2 (skip layer)" `
    -FilePath "src/__tests__/unit/L4-agents/shortsAgent.test.ts" `
    -Content "vi.mock('../../L2-clients/ffmpeg/ffmpeg.js')"

# 12. L1 unit test mocking layer path
Assert-Denied `
    -TestName "12. L1 unit mocking layer path" `
    -FilePath "src/__tests__/unit/L1-infra/config.test.ts" `
    -Content "vi.mock('../../L1-infra/paths/paths.js')"

# 13. L2 unit test mocking layer path
Assert-Denied `
    -TestName "13. L2 unit mocking layer path" `
    -FilePath "src/__tests__/unit/L2-clients/whisper.test.ts" `
    -Content "vi.mock('../../L2-clients/ffmpeg/ffmpeg.js')"

# ═══════════════════════════════════════════════════════════════════════════
# INTEGRATION TEST — ALLOW
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nINTEGRATION TEST - ALLOW" -ForegroundColor Cyan

# 14. integration/L3 mocking L1
Assert-Allowed `
    -TestName "14. integration/L3 mocking L1" `
    -FilePath "src/__tests__/integration/L3/transcription.test.ts" `
    -Content "vi.mock('../../../L1-infra/fileSystem/fileSystem.js')"

# 15. integration/L3 mocking L0 — now denied (L0 is pure, don't mock it)
Assert-Denied `
    -TestName "15. integration/L3 mocking L0 (now blocked)" `
    -FilePath "src/__tests__/integration/L3/transcription.test.ts" `
    -Content "vi.mock('../../../L0-pure/types/index.js')"

# 16. integration/L4-L6 mocking L2
Assert-Allowed `
    -TestName "16. integration/L4-L6 mocking L2" `
    -FilePath "src/__tests__/integration/L4-L6/agent.test.ts" `
    -Content "vi.mock('../../../L2-clients/gemini/geminiClient.js')"

# 17. integration/L7 mocking L3
Assert-Allowed `
    -TestName "17. integration/L7 mocking L3" `
    -FilePath "src/__tests__/integration/L7/app.test.ts" `
    -Content "vi.mock('../../../L3-services/scheduler/scheduler.js')"

# 18. integration/L7 mocking L1
Assert-Allowed `
    -TestName "18. integration/L7 mocking L1" `
    -FilePath "src/__tests__/integration/L7/app.test.ts" `
    -Content "vi.mock('../../../L1-infra/config/environment.js')"

# 19. integration/L7 mocking L2 — now denied (L2 blocked in L7 integration)
Assert-Denied `
    -TestName "19. integration/L7 mocking L2 (now blocked)" `
    -FilePath "src/__tests__/integration/L7/app.test.ts" `
    -Content "vi.mock('../../../L2-clients/late/lateApi.js')"

# ═══════════════════════════════════════════════════════════════════════════
# INTEGRATION TEST — DENY
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nINTEGRATION TEST - DENY" -ForegroundColor Cyan

# 20. integration/L3 mocking L2
Assert-Denied `
    -TestName "20. integration/L3 mocking L2" `
    -FilePath "src/__tests__/integration/L3/transcription.test.ts" `
    -Content "vi.mock('../../../L2-clients/ffmpeg/ffmpeg.js')"

# 21. integration/L4-L6 mocking L3
Assert-Denied `
    -TestName "21. integration/L4-L6 mocking L3" `
    -FilePath "src/__tests__/integration/L4-L6/agent.test.ts" `
    -Content "vi.mock('../../../L3-services/costTracker/costTracker.js')"

# 22. integration/L4-L6 mocking L1
Assert-Denied `
    -TestName "22. integration/L4-L6 mocking L1" `
    -FilePath "src/__tests__/integration/L4-L6/agent.test.ts" `
    -Content "vi.mock('../../../L1-infra/config/environment.js')"

# 23. integration/L7 mocking L4
Assert-Denied `
    -TestName "23. integration/L7 mocking L4" `
    -FilePath "src/__tests__/integration/L7/app.test.ts" `
    -Content "vi.mock('../../../L4-agents/ShortsAgent.js')"

# 24. integration/L7 mocking L0
Assert-Denied `
    -TestName "24. integration/L7 mocking L0" `
    -FilePath "src/__tests__/integration/L7/app.test.ts" `
    -Content "vi.mock('../../../L0-pure/types/index.js')"

# ═══════════════════════════════════════════════════════════════════════════
# E2E TEST — DENY
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nE2E TEST - DENY" -ForegroundColor Cyan

# 25. E2E with any vi.mock
Assert-Denied `
    -TestName "25. E2E with any vi.mock" `
    -FilePath "src/__tests__/e2e/full.test.ts" `
    -Content "vi.mock('anything')"

# ═══════════════════════════════════════════════════════════════════════════
# PASS-THROUGH
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nPASS-THROUGH" -ForegroundColor Cyan

# 26. Non-test file — should be ignored
Assert-Allowed `
    -TestName "26. Non-test file ignored" `
    -FilePath "src/L3-services/transcription/transcription.ts" `
    -Content "vi.mock('../../L2-clients/whisper/whisperClient.js')"

# 27. Non-edit tool — should pass through
$nonEditJson = @{ toolName = "view"; toolArgs = (@{ path = "src/__tests__/unit/L0-pure/format.test.ts" } | ConvertTo-Json -Compress) } | ConvertTo-Json -Compress
$result27 = Invoke-HookRaw -Json $nonEditJson
if ([string]::IsNullOrWhiteSpace($result27)) {
    $script:passed++
    Write-Host "  PASS: 27. Non-edit tool passes through" -ForegroundColor Green
} else {
    $script:failed++
    $script:failures += "27. Non-edit tool passes through"
    Write-Host "  FAIL: 27. Non-edit tool passes through" -ForegroundColor Red
    Write-Host "    Expected: (no output)" -ForegroundColor Yellow
    Write-Host "    Got:      $result27" -ForegroundColor Yellow
}

# 28. Content without vi.mock — should pass through
Assert-Allowed `
    -TestName "28. Content without vi.mock" `
    -FilePath "src/__tests__/unit/L3-services/transcription.test.ts" `
    -Content "import { transcribe } from '../../L3-services/transcription.js'"

# 29. Third-party mock in integration test — allowed (no layer path)
Assert-Allowed `
    -TestName "29. Third-party mock in integration test" `
    -FilePath "src/__tests__/integration/L3/server.test.ts" `
    -Content "vi.mock('express')"

# ═══════════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`n─────────────────────────────────────────" -ForegroundColor White
Write-Host "Results: $($script:passed) passed, $($script:failed) failed, $($script:passed + $script:failed) total" -ForegroundColor $(if ($script:failed -eq 0) { "Green" } else { "Red" })

if ($script:failed -gt 0) {
    Write-Host "`nFailures:" -ForegroundColor Red
    foreach ($f in $script:failures) {
        Write-Host "  - $f" -ForegroundColor Red
    }
    exit 1
}

exit 0

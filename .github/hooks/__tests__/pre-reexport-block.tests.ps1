# ─────────────────────────────────────────────────────────────────────────
# Tests for pre-reexport-block.ps1 hook
# Run from repo root: pwsh -NoProfile -File .github/hooks/__tests__/pre-reexport-block.tests.ps1
# ─────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$script:passed = 0
$script:failed = 0
$script:failures = @()

$hookPath = Join-Path $PSScriptRoot "..\pre-reexport-block.ps1"
if (-not (Test-Path $hookPath)) {
    Write-Host "ERROR: Hook not found at $hookPath" -ForegroundColor Red
    exit 1
}

# ── Helpers ──

function Invoke-Hook {
    param(
        [string]$FilePath,
        [string]$Content,
        [string]$ToolName = "edit",
        [string]$ToolAction = "new_str"
    )
    $key = if ($ToolAction -eq "file_text") { "file_text" } else { "new_str" }
    $argsJson = @{ path = $FilePath; $key = $Content } | ConvertTo-Json -Compress
    $inputJson = @{ toolName = $ToolName; toolArgs = $argsJson } | ConvertTo-Json -Compress
    $result = $inputJson | pwsh -NoProfile -File $hookPath 2>$null
    return $result
}

function Assert-Allowed {
    param([string]$TestName, [string]$FilePath, [string]$Content, [string]$ToolName = "edit")
    $result = Invoke-Hook -FilePath $FilePath -Content $Content -ToolName $ToolName
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
    param([string]$TestName, [string]$FilePath, [string]$Content, [string]$ToolName = "edit")
    $result = Invoke-Hook -FilePath $FilePath -Content $Content -ToolName $ToolName
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
# DENY cases
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nDENY cases:" -ForegroundColor Cyan

# 1. Cross-layer named re-export (L3 re-exporting from L2)
Assert-Denied `
    -TestName "1. Cross-layer named re-export (L3 from L2)" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "export { foo } from '../../L2-clients/something.js'"

# 2. Cross-layer star re-export (L3 re-exporting from L2)
Assert-Denied `
    -TestName "2. Cross-layer star re-export (L3 from L2)" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "export * from '../../L2-clients/something.js'"

# 3. Multi-line cross-layer re-export
Assert-Denied `
    -TestName "3. Multi-line cross-layer re-export" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "export {`n  foo,`n  bar`n} from '../../L2-clients/something.js'"

# 4. L4 re-exporting from L3
Assert-Denied `
    -TestName "4. L4 re-exporting from L3" `
    -FilePath "src/L4-agents/index.ts" `
    -Content "export { costTracker } from '../L3-services/costTracking/costTracker.js'"

# 5. L5 re-exporting from L4
Assert-Denied `
    -TestName "5. L5 re-exporting from L4" `
    -FilePath "src/L5-assets/index.ts" `
    -Content "export { myFunc } from '../L4-agents/something.js'"

# ═══════════════════════════════════════════════════════════════════════════
# ALLOW cases
# ═══════════════════════════════════════════════════════════════════════════

Write-Host "`nALLOW cases:" -ForegroundColor Cyan

# 6. Same-layer re-export
Assert-Allowed `
    -TestName "6. Same-layer re-export (L4 from L4)" `
    -FilePath "src/L4-agents/index.ts" `
    -Content "export { BaseAgent } from './BaseAgent.js'"

# 7. Type-only re-export crossing layers
Assert-Allowed `
    -TestName "7. Type-only re-export (export type)" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "export type { Foo } from '../../L2-clients/types.js'"

# 8. Third-party re-export (no layer path)
Assert-Allowed `
    -TestName "8. Third-party re-export" `
    -FilePath "src/L1-infra/ai/openai.ts" `
    -Content "export { OpenAI } from 'openai'"

# 9. Test file with cross-layer re-export (exempt)
Assert-Allowed `
    -TestName "9. Test file exempt from re-export check" `
    -FilePath "src/__tests__/unit/L3-services/helpers.ts" `
    -Content "export { foo } from '../../L2-clients/something.js'"

# 10. Non-source file (outside src/L{digit}-)
Assert-Allowed `
    -TestName "10. Non-source file (no layer path)" `
    -FilePath "scripts/build.ts" `
    -Content "export { foo } from '../../L2-clients/something.js'"

# 11. Regular import (not a re-export)
Assert-Allowed `
    -TestName "11. Regular import (not re-export)" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "import { foo } from '../../L2-clients/something.js'"

# 12. Non-TS file (.json)
Assert-Allowed `
    -TestName "12. Non-TS file (.json)" `
    -FilePath "src/L3-services/config.json" `
    -Content '{"key": "value"}'

# 13. Edit with no export statements
Assert-Allowed `
    -TestName "13. No export statements in content" `
    -FilePath "src/L3-services/bar.ts" `
    -Content "const x = 42; console.log(x);"

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

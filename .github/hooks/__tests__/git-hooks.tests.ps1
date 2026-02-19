# ─────────────────────────────────────────────────────────────────────────
# Tests for git operation hooks:
#   pre-push-block.ps1, pre-force-push-block.ps1,
#   pre-amend-block.ps1, post-edit-invalidate.ps1
#
# Run: pwsh -NoProfile -File .github/hooks/__tests__/git-hooks.tests.ps1
# ─────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$script:Pass = 0
$script:Fail = 0
$script:HooksDir = Join-Path $PSScriptRoot ".."

function Invoke-Hook {
    param(
        [string]$HookFile,
        [string]$ToolName,
        [hashtable]$ToolArgs
    )
    $argsJson = $ToolArgs | ConvertTo-Json -Compress
    $inputObj = @{ toolName = $ToolName; toolArgs = $argsJson } | ConvertTo-Json -Compress
    $hookPath = Join-Path $script:HooksDir $HookFile
    $result = $inputObj | pwsh -NoProfile -File $hookPath 2>$null
    return $result
}

function Assert-Deny {
    param([string]$TestName, [string]$Result)
    if ($Result -and $Result -match '"permissionDecision"\s*:\s*"deny"') {
        $script:Pass++
        Write-Host "  PASS  $TestName" -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host "  FAIL  $TestName — expected DENY, got: $Result" -ForegroundColor Red
    }
}

function Assert-Allow {
    param([string]$TestName, [string]$Result)
    if (-not $Result -or $Result -notmatch '"permissionDecision"\s*:\s*"deny"') {
        $script:Pass++
        Write-Host "  PASS  $TestName" -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host "  FAIL  $TestName — expected ALLOW, got: $Result" -ForegroundColor Red
    }
}

# ─────────────────────────────────────────────────────────────────────────
# pre-push-block.ps1
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── pre-push-block ──" -ForegroundColor Cyan

$r = Invoke-Hook "pre-push-block.ps1" "bash" @{ command = "git push" }
Assert-Deny "DENY git push" $r

$r = Invoke-Hook "pre-push-block.ps1" "bash" @{ command = "git push origin main" }
Assert-Deny "DENY git push origin main" $r

$r = Invoke-Hook "pre-push-block.ps1" "bash" @{ command = "git --no-pager push origin main" }
Assert-Deny "DENY git --no-pager push" $r

$r = Invoke-Hook "pre-push-block.ps1" "bash" @{ command = "git status" }
Assert-Allow "ALLOW git status" $r

$r = Invoke-Hook "pre-push-block.ps1" "bash" @{ command = 'git commit -m "test"' }
Assert-Allow "ALLOW git commit" $r

$r = Invoke-Hook "pre-push-block.ps1" "edit" @{ path = "src/foo.ts" }
Assert-Allow "ALLOW non-bash tool" $r

# ─────────────────────────────────────────────────────────────────────────
# pre-force-push-block.ps1
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── pre-force-push-block ──" -ForegroundColor Cyan

$r = Invoke-Hook "pre-force-push-block.ps1" "bash" @{ command = "git push --force" }
Assert-Deny "DENY git push --force" $r

$r = Invoke-Hook "pre-force-push-block.ps1" "bash" @{ command = "git --no-pager push --force" }
Assert-Deny "DENY git --no-pager push --force" $r

$r = Invoke-Hook "pre-force-push-block.ps1" "bash" @{ command = "git push origin main --force-with-lease" }
Assert-Deny "DENY git push --force-with-lease" $r

$r = Invoke-Hook "pre-force-push-block.ps1" "bash" @{ command = "git push -f origin main" }
Assert-Deny "DENY git push -f" $r

$r = Invoke-Hook "pre-force-push-block.ps1" "bash" @{ command = "git push origin main" }
Assert-Allow "ALLOW normal git push" $r

$r = Invoke-Hook "pre-force-push-block.ps1" "edit" @{ path = "src/foo.ts" }
Assert-Allow "ALLOW non-bash tool" $r

# ─────────────────────────────────────────────────────────────────────────
# pre-commit-block.ps1
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── pre-commit-block ──" -ForegroundColor Cyan

$r = Invoke-Hook "pre-commit-block.ps1" "bash" @{ command = 'git commit -m "test"' }
Assert-Deny "DENY git commit" $r

$r = Invoke-Hook "pre-commit-block.ps1" "bash" @{ command = 'git --no-pager commit -m "test"' }
Assert-Deny "DENY git --no-pager commit" $r

$r = Invoke-Hook "pre-commit-block.ps1" "bash" @{ command = "git status" }
Assert-Allow "ALLOW git status" $r

$r = Invoke-Hook "pre-commit-block.ps1" "edit" @{ path = "src/foo.ts" }
Assert-Allow "ALLOW non-bash tool" $r

# ─────────────────────────────────────────────────────────────────────────
# pre-amend-block.ps1  (pattern matching only — skip git state checks)
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── pre-amend-block ──" -ForegroundColor Cyan

$r = Invoke-Hook "pre-amend-block.ps1" "bash" @{ command = 'git commit -m "test"' }
Assert-Allow "ALLOW git commit (not amend)" $r

$r = Invoke-Hook "pre-amend-block.ps1" "edit" @{ path = "src/foo.ts" }
Assert-Allow "ALLOW non-bash tool" $r

# NOTE: Cannot test DENY case — requires HEAD to be pushed to remote.
# The hook checks git state (merge-base) which is environment-dependent.

# ─────────────────────────────────────────────────────────────────────────
# post-edit-invalidate.ps1
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── post-edit-invalidate ──" -ForegroundColor Cyan

$r = Invoke-Hook "post-edit-invalidate.ps1" "bash" @{ command = "git status" }
Assert-Allow "ALLOW non-edit tool (bash)" $r

$r = Invoke-Hook "post-edit-invalidate.ps1" "edit" @{ path = ".github/reviewed.md" }
Assert-Allow "ALLOW edit of reviewed.md itself" $r

$r = Invoke-Hook "post-edit-invalidate.ps1" "edit" @{ path = ".github/debt.md" }
Assert-Allow "ALLOW edit of debt.md" $r

# Functional test: create a temp reviewed.md, run hook with a .ts edit, verify deletion
$tempReviewed = ".github/reviewed.md"
$createdTemp = $false
try {
    if (-not (Test-Path $tempReviewed)) {
        New-Item -ItemType File -Path $tempReviewed -Force | Out-Null
        Set-Content -Path $tempReviewed -Value "placeholder"
        $createdTemp = $true
    }

    $r = Invoke-Hook "post-edit-invalidate.ps1" "edit" @{ path = "src/something.ts" }
    if (-not (Test-Path $tempReviewed)) {
        $script:Pass++
        Write-Host "  PASS  Deletes reviewed.md on .ts edit" -ForegroundColor Green
    } else {
        $script:Fail++
        Write-Host "  FAIL  Expected reviewed.md to be deleted" -ForegroundColor Red
    }
} finally {
    # Clean up if the hook didn't delete it or if we created it
    if (Test-Path $tempReviewed) {
        Remove-Item $tempReviewed -Force -ErrorAction SilentlyContinue
    }
}

# ─────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────
Write-Host "`n── Summary ──" -ForegroundColor Cyan
$total = $script:Pass + $script:Fail
Write-Host "  $script:Pass/$total passed" -ForegroundColor $(if ($script:Fail -eq 0) { "Green" } else { "Red" })

if ($script:Fail -gt 0) {
    Write-Host "  $script:Fail FAILED" -ForegroundColor Red
    exit 1
}

Write-Host "  All tests passed!" -ForegroundColor Green
exit 0

# Copilot Hook: Block git push unless tests and coverage pass
$ErrorActionPreference = "Stop"

try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    # Only intercept bash/powershell commands
    if ($toolName -ne "bash" -and $toolName -ne "powershell") {
        exit 0
    }

    # Parse tool args to get the command
    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $command = $toolArgs.command

    if (-not $command) {
        exit 0
    }

    # Check if the command contains 'git push'
    if ($command -notmatch "git\s+push") {
        exit 0
    }

    [Console]::Error.WriteLine("🧪 Pre-push hook: Running tests with coverage...")

    # Run tests with coverage — capture all output, don't let stderr throw
    $ErrorActionPreference = "Continue"
    $testOutput = & npm run test:coverage 2>&1
    $testExitCode = $LASTEXITCODE
    $ErrorActionPreference = "Stop"

    if ($testExitCode -ne 0) {
        [Console]::Error.WriteLine("❌ Tests or coverage failed. Blocking push.")
        $output = @{
            permissionDecision = "deny"
            permissionDecisionReason = "Tests failed or coverage thresholds not met. Fix before pushing."
        }
        $output | ConvertTo-Json -Compress
        exit 0
    }

    [Console]::Error.WriteLine("✅ All tests passed with coverage thresholds met.")

    $output = @{
        permissionDecision = "allow"
    }
    $output | ConvertTo-Json -Compress
}
catch {
    # On hook error, allow the push (fail-open) to avoid blocking work
    Write-Error $_.Exception.Message
    exit 0
}

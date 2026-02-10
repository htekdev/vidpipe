# Copilot Hook: Block git push — must use npm run push instead
try {
    $inputJson = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = $inputJson.toolName

    if ($toolName -ne "bash" -and $toolName -ne "powershell") {
        exit 0
    }

    $toolArgs = $inputJson.toolArgs | ConvertFrom-Json
    $command = $toolArgs.command

    if (-not $command) {
        exit 0
    }

    if ($command -notmatch "git\s+push") {
        exit 0
    }

    [Console]::Error.WriteLine("🚫 Direct git push is blocked. Use 'npm run push' instead.")
    '{"permissionDecision":"deny","permissionDecisionReason":"Direct git push is blocked. Use `npm run push` instead — it runs typecheck, tests, coverage, build, pushes, and polls PR gates (CodeQL + Copilot review)."}'
}
catch {
    [Console]::Error.WriteLine("Pre-push-block hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}

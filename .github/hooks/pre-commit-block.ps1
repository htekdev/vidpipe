# Copilot Hook: Block git commit -- must use npm run commit instead
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

    # Match git commit but not npm run commit
    if ($command -notmatch "git\s+(--\S+\s+)*commit") {
        exit 0
    }

    # Allow if running inside npm run commit (the commit gate calls git commit internally)
    if ($command -match "npm\s+run\s+commit") {
        exit 0
    }

    [Console]::Error.WriteLine("Block: Direct git commit is blocked. Use 'npm run commit' instead.")
    '{"permissionDecision":"deny","permissionDecisionReason":"Direct git commit is blocked. Use `npm run commit -- -m \"message\"` instead -- it enforces test tier coverage and changed-line coverage before committing."}'
}
catch {
    [Console]::Error.WriteLine("Pre-commit-block hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}

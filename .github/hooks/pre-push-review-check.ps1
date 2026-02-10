# Copilot Hook: Block git push unless code has been reviewed
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

    [Console]::Error.WriteLine("Pre-push hook: Checking for .github/reviewed.md...")

    if (Test-Path ".github/reviewed.md") {
        [Console]::Error.WriteLine("Code review marker found. Allowing push.")
        '{"permissionDecision":"allow"}'
    }
    else {
        [Console]::Error.WriteLine("Code review required. .github/reviewed.md not found.")
        '{"permissionDecision":"deny","permissionDecisionReason":"Code review required. Run the code-reviewer agent before pushing. (.github/reviewed.md not found)"}'
    }
}
catch {
    [Console]::Error.WriteLine("Pre-push hook error: $($_.Exception.Message). Allowing push (fail-open).")
    exit 0
}

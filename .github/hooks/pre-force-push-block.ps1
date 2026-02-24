# Copilot Hook: Block git push --force / --force-with-lease
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

    if ($command -notmatch "git\s+(--\S+\s+)*push\s+.*(--force|--force-with-lease|-f\b)") {
        exit 0
    }

    [Console]::Error.WriteLine("🚫 Force push is blocked. Create a new commit to fix issues instead of rewriting history.")
    '{"permissionDecision":"deny","permissionDecisionReason":"Force pushing rewrites remote history and breaks collaborators. Create a new fixup commit instead."}'
}
catch {
    [Console]::Error.WriteLine("Pre-force-push-block hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}

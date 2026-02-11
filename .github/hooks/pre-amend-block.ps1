# Copilot Hook: Block git commit --amend when HEAD is already pushed
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

    if ($command -notmatch "git\s+commit\s+.*--amend") {
        exit 0
    }

    # Check if HEAD has been pushed to the tracking remote branch
    $branch = git rev-parse --abbrev-ref HEAD 2>$null
    if (-not $branch) {
        exit 0
    }

    $remote = git config "branch.$branch.remote" 2>$null
    if (-not $remote) {
        # No tracking remote — amend is safe
        exit 0
    }

    $localSha = git rev-parse HEAD 2>$null
    $remoteSha = git rev-parse "$remote/$branch" 2>$null
    if (-not $remoteSha) {
        # Remote branch doesn't exist yet — amend is safe
        exit 0
    }

    # If local HEAD is an ancestor of (or equal to) the remote, it's been pushed
    $mergeBase = git merge-base $localSha $remoteSha 2>$null
    if ($mergeBase -eq $localSha) {
        [Console]::Error.WriteLine("🚫 Cannot amend: HEAD ($($localSha.Substring(0,7))) is already pushed to $remote/$branch. Create a new commit instead.")
        '{"permissionDecision":"deny","permissionDecisionReason":"Amending a pushed commit causes force-push conflicts. Create a new fixup commit instead."}'
        exit 0
    }

    exit 0
}
catch {
    [Console]::Error.WriteLine("Pre-amend-block hook error: $($_.Exception.Message). Allowing (fail-open).")
    exit 0
}

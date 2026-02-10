# Copilot Hook: Block git push unless code has been reviewed
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

    [Console]::Error.WriteLine("🔍 Pre-push hook: Checking code review status...")

    # Get HEAD commit
    $ErrorActionPreference = "Continue"
    $headCommit = (git rev-parse HEAD 2>&1 | Out-String).Trim()
    $ErrorActionPreference = "Stop"

    # Read .github/review.json
    $reviewPath = ".github/review.json"
    if (-not (Test-Path $reviewPath)) {
        [Console]::Error.WriteLine("❌ No .github/review.json found. Blocking push.")
        $output = @{
            permissionDecision = "deny"
            permissionDecisionReason = "No .github/review.json found. Run the code-reviewer agent first."
        }
        $output | ConvertTo-Json -Compress
        exit 0
    }

    $reviewJson = Get-Content $reviewPath -Raw | ConvertFrom-Json
    $lastReviewedCommit = $reviewJson.lastReviewedCommit

    if ($headCommit -eq $lastReviewedCommit) {
        [Console]::Error.WriteLine("✅ Code review is current (HEAD matches last reviewed commit).")
        $output = @{
            permissionDecision = "allow"
        }
        $output | ConvertTo-Json -Compress
    }
    else {
        # Check if HEAD is a descendant of the reviewed commit where the ONLY
        # changes since the review are to .github/review.json itself.
        # This handles the chicken-and-egg: reviewing creates a commit that
        # updates review.json, which changes HEAD.
        $ErrorActionPreference = "Continue"
        $changedFiles = git diff --name-only $lastReviewedCommit HEAD 2>&1 | Out-String
        $ErrorActionPreference = "Stop"

        $changedList = ($changedFiles.Trim() -split "`n" | Where-Object { $_.Trim() -ne "" })
        $onlyReviewJson = ($changedList.Count -eq 1 -and $changedList[0].Trim() -eq ".github/review.json")

        if ($onlyReviewJson) {
            [Console]::Error.WriteLine("✅ Code review is current (only review.json changed since last review).")
            $output = @{
                permissionDecision = "allow"
            }
            $output | ConvertTo-Json -Compress
        }
        else {
            [Console]::Error.WriteLine("❌ Code review required. HEAD $headCommit has not been reviewed (last reviewed: $lastReviewedCommit). Blocking push.")
            $output = @{
                permissionDecision = "deny"
                permissionDecisionReason = "Code review required. HEAD commit $headCommit has not been reviewed (last reviewed: $lastReviewedCommit). Use the code-reviewer agent to review changes before pushing."
            }
            $output | ConvertTo-Json -Compress
        }
    }
}
catch {
    # On hook error, allow the push (fail-open) to avoid blocking work
    Write-Error $_.Exception.Message
    exit 0
}
